// Generado por contracts/tools/generate.mjs a partir de contracts/. No editar a mano:
// modifica los esquemas y ejecuta `npm run contracts:generate` en src/engine.

/** Versión del protocolo del puente. Debe coincidir en la aplicación y en el motor. */
export const PROTOCOL_VERSION = 2;

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
  /** Aumenta con cada cambio del documento. */
  readonly revision: number;
}

/** Datos que el motor envía al terminar de cargar. */
export interface EngineReady {
  /** Versión del motor de edición. */
  readonly engineVersion: string;
  /** Versión del protocolo con la que se compiló el motor. */
  readonly protocolVersion: number;
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
}

/** Comandos que la aplicación envía al motor, con el tipo de su payload y de su respuesta. */
export interface BridgeCommands {
  /** Comprueba que el motor responde y mide la latencia del puente. */
  readonly "app.ping": { readonly payload: AppPing; readonly response: AppPong };
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
}

/** Eventos que el motor envía a la aplicación, con el tipo de su payload. */
export interface BridgeEvents {
  /** El motor ha cargado y puede recibir comandos. */
  readonly "engine.ready": EngineReady;
  /** La selección del documento ha cambiado. */
  readonly "selection.changed": SelectionChanged;
  /** El motor ha recibido un mensaje que no puede procesar o ha sufrido un error interno. */
  readonly error: BridgeError;
  /** Un documento ha cambiado. La revisión aumenta con cada cambio. */
  readonly "document.changed": DocumentState;
}

export type BridgeCommandName = keyof BridgeCommands;
export type BridgeEventName = keyof BridgeEvents;

export const BRIDGE_COMMAND_NAMES: readonly BridgeCommandName[] = [
  "app.ping",
  "document.load",
  "document.serialize",
  "document.activate",
  "document.close",
];
export const BRIDGE_EVENT_NAMES: readonly BridgeEventName[] = [
  "engine.ready",
  "selection.changed",
  "error",
  "document.changed",
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
