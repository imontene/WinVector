import { describe, expect, it } from "vitest";
import { EngineBridge } from "./bridge";
import { PROTOCOL_VERSION } from "./generated/contracts";
import {
  consoleTransport,
  webViewTransport,
  type BridgeTransport,
  type WebViewHost,
} from "./transport";

/** Transporte simulado: guarda lo enviado y permite inyectar mensajes entrantes. */
function fakeTransport() {
  const sent: unknown[] = [];
  let handler: ((data: unknown) => void) | undefined;
  const transport: BridgeTransport = {
    send: (message) => sent.push(message),
    onMessage: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };
  return {
    transport,
    sent,
    receive: (data: unknown) => handler?.(data),
    get listening() {
      return handler !== undefined;
    },
  };
}

/** Espera a que terminen los manejadores asíncronos. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function createBridge() {
  const fake = fakeTransport();
  let n = 0;
  const bridge = new EngineBridge(fake.transport, {
    engineVersion: "1.2.3",
    createId: () => `e${String(++n)}`,
  });
  bridge.handle("app.ping", ({ sentAt }) => ({ sentAt, receivedAt: 2000 }));
  bridge.start();
  // Object.assign conserva el getter `listening` de `fake`; una copia con `...` lo congelaría.
  return Object.assign(fake, { bridge });
}

const ping = (overrides: Record<string, unknown> = {}) => ({
  kind: "command",
  id: "c1",
  name: "app.ping",
  protocolVersion: PROTOCOL_VERSION,
  payload: { sentAt: 1000 },
  ...overrides,
});

describe("EngineBridge", () => {
  it("anuncia engine.ready al empezar", () => {
    const { sent } = createBridge();
    expect(sent).toEqual([
      {
        kind: "event",
        id: "e1",
        name: "engine.ready",
        protocolVersion: PROTOCOL_VERSION,
        payload: { engineVersion: "1.2.3", protocolVersion: PROTOCOL_VERSION },
      },
    ]);
  });

  it("responde a app.ping con el mismo id", async () => {
    const { sent, receive } = createBridge();
    receive(ping());
    await settle();
    expect(sent.at(-1)).toEqual({
      kind: "response",
      id: "c1",
      name: "app.ping",
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      payload: { sentAt: 1000, receivedAt: 2000 },
    });
  });

  it("emite eventos con identificadores nuevos", () => {
    const { bridge, sent } = createBridge();
    bridge.emit("selection.changed", {
      documentId: "d1",
      items: [{ id: "sol", tagName: "circle" }],
      bounds: { x: 248, y: 44, width: 104, height: 104 },
      scope: null,
    });
    expect(sent.at(-1)).toMatchObject({ kind: "event", id: "e2", name: "selection.changed" });
  });

  it.each([
    ["un texto", "hola"],
    ["null", null],
    ["un array", [1, 2]],
    ["un evento", { ...ping(), kind: "event" }],
    ["un comando sin id", { ...ping(), id: undefined }],
    ["un comando sin payload", { ...ping(), payload: undefined }],
    ["un protocolo no entero", { ...ping(), protocolVersion: "1" }],
  ])("responde a %s con un evento error invalid-message", (_, data) => {
    const { sent, receive } = createBridge();
    receive(data);
    expect(sent.at(-1)).toMatchObject({
      kind: "event",
      name: "error",
      payload: { code: "invalid-message" },
    });
  });

  it("conserva el id del mensaje inválido cuando lo tiene", () => {
    const { sent, receive } = createBridge();
    receive({ ...ping(), payload: undefined, id: "c9" });
    expect(sent.at(-1)).toMatchObject({ payload: { relatedId: "c9" } });
  });

  it("responde con error a un comando desconocido", async () => {
    const { sent, receive } = createBridge();
    receive(ping({ name: "document.explode" }));
    await settle();
    expect(sent.at(-1)).toMatchObject({
      kind: "response",
      id: "c1",
      name: "document.explode",
      ok: false,
      error: { code: "unknown-message", relatedId: "c1" },
    });
  });

  it("responde con error a otra versión del protocolo", async () => {
    const { sent, receive } = createBridge();
    receive(ping({ protocolVersion: PROTOCOL_VERSION + 1 }));
    await settle();
    expect(sent.at(-1)).toMatchObject({ ok: false, error: { code: "protocol-mismatch" } });
  });

  it("responde con error internal si el manejador falla", async () => {
    const fake = fakeTransport();
    const bridge = new EngineBridge(fake.transport, { engineVersion: "1.2.3" });
    bridge.handle("app.ping", () => {
      throw new Error("se rompió");
    });
    bridge.start();
    fake.receive(ping());
    await settle();
    expect(fake.sent.at(-1)).toMatchObject({
      ok: false,
      error: { code: "internal", message: "se rompió" },
    });
  });

  it("no admite dos manejadores para el mismo comando", () => {
    const { bridge } = createBridge();
    expect(() => {
      bridge.handle("app.ping", ({ sentAt }) => ({ sentAt, receivedAt: 0 }));
    }).toThrow(/ya tiene manejador/);
  });

  it("deja de escuchar al detenerse", () => {
    const created = createBridge();
    created.bridge.stop();
    expect(created.listening).toBe(false);
  });
});

describe("transportes", () => {
  it("webViewTransport usa postMessage y el evento message", () => {
    const posted: unknown[] = [];
    const listeners = new Set<(event: { data: unknown }) => void>();
    const host: WebViewHost = {
      postMessage: (m) => posted.push(m),
      addEventListener: (_, l) => listeners.add(l),
      removeEventListener: (_, l) => listeners.delete(l),
    };
    const transport = webViewTransport(host);
    const received: unknown[] = [];
    const stop = transport.onMessage((d) => received.push(d));

    transport.send({
      kind: "event",
      id: "e1",
      name: "error",
      protocolVersion: 1,
      payload: { code: "internal", message: "x", relatedId: null },
    });
    listeners.forEach((l) => {
      l({ data: { hola: 1 } });
    });
    stop();

    expect(posted).toHaveLength(1);
    expect(received).toEqual([{ hola: 1 }]);
    expect(listeners.size).toBe(0);
  });

  it("consoleTransport escribe lo enviado", () => {
    const logged: unknown[][] = [];
    const transport = consoleTransport((...data) => logged.push(data));
    transport.send({
      kind: "event",
      id: "e1",
      name: "error",
      protocolVersion: 1,
      payload: { code: "internal", message: "x", relatedId: null },
    });
    expect(logged[0]?.[0]).toBe("[puente] →");
  });
});
