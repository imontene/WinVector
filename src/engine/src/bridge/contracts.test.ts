import { describe, expect, it } from "vitest";
import {
  BRIDGE_COMMAND_NAMES,
  BRIDGE_EVENT_NAMES,
  PROTOCOL_VERSION,
  type BridgeMessage,
} from "./generated/contracts";

// Un ejemplo de cada forma de mensaje. Si el contrato cambia (por ejemplo, un campo obligatorio
// nuevo), este archivo deja de compilar hasta que se actualice, igual que el resto del motor.
const examples: readonly BridgeMessage[] = [
  {
    kind: "command",
    id: "c1",
    name: "app.ping",
    protocolVersion: PROTOCOL_VERSION,
    payload: { sentAt: 1234.5 },
  },
  {
    kind: "response",
    id: "c1",
    name: "app.ping",
    protocolVersion: PROTOCOL_VERSION,
    ok: true,
    payload: { sentAt: 1234.5, receivedAt: 1236 },
  },
  {
    kind: "response",
    id: "c2",
    name: "app.ping",
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    error: { code: "timeout", message: "Sin respuesta", relatedId: "c2" },
  },
  {
    kind: "event",
    id: "e1",
    name: "engine.ready",
    protocolVersion: PROTOCOL_VERSION,
    payload: { engineVersion: "0.0.0", protocolVersion: PROTOCOL_VERSION },
  },
  {
    kind: "event",
    id: "e2",
    name: "selection.changed",
    protocolVersion: PROTOCOL_VERSION,
    payload: { items: [{ id: "sol", tagName: "circle" }] },
  },
  {
    kind: "event",
    id: "e3",
    name: "error",
    protocolVersion: PROTOCOL_VERSION,
    payload: { code: "unknown-message", message: "Mensaje desconocido", relatedId: null },
  },
];

/** Resume un mensaje; comprueba que TypeScript estrecha el payload según kind y name. */
function summarize(message: BridgeMessage): string {
  switch (message.kind) {
    case "command":
      return `${message.name} enviado en ${String(message.payload.sentAt)}`;
    case "response":
      return message.ok
        ? `${message.name} respondido en ${String(message.payload.receivedAt)}`
        : `${message.name} falló: ${message.error.code}`;
    case "event":
      switch (message.name) {
        case "engine.ready":
          return `motor ${message.payload.engineVersion}`;
        case "selection.changed":
          return `${String(message.payload.items.length)} seleccionados`;
        case "error":
          return `error ${message.payload.code}`;
      }
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
      "app.ping enviado en 1234.5",
      "app.ping respondido en 1236",
      "app.ping falló: timeout",
      "motor 0.0.0",
      "1 seleccionados",
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
