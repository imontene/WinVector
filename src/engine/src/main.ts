import { version as engineVersion } from "../package.json";
import { BridgeCommandError, EngineBridge, detectTransport } from "./bridge";
import { DocumentManager, SvgParseError, UnknownDocumentError } from "./document";
import type { Rect } from "./geometry";
import { EMPTY_SCENE, Overlay } from "./overlay";
import sampleSvg from "./sample.svg?raw";
import { describeElement, selectionBounds } from "./selection";
import { installSelectTool } from "./tools";

const workspace = document.getElementById("workspace");
if (!workspace) {
  throw new Error("Falta el contenedor #workspace en la página.");
}

const bridge = new EngineBridge(detectTransport(), { engineVersion });
const overlay = new Overlay(document.body);
let marquee: Rect | null = null;

const documents = new DocumentManager(workspace, {
  onChanged: (documentId, revision) => {
    bridge.emit("document.changed", { documentId, revision });
    // Lo seleccionado puede haber cambiado de tamaño o de sitio.
    if (documents.open(documentId).selection.items.length > 0) emitSelection(documentId);
    if (documents.active?.id === documentId) refreshOverlay();
  },
  onHistoryChanged: (documentId, state) => {
    bridge.emit("history.changed", { documentId, ...state });
  },
  onSelectionChanged: (documentId) => {
    emitSelection(documentId);
    if (documents.active?.id === documentId) refreshOverlay();
  },
});

/** Anuncia a la aplicación la selección de un documento, con su caja y el grupo en el que se está. */
function emitSelection(documentId: string): void {
  const { document: target, selection } = documents.open(documentId);
  const { items, scope } = selection.state;
  bridge.emit("selection.changed", {
    documentId,
    items: items.map(describeElement),
    bounds: selectionBounds(items, target.root),
    scope: scope ? describeElement(scope) : null,
  });
}

let overlayFrame = 0;

/** Vuelve a dibujar la capa de superposición en el siguiente fotograma. */
function refreshOverlay(): void {
  if (overlayFrame !== 0) return;
  overlayFrame = requestAnimationFrame(() => {
    overlayFrame = 0;
    const active = documents.active;
    overlay.render(
      active ? { ...active.selection.state, marquee } : { ...EMPTY_SCENE, marquee: null },
    );
  });
}

window.addEventListener("resize", refreshOverlay);

/** Traduce los errores de documento a los códigos del contrato. */
function withDocumentErrors<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof UnknownDocumentError) {
      throw new BridgeCommandError("unknown-document", error.message);
    }
    throw error;
  }
}

bridge.handle("app.ping", ({ sentAt }) => ({ sentAt, receivedAt: Date.now() }));

bridge.handle("document.load", ({ documentId, name, svg }) => {
  try {
    const loaded = documents.load(documentId, name, svg);
    return {
      documentId,
      loaded: true,
      revision: loaded.revision,
      exactMapping: loaded.hasExactMapping,
      error: null,
    };
  } catch (error) {
    if (!(error instanceof SvgParseError)) throw error;
    return {
      documentId,
      loaded: false,
      revision: 0,
      exactMapping: false,
      error: { message: error.message, line: error.line, column: error.column },
    };
  }
});

bridge.handle("document.serialize", ({ documentId }) =>
  withDocumentErrors(() => {
    const target = documents.get(documentId);
    return { documentId, svg: target.serialize(), revision: target.revision };
  }),
);

bridge.handle("document.activate", ({ documentId }) =>
  withDocumentErrors(() => {
    const { revision } = documents.activate(documentId);
    // La aplicación vacía la selección al cambiar de pestaña; cada documento conserva la suya.
    emitSelection(documentId);
    refreshOverlay();
    return { documentId, revision };
  }),
);

bridge.handle("document.close", ({ documentId }) =>
  withDocumentErrors(() => {
    documents.close(documentId);
    refreshOverlay();
    return { documentId };
  }),
);

bridge.handle("selection.selectAll", ({ documentId }) =>
  withDocumentErrors(() => {
    documents.open(documentId).selection.selectAll();
    return { documentId };
  }),
);

bridge.handle("history.undo", ({ documentId }) =>
  withDocumentErrors(() => {
    const { history } = documents.get(documentId);
    history.undo();
    return { documentId, ...history.state };
  }),
);

bridge.handle("history.redo", ({ documentId }) =>
  withDocumentErrors(() => {
    const { history } = documents.get(documentId);
    history.redo();
    return { documentId, ...history.state };
  }),
);

installSelectTool(document, {
  active: () => {
    const active = documents.active;
    return active ? { root: active.document.root, selection: active.selection } : null;
  },
  showMarquee: (rect) => {
    marquee = rect;
    refreshOverlay();
  },
});

// Archivos arrastrados al lienzo: el navegador no debe abrirlos como página. Se pasan a la aplicación,
// que recibe su ruta real con los objetos adicionales del mensaje de WebView2.
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("drop", (event) => {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  bridge.emit("files.dropped", { count: files.length }, files);
});

// Sin aplicación (npm run dev en un navegador), el motor abre por su cuenta el documento de ejemplo.
if (!window.chrome?.webview) {
  documents.load("ejemplo", "Ejemplo", sampleSvg);
  documents.activate("ejemplo");
}

bridge.start();
