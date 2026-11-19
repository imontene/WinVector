// Generado por contracts/tools/generate.mjs a partir de contracts/. No editar a mano:
// modifica los esquemas y ejecuta `npm run contracts:generate` en src/engine.

/** Versión del protocolo del puente. Debe coincidir en la aplicación y en el motor. */
export const PROTOCOL_VERSION = 3;

/** Comando de comprobación enviado por la aplicación. */
export interface AppPing {
  /** Momento del envío en milisegundos desde el epoch Unix, según el reloj de la aplicación. */
  readonly sentAt: number;
}

/** Respuesta del motor a app.ping. */
export interface AppPong {
  /** El mismo valor de sentAt que llegó en el comando. */
  readonly sentAt: number;
  /** Momento en que el motor recibió el comando, en milisegundos desde el epoch Unix. */
  readonly receivedAt: number;
}

/** Tamaño de la mesa de trabajo: los atributos width, height y viewBox del elemento raíz. */
export interface Artboard {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Atributo width tal cual, con sus unidades ("210mm"). Null si no lo tiene. */
  readonly width: string | null;
  /** Atributo height tal cual. Null si no lo tiene. */
  readonly height: string | null;
  /** viewBox. Null si no lo tiene o no es válido. */
  readonly viewBox: Rect | null;
}

/** Error del puente, enviado como evento error o dentro de una respuesta fallida. */
export interface BridgeError {
  readonly code: BridgeErrorCode;
  /** Descripción para registros y diagnóstico. No se muestra tal cual al usuario. */
  readonly message: string;
  /** Identificador del mensaje que causó el error, si se conoce. */
  readonly relatedId: string | null;
}

/** Categoría del error del puente. */
export type BridgeErrorCode =
  | "invalid-message"
  | "unknown-message"
  | "protocol-mismatch"
  | "unknown-document"
  | "timeout"
  | "internal";

/** Texto de un documento para guardarlo. */
export interface DocumentContent {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Texto completo del SVG. */
  readonly svg: string;
  /** Revisión a la que corresponde el texto. */
  readonly revision: number;
}

/** Documento que la aplicación entrega al motor. */
export interface DocumentLoad {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Nombre que se muestra en la pestaña, por ejemplo el nombre del archivo. */
  readonly name: string;
  /** Texto completo del archivo SVG. */
  readonly svg: string;
}

/** Resultado de cargar un documento. */
export interface DocumentLoadResult {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** true si el documento se cargó. */
  readonly loaded: boolean;
  /** Revisión inicial del documento (0). */
  readonly revision: number;
  /** true si al guardar se conservará el formato original de todo lo que no cambie. */
  readonly exactMapping: boolean;
  /** Por qué no se cargó, si loaded es false. */
  readonly error: DocumentParseError | null;
}

/** Por qué no se pudo cargar un documento. */
export interface DocumentParseError {
  /** Descripción del problema para mostrar al usuario. */
  readonly message: string;
  /** Línea del error en el texto, empezando en 1, si se conoce. */
  readonly line: number | null;
  /** Columna del error, empezando en 1, si se conoce. */
  readonly column: number | null;
}

/** Referencia a un documento abierto en el motor. */
export interface DocumentRef {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
}

/** Estado de un documento. */
export interface DocumentState {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Identifica el estado del documento: cambia con cada edición y, al deshacer o rehacer, vuelve a la de ese estado. */
  readonly revision: number;
}

/** Datos que el motor envía al terminar de cargar. */
export interface EngineReady {
  /** Versión del motor de edición. */
  readonly engineVersion: string;
  /** Versión del protocolo con la que se compiló el motor. */
  readonly protocolVersion: number;
}

/** Archivos soltados sobre el lienzo. */
export interface FilesDropped {
  /** Número de archivos soltados. */
  readonly count: number;
}

/** Estado del historial de deshacer de un documento. */
export interface HistoryState {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Hay algún paso que deshacer. */
  readonly canUndo: boolean;
  /** Hay algún paso que rehacer. */
  readonly canRedo: boolean;
  /** Acción que se desharía (move, edit…); la aplicación la traduce. Null si no hay nada que deshacer. */
  readonly undoAction: string | null;
  /** Acción que se reharía. Null si no hay nada que rehacer. */
  readonly redoAction: string | null;
}

/** Rectángulo alineado con los ejes. */
export interface Rect {
  /** Borde izquierdo. */
  readonly x: number;
  /** Borde superior. */
  readonly y: number;
  /** Ancho. */
  readonly width: number;
  /** Alto. */
  readonly height: number;
}

/** Un elemento SVG seleccionado. */
export interface SelectedElement {
  /** Valor del atributo id, o null si el elemento no tiene. */
  readonly id: string | null;
  /** Nombre local del elemento, por ejemplo circle o path. */
  readonly tagName: string;
}

/** Estado completo de la selección tras un cambio. */
export interface SelectionChanged {
  /** Documento al que pertenece la selección. */
  readonly documentId: string;
  /** Elementos seleccionados, en orden de documento. Vacío si no hay selección. */
  readonly items: readonly SelectedElement[];
  /** Caja que rodea todo lo seleccionado, en unidades de usuario del elemento raíz del documento (las del viewBox). Null si no hay selección o no se puede medir. */
  readonly bounds: Rect | null;
  /** Grupo en el que ha entrado el usuario con doble clic; la selección con un clic elige entre sus hijos. Null en el nivel superior del documento. */
  readonly scope: SelectedElement | null;
}

/** Herramienta del lienzo que ya implementa el motor. */
export type ToolName = "select" | "hand" | "zoom";

/** Herramienta activa del lienzo. */
export interface ToolState {
  /** Herramienta. */
  readonly tool: ToolName;
}

/** Guías del lienzo; valen para todos los documentos. */
export interface ViewOptions {
  /** Muestra las reglas en las unidades del documento. */
  readonly showRulers: boolean;
  /** Muestra la cuadrícula sobre la mesa de trabajo. */
  readonly showGrid: boolean;
  /** Ajusta a la cuadrícula visible al dibujar y mover. */
  readonly snapToGrid: boolean;
}

/** Zoom de un documento. */
export interface ViewportChanged {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** 1 es el 100 %: una unidad de tamaño del documento ocupa un píxel. */
  readonly zoom: number;
}

/** Cambia el zoom de un documento. */
export interface ViewZoom {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Acercar, alejar, ajustar a la ventana o tamaño real. */
  readonly action: ZoomAction;
}

/** Orden de zoom del menú Ver. */
export type ZoomAction = "in" | "out" | "fit" | "actual";

/** Comandos que la aplicación envía al motor, con el tipo de su payload y de su respuesta. */
export interface BridgeCommands {
  /** Comprueba que el motor responde y mide la latencia del puente. */
  readonly "app.ping": { readonly payload: AppPing; readonly response: AppPong };
  /** Selecciona todos los objetos del grupo en el que está el usuario, o del documento si no ha entrado en ninguno. */
  readonly "selection.selectAll": { readonly payload: DocumentRef; readonly response: DocumentRef };
  /** Carga un documento SVG en el motor con el identificador que le asigna la aplicación. */
  readonly "document.load": {
    readonly payload: DocumentLoad;
    readonly response: DocumentLoadResult;
  };
  /** Devuelve el SVG de un documento listo para guardarlo. */
  readonly "document.serialize": {
    readonly payload: DocumentRef;
    readonly response: DocumentContent;
  };
  /** Muestra un documento en el lienzo; los demás quedan ocultos. */
  readonly "document.activate": { readonly payload: DocumentRef; readonly response: DocumentState };
  /** Descarta un documento del motor. */
  readonly "document.close": { readonly payload: DocumentRef; readonly response: DocumentRef };
  /** Deshace el último paso del historial de un documento. Si no hay nada que deshacer, no cambia nada. */
  readonly "history.undo": { readonly payload: DocumentRef; readonly response: HistoryState };
  /** Rehace el último paso deshecho de un documento. Si no hay nada que rehacer, no cambia nada. */
  readonly "history.redo": { readonly payload: DocumentRef; readonly response: HistoryState };
  /** Acerca, aleja, ajusta a la ventana o muestra a tamaño real un documento. Responde con el zoom resultante. */
  readonly "view.zoom": { readonly payload: ViewZoom; readonly response: ViewportChanged };
  /** Muestra u oculta las reglas y la cuadrícula y activa el ajuste a la cuadrícula. */
  readonly "view.setOptions": { readonly payload: ViewOptions; readonly response: ViewOptions };
  /** Cambia la herramienta activa del lienzo. */
  readonly "tool.select": { readonly payload: ToolState; readonly response: ToolState };
  /** Cambia el tamaño de la mesa de trabajo de un documento. Se puede deshacer. */
  readonly "artboard.set": { readonly payload: Artboard; readonly response: Artboard };
}

/** Eventos que el motor envía a la aplicación, con el tipo de su payload. */
export interface BridgeEvents {
  /** El motor ha cargado y puede recibir comandos. */
  readonly "engine.ready": EngineReady;
  /** La selección del documento ha cambiado. */
  readonly "selection.changed": SelectionChanged;
  /** El motor ha recibido un mensaje que no puede procesar o ha sufrido un error interno. */
  readonly error: BridgeError;
  /** Un documento ha cambiado. La revisión identifica su estado: cambia con cada edición y, al deshacer o rehacer, vuelve a la de ese estado. */
  readonly "document.changed": DocumentState;
  /** El usuario ha soltado archivos sobre el lienzo. Los archivos viajan como objetos adicionales del mensaje de WebView2, con su ruta. */
  readonly "files.dropped": FilesDropped;
  /** Ha cambiado el historial de deshacer de un documento. */
  readonly "history.changed": HistoryState;
  /** Ha cambiado el zoom de un documento. */
  readonly "viewport.changed": ViewportChanged;
  /** La herramienta activa ha cambiado desde el lienzo (por ejemplo, con su atajo de teclado). */
  readonly "tool.changed": ToolState;
  /** El tamaño de la mesa de trabajo de un documento es nuevo o ha cambiado (también al cargarlo). */
  readonly "artboard.changed": Artboard;
}

export type BridgeCommandName = keyof BridgeCommands;
export type BridgeEventName = keyof BridgeEvents;

export const BRIDGE_COMMAND_NAMES: readonly BridgeCommandName[] = [
  "app.ping",
  "selection.selectAll",
  "document.load",
  "document.serialize",
  "document.activate",
  "document.close",
  "history.undo",
  "history.redo",
  "view.zoom",
  "view.setOptions",
  "tool.select",
  "artboard.set",
];
export const BRIDGE_EVENT_NAMES: readonly BridgeEventName[] = [
  "engine.ready",
  "selection.changed",
  "error",
  "document.changed",
  "files.dropped",
  "history.changed",
  "viewport.changed",
  "tool.changed",
  "artboard.changed",
];

/** Campos comunes a todos los mensajes. */
export interface BridgeEnvelopeBase {
  /** Identificador único del mensaje. En una respuesta, el del comando al que responde. */
  readonly id: string;
  readonly protocolVersion: number;
}

export type BridgeCommandMessage<N extends BridgeCommandName = BridgeCommandName> = {
  [K in N]: BridgeEnvelopeBase & {
    readonly kind: "command";
    readonly name: K;
    readonly payload: BridgeCommands[K]["payload"];
  };
}[N];

export type BridgeEventMessage<N extends BridgeEventName = BridgeEventName> = {
  [K in N]: BridgeEnvelopeBase & {
    readonly kind: "event";
    readonly name: K;
    readonly payload: BridgeEvents[K];
  };
}[N];

export type BridgeResponseMessage<N extends BridgeCommandName = BridgeCommandName> = {
  [K in N]: BridgeEnvelopeBase & {
    readonly kind: "response";
    readonly name: K;
  } & (
      | { readonly ok: true; readonly payload: BridgeCommands[K]["response"] }
      | { readonly ok: false; readonly error: BridgeError }
    );
}[N];

export type BridgeMessage = BridgeCommandMessage | BridgeEventMessage | BridgeResponseMessage;
