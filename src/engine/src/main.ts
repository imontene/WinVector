import { version as engineVersion } from "../package.json";
import {
  BridgeCommandError,
  EngineBridge,
  detectTransport,
  type ToolName,
  type ZoomAction,
} from "./bridge";
import {
  applyArtboard,
  DocumentManager,
  readArtboard,
  sameArtboard,
  SvgParseError,
  UnknownDocumentError,
  type ArtboardSettings,
} from "./document";
import type { Rect } from "./geometry";
import { EMPTY_SCENE, Overlay } from "./overlay";
import sampleSvg from "./sample.svg?raw";
import { describeElement, selectionBounds, selectionScreenRect } from "./selection";
import {
  cursorForTool,
  installNavigation,
  installSelectTool,
  installShortcuts,
  trackModifiers,
} from "./tools";
import { gridSpacing, Guides, type Viewport } from "./viewport";

const workspace = document.getElementById("workspace");
if (!workspace) {
  throw new Error("Falta el contenedor #workspace en la página.");
}

const bridge = new EngineBridge(detectTransport(), { engineVersion });
const guides = new Guides(workspace);
const overlay = new Overlay(document.body);
let marquee: Rect | null = null;
let activeTool: ToolName = "select";
/** Ajuste a la cuadrícula: lo usarán las herramientas que mueven y dibujan. */
let snapToGrid = false;
/** Último zoom y última mesa de trabajo anunciados de cada documento, para avisar solo si cambian. */
const announcedZoom = new Map<string, number>();
const announcedArtboard = new Map<string, ArtboardSettings>();

const documents = new DocumentManager(workspace, {
  insets: () => guides.insets,
  onChanged: (documentId, revision) => {
    bridge.emit("document.changed", { documentId, revision });
    // Lo seleccionado puede haber cambiado de tamaño o de sitio.
    if (documents.open(documentId).selection.items.length > 0) emitSelection(documentId);
    announceArtboard(documentId);
    if (documents.active?.id === documentId) refreshOverlay();
  },
  onViewportChanged: (documentId, { zoom }) => {
    if (documents.active?.id === documentId) refreshOverlay();
    if (announcedZoom.get(documentId) !== zoom) announceZoom(documentId, zoom);
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

function announceZoom(documentId: string, zoom: number): void {
  announcedZoom.set(documentId, zoom);
  bridge.emit("viewport.changed", { documentId, zoom });
}

/** Anuncia el tamaño de la mesa de trabajo si es nuevo o ha cambiado. */
function announceArtboard(documentId: string): void {
  const artboard = readArtboard(documents.get(documentId).root);
  const previous = announcedArtboard.get(documentId);
  if (previous && sameArtboard(previous, artboard)) return;
  announcedArtboard.set(documentId, artboard);
  bridge.emit("artboard.changed", { documentId, ...artboard });
}

let overlayFrame = 0;

/** Vuelve a dibujar la capa de superposición, las reglas y la cuadrícula en el siguiente fotograma. */
function refreshOverlay(): void {
  if (overlayFrame !== 0) return;
  overlayFrame = requestAnimationFrame(() => {
    overlayFrame = 0;
    const active = documents.active;
    const items = active?.selection.items ?? [];
    // Los manejadores solo tienen sentido con la herramienta Selección y fuera de un marco.
    const handles =
      active && activeTool === "select" && items.length > 0 && !marquee
        ? selectionScreenRect(items, active.document.root)
        : null;
    overlay.render(
      active ? { ...active.selection.state, marquee, handles } : { ...EMPTY_SCENE, marquee: null },
    );
    guides.render(
      active?.viewport.documentToScreen() ?? null,
      active?.viewport.artboardRect() ?? null,
    );
  });
}

window.addEventListener("resize", () => {
  documents.active?.viewport.resize();
  refreshOverlay();
});

/** Cambia la herramienta activa. Si el cambio viene del lienzo, se avisa a la aplicación. */
function setTool(tool: ToolName, fromCanvas: boolean): void {
  activeTool = tool;
  const cursor = cursorForTool(tool);
  if (cursor) document.body.dataset.cursor = cursor;
  else delete document.body.dataset.cursor;
  if (fromCanvas) bridge.emit("tool.changed", { tool });
  refreshOverlay();
}

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
    announcedArtboard.delete(documentId);
    announcedZoom.delete(documentId);
    announceArtboard(documentId);
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
    // La aplicación vacía la selección al cambiar de pestaña; cada documento conserva la suya, y
    // también su zoom.
    emitSelection(documentId);
    announceZoom(documentId, documents.open(documentId).viewport.zoom);
    refreshOverlay();
    return { documentId, revision };
  }),
);

bridge.handle("document.close", ({ documentId }) =>
  withDocumentErrors(() => {
    documents.close(documentId);
    announcedZoom.delete(documentId);
    announcedArtboard.delete(documentId);
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

function zoom(viewport: Viewport, action: ZoomAction): void {
  if (action === "in") viewport.zoomIn();
  else if (action === "out") viewport.zoomOut();
  else if (action === "fit") viewport.fit();
  else viewport.actualSize();
}

bridge.handle("view.zoom", ({ documentId, action }) =>
  withDocumentErrors(() => {
    const { viewport } = documents.open(documentId);
    zoom(viewport, action);
    return { documentId, zoom: viewport.zoom };
  }),
);

bridge.handle("view.setOptions", (options) => {
  guides.options = { showRulers: options.showRulers, showGrid: options.showGrid };
  snapToGrid = options.snapToGrid;
  // Las reglas ocupan sitio: el documento ajustado a la ventana se vuelve a ajustar.
  documents.active?.viewport.resize();
  refreshOverlay();
  return { ...guides.options, snapToGrid };
});

bridge.handle("tool.select", ({ tool }) => {
  setTool(tool, false);
  return { tool: activeTool };
});

bridge.handle("artboard.set", ({ documentId, width, height, viewBox }) =>
  withDocumentErrors(() => {
    const target = documents.get(documentId);
    applyArtboard(target, { width, height, viewBox });
    return { documentId, ...readArtboard(target.root) };
  }),
);

trackModifiers(window);
installShortcuts(window, {
  undo: () => documents.active?.document.history.undo(),
  redo: () => documents.active?.document.history.redo(),
  zoom: (action) => {
    const viewport = documents.active?.viewport;
    if (viewport) zoom(viewport, action);
  },
  forward: (shortcut) => {
    bridge.emit("keyboard.shortcut", shortcut);
  },
});
installNavigation(window, {
  viewport: () => documents.active?.viewport ?? null,
  tool: () => activeTool,
  setTool: (tool) => {
    setTool(tool, true);
  },
  showMarquee: (rect) => {
    marquee = rect;
    refreshOverlay();
  },
});
installSelectTool(document, {
  active: () => {
    const active = documents.active;
    return active
      ? {
          root: active.document.root,
          selection: active.selection,
          history: active.document.history,
        }
      : null;
  },
  snapSpacing: () => {
    const scale = documents.active?.viewport.documentToScreen()?.a;
    return snapToGrid && scale ? gridSpacing(scale) : null;
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
