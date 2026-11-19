import { describe, expect, it } from "vitest";
import {
  BRIDGE_COMMAND_NAMES,
  BRIDGE_EVENT_NAMES,
  PROTOCOL_VERSION,
  type BridgeMessage,
} from "./generated/contracts";

const base = { protocolVersion: PROTOCOL_VERSION } as const;

// Un ejemplo de cada forma de mensaje. Si el contrato cambia (por ejemplo, un campo obligatorio
// nuevo), este archivo deja de compilar hasta que se actualice, igual que el resto del motor.
const examples: readonly BridgeMessage[] = [
  { ...base, kind: "command", id: "c1", name: "app.ping", payload: { sentAt: 1234.5 } },
  {
    ...base,
    kind: "response",
    id: "c1",
    name: "app.ping",
    ok: true,
    payload: { sentAt: 1234.5, receivedAt: 1236 },
  },
  {
    ...base,
    kind: "response",
    id: "c2",
    name: "app.ping",
    ok: false,
    error: { code: "timeout", message: "Sin respuesta", relatedId: "c2" },
  },
  {
    ...base,
    kind: "command",
    id: "c3",
    name: "document.load",
    payload: { documentId: "d1", name: "logo.svg", svg: "<svg/>" },
  },
  {
    ...base,
    kind: "response",
    id: "c3",
    name: "document.load",
    ok: true,
    payload: {
      documentId: "d1",
      loaded: false,
      revision: 0,
      exactMapping: false,
      error: { message: "XML no válido", line: 1, column: 5 },
    },
  },
  {
    ...base,
    kind: "command",
    id: "c4",
    name: "document.serialize",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "response",
    id: "c4",
    name: "document.serialize",
    ok: true,
    payload: { documentId: "d1", svg: "<svg/>", revision: 3 },
  },
  {
    ...base,
    kind: "command",
    id: "c5",
    name: "document.activate",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "response",
    id: "c5",
    name: "document.activate",
    ok: true,
    payload: { documentId: "d1", revision: 3 },
  },
  { ...base, kind: "command", id: "c6", name: "document.close", payload: { documentId: "d1" } },
  {
    ...base,
    kind: "response",
    id: "c6",
    name: "document.close",
    ok: false,
    error: { code: "unknown-document", message: "No existe", relatedId: "c6" },
  },
  {
    ...base,
    kind: "event",
    id: "e1",
    name: "engine.ready",
    payload: { engineVersion: "0.0.0", protocolVersion: PROTOCOL_VERSION },
  },
  {
    ...base,
    kind: "event",
    id: "e2",
    name: "selection.changed",
    payload: { documentId: "d1", items: [{ id: "sol", tagName: "circle" }] },
  },
  {
    ...base,
    kind: "event",
    id: "e3",
    name: "document.changed",
    payload: { documentId: "d1", revision: 4 },
  },
  {
    ...base,
    kind: "event",
    id: "e5",
    name: "files.dropped",
    payload: { count: 2 },
  },
  {
    ...base,
    kind: "event",
    id: "e4",
    name: "error",
    payload: { code: "unknown-message", message: "Mensaje desconocido", relatedId: null },
  },
];

/** Resume un mensaje; comprueba que TypeScript estrecha el payload según kind y name. */
function summarize(message: BridgeMessage): string {
  if (message.kind === "response") {
    if (!message.ok) return `${message.name} falló: ${message.error.code}`;
    switch (message.name) {
      case "app.ping":
        return `ping respondido en ${String(message.payload.receivedAt)}`;
      case "document.load":
        return `cargado: ${String(message.payload.loaded)}, línea ${String(message.payload.error?.line)}`;
      case "document.serialize":
        return `${String(message.payload.svg.length)} caracteres`;
      case "document.activate":
        return `activo en la revisión ${String(message.payload.revision)}`;
      case "document.close":
        return `cerrado ${message.payload.documentId}`;
    }
  }
  if (message.kind === "command") {
    switch (message.name) {
      case "app.ping":
        return `ping enviado en ${String(message.payload.sentAt)}`;
      case "document.load":
        return `cargar ${message.payload.name}`;
      case "document.serialize":
      case "document.activate":
      case "document.close":
        return `${message.name} ${message.payload.documentId}`;
    }
  }
  switch (message.name) {
    case "engine.ready":
      return `motor ${message.payload.engineVersion}`;
    case "selection.changed":
      return `${String(message.payload.items.length)} seleccionados en ${message.payload.documentId}`;
    case "document.changed":
      return `revisión ${String(message.payload.revision)}`;
    case "files.dropped":
      return `${String(message.payload.count)} archivos soltados`;
    case "error":
      return `error ${message.payload.code}`;
  }
}

describe("contrato del puente", () => {
  it("los mensajes sobreviven a JSON sin cambios", () => {
    for (const message of examples) {
      expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    }
  });

  it("estrecha los tipos de cada mensaje", () => {
    expect(examples.map(summarize)).toEqual([
      "ping enviado en 1234.5",
      "ping respondido en 1236",
      "app.ping falló: timeout",
      "cargar logo.svg",
      "cargado: false, línea 1",
      "document.serialize d1",
      "6 caracteres",
      "document.activate d1",
      "activo en la revisión 3",
      "document.close d1",
      "document.close falló: unknown-document",
      "motor 0.0.0",
      "1 seleccionados en d1",
      "revisión 4",
      "2 archivos soltados",
      "error unknown-message",
    ]);
  });

  it("lista todos los nombres de comandos y eventos una sola vez", () => {
    expect(new Set(BRIDGE_COMMAND_NAMES).size).toBe(BRIDGE_COMMAND_NAMES.length);
    expect(new Set(BRIDGE_EVENT_NAMES).size).toBe(BRIDGE_EVENT_NAMES.length);
    const used = new Set(examples.map((m) => m.name));
    for (const name of [...BRIDGE_COMMAND_NAMES, ...BRIDGE_EVENT_NAMES]) {
      expect(used.has(name)).toBe(true);
    }
  });
});
