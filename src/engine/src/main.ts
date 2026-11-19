import { version as engineVersion } from "../package.json";
import { BridgeCommandError, EngineBridge, detectTransport } from "./bridge";
import { DocumentManager, SvgParseError, UnknownDocumentError } from "./document";
import sampleSvg from "./sample.svg?raw";
import { describeElement, selectableElementAt } from "./selection";

const workspace = document.getElementById("workspace");
if (!workspace) {
  throw new Error("Falta el contenedor #workspace en la página.");
}

const bridge = new EngineBridge(detectTransport(), { engineVersion });
const documents = new DocumentManager(workspace, {
  onChanged: (documentId, revision) => {
    bridge.emit("document.changed", { documentId, revision });
  },
  onHistoryChanged: (documentId, state) => {
    bridge.emit("history.changed", { documentId, ...state });
  },
});

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
  withDocumentErrors(() => ({ documentId, revision: documents.activate(documentId).revision })),
);

bridge.handle("document.close", ({ documentId }) =>
  withDocumentErrors(() => {
    documents.close(documentId);
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

// Fase 0: un clic selecciona un elemento; un clic en el fondo vacía la selección.
// El documento está en un shadow root: el destino real del evento es el primero de composedPath().
document.addEventListener("pointerdown", (event) => {
  const active = documents.active;
  if (event.button !== 0 || !active) return;
  const element = selectableElementAt(event.composedPath()[0] ?? null, active.document.root);
  bridge.emit("selection.changed", {
    documentId: active.id,
    items: element ? [describeElement(element)] : [],
  });
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
