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
    payload: {
      documentId: "d1",
      items: [{ id: "sol", tagName: "circle" }],
      bounds: { x: 248, y: 44, width: 104, height: 104 },
      scope: { id: "fondo", tagName: "g" },
    },
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
    kind: "command",
    id: "c8",
    name: "selection.selectAll",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "command",
    id: "c6",
    name: "history.undo",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "response",
    id: "c7",
    name: "history.redo",
    ok: true,
    payload: {
      documentId: "d1",
      canUndo: true,
      canRedo: false,
      undoAction: "move",
      redoAction: null,
    },
  },
  {
    ...base,
    kind: "event",
    id: "e6",
    name: "history.changed",
    payload: {
      documentId: "d1",
      canUndo: false,
      canRedo: true,
      undoAction: null,
      redoAction: "move",
    },
  },
  {
    ...base,
    kind: "command",
    id: "c9",
    name: "view.zoom",
    payload: { documentId: "d1", action: "fit" },
  },
  {
    ...base,
    kind: "response",
    id: "c9",
    name: "view.zoom",
    ok: true,
    payload: { documentId: "d1", zoom: 1.5 },
  },
  {
    ...base,
    kind: "command",
    id: "c10",
    name: "view.setOptions",
    payload: { showRulers: true, showGrid: false, snapToGrid: false },
  },
  {
    ...base,
    kind: "command",
    id: "c11",
    name: "tool.select",
    payload: { tool: "hand" },
  },
  {
    ...base,
    kind: "command",
    id: "c12",
    name: "artboard.set",
    payload: {
      documentId: "d1",
      width: "210mm",
      height: null,
      viewBox: { x: 0, y: 0, width: 210, height: 297 },
    },
  },
  {
    ...base,
    kind: "event",
    id: "e7",
    name: "viewport.changed",
    payload: { documentId: "d1", zoom: 2 },
  },
  {
    ...base,
    kind: "event",
    id: "e8",
    name: "tool.changed",
    payload: { tool: "zoom" },
  },
  {
    ...base,
    kind: "event",
    id: "e9",
    name: "artboard.changed",
    payload: { documentId: "d1", width: null, height: "100", viewBox: null },
  },
  {
    ...base,
    kind: "event",
    id: "e10",
    name: "keyboard.shortcut",
    payload: { key: "s", ctrlKey: true, shiftKey: false, altKey: false },
  },
  {
    ...base,
    kind: "command",
    id: "c13",
    name: "selection.setGeometry",
    payload: { documentId: "d1", x: 10, y: null, width: null, height: null, rotation: 45 },
  },
  {
    ...base,
    kind: "command",
    id: "c14",
    name: "object.arrange",
    payload: { documentId: "d1", action: "front" },
  },
  {
    ...base,
    kind: "command",
    id: "c16",
    name: "object.group",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "response",
    id: "c15",
    name: "object.ungroup",
    ok: true,
    payload: { documentId: "d1", changed: false },
  },
  {
    ...base,
    kind: "command",
    id: "c17",
    name: "clipboard.paste",
    payload: { documentId: "d1", svg: "<svg/>" },
  },
  {
    ...base,
    kind: "response",
    id: "c18",
    name: "clipboard.copy",
    ok: true,
    payload: { documentId: "d1", svg: null },
  },
  {
    ...base,
    kind: "command",
    id: "c19",
    name: "selection.duplicate",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "command",
    id: "c20",
    name: "selection.delete",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "response",
    id: "c21",
    name: "clipboard.paste",
    ok: true,
    payload: { documentId: "d1", count: 2 },
  },
  {
    ...base,
    kind: "command",
    id: "c22",
    name: "selection.setStyle",
    payload: {
      documentId: "d1",
      fill: "#ff0000",
      stroke: null,
      strokeWidth: null,
      opacity: 0.5,
      fillRule: "evenodd",
    },
  },
  {
    ...base,
    kind: "command",
    id: "c23",
    name: "selection.setShape",
    payload: { documentId: "d1", r: 12, sides: 6 },
  },
  {
    ...base,
    kind: "command",
    id: "c24",
    name: "object.toPath",
    payload: { documentId: "d1" },
  },
  {
    ...base,
    kind: "event",
    id: "e5",
    name: "shape.converted",
    payload: { documentId: "d1", from: "star" },
  },
  {
    ...base,
    kind: "event",
    id: "e6",
    name: "canvas.contextMenu",
    payload: { documentId: "d1", x: 10, y: 20, keyboard: false, canEditVertices: true },
  },
  {
    ...base,
    kind: "command",
    id: "c25",
    name: "path.nodes",
    payload: { documentId: "d1", action: "smooth" },
  },
  {
    ...base,
    kind: "command",
    id: "c26",
    name: "path.operation",
    payload: { documentId: "d1", operation: "combine" },
  },
  {
    ...base,
    kind: "command",
    id: "c27",
    name: "path.cornerRadius",
    payload: { documentId: "d1", radius: 4.5 },
  },
  {
    ...base,
    kind: "event",
    id: "e8",
    name: "text.locked",
    payload: { documentId: "d1", reason: "text-path" },
  },
  {
    ...base,
    kind: "event",
    id: "e7",
    name: "nodes.changed",
    payload: {
      documentId: "d1",
      count: 2,
      kind: "mixed",
      canSmooth: true,
      canMakeLine: false,
      canMakeCurve: true,
      canRound: true,
      cornerRadius: 3,
    },
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
      case "selection.selectAll":
      case "selection.setGeometry":
        return `${message.name} ${message.payload.documentId}`;
      case "object.arrange":
      case "object.group":
      case "object.ungroup":
      case "object.toPath":
      case "path.nodes":
      case "path.operation":
      case "path.cornerRadius":
      case "selection.duplicate":
      case "selection.delete":
      case "selection.setStyle":
      case "selection.setShape":
        return `cambió: ${String(message.payload.changed)}`;
      case "clipboard.copy":
        return `copiado: ${String(message.payload.svg?.length)}`;
      case "clipboard.paste":
        return `pegados: ${String(message.payload.count)}`;
      case "history.undo":
      case "history.redo":
        return `deshacer: ${String(message.payload.undoAction)}`;
      case "view.zoom":
        return `zoom ${String(message.payload.zoom)}`;
      case "view.setOptions":
        return `reglas: ${String(message.payload.showRulers)}`;
      case "tool.select":
        return `herramienta ${message.payload.tool}`;
      case "artboard.set":
        return `ancho ${String(message.payload.width)}`;
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
      case "selection.selectAll":
      case "history.undo":
      case "history.redo":
        return `${message.name} ${message.payload.documentId}`;
      case "selection.setGeometry":
        return `geometría x=${String(message.payload.x)}`;
      case "object.arrange":
        return `ordenar ${message.payload.action}`;
      case "path.nodes":
        return `nodos ${message.payload.action}`;
      case "path.operation":
        return `trazado ${message.payload.operation}`;
      case "path.cornerRadius":
        return `radio ${String(message.payload.radius)}`;
      case "object.group":
      case "object.ungroup":
      case "object.toPath":
      case "selection.duplicate":
      case "selection.delete":
      case "clipboard.copy":
        return `${message.name} ${message.payload.documentId}`;
      case "clipboard.paste":
        return `pegar ${String(message.payload.svg.length)}`;
      case "selection.setStyle":
        return `relleno ${String(message.payload.fill)}`;
      case "selection.setShape":
        return `forma r=${String(message.payload.r)}`;
      case "view.zoom":
        return `zoom ${message.payload.action}`;
      case "view.setOptions":
        return `cuadrícula: ${String(message.payload.showGrid)}`;
      case "tool.select":
        return `elegir ${message.payload.tool}`;
      case "artboard.set":
        return `viewBox ${String(message.payload.viewBox?.width)}`;
    }
  }
  switch (message.name) {
    case "engine.ready":
      return `motor ${message.payload.engineVersion}`;
    case "shape.converted":
      return `${message.payload.from} pasa a polígono`;
    case "text.locked":
      return `texto bloqueado: ${message.payload.reason}`;
    case "nodes.changed":
      return `${String(message.payload.count)} nodos ${String(message.payload.kind)}`;
    case "canvas.contextMenu":
      return `menú en ${String(message.payload.x)},${String(message.payload.y)}`;
    case "selection.changed":
      return `${String(message.payload.items.length)} seleccionados en ${message.payload.documentId}, dentro de ${String(message.payload.scope?.id)}`;
    case "document.changed":
      return `revisión ${String(message.payload.revision)}`;
    case "files.dropped":
      return `${String(message.payload.count)} archivos soltados`;
    case "history.changed":
      return `se puede deshacer: ${String(message.payload.canUndo)}`;
    case "viewport.changed":
      return `zoom ${String(message.payload.zoom)}`;
    case "tool.changed":
      return `herramienta ${message.payload.tool}`;
    case "artboard.changed":
      return `alto ${String(message.payload.height)}`;
    case "keyboard.shortcut":
      return `atajo ${message.payload.ctrlKey ? "Ctrl+" : ""}${message.payload.key}`;
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
      "1 seleccionados en d1, dentro de fondo",
      "revisión 4",
      "2 archivos soltados",
      "selection.selectAll d1",
      "history.undo d1",
      "deshacer: move",
      "se puede deshacer: false",
      "zoom fit",
      "zoom 1.5",
      "cuadrícula: false",
      "elegir hand",
      "viewBox 210",
      "zoom 2",
      "herramienta zoom",
      "alto 100",
      "atajo Ctrl+s",
      "geometría x=10",
      "ordenar front",
      "object.group d1",
      "cambió: false",
      "pegar 6",
      "copiado: undefined",
      "selection.duplicate d1",
      "selection.delete d1",
      "pegados: 2",
      "relleno #ff0000",
      "forma r=12",
      "object.toPath d1",
      "star pasa a polígono",
      "menú en 10,20",
      "nodos smooth",
      "trazado combine",
      "radio 4.5",
      "texto bloqueado: text-path",
      "2 nodos mixed",
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
