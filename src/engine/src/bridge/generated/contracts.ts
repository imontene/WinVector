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

/** Cambio del orden de apilado. */
export type ArrangeAction = "front" | "back" | "forward" | "backward";

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

/** La selección como SVG independiente, para el portapapeles. */
export interface ClipboardContent {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Texto del SVG con los objetos y las definiciones que usan, o null si no hay nada seleccionado. */
  readonly svg: string | null;
}

/** SVG del portapapeles para pegar en un documento. */
export interface ClipboardPaste {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Texto del SVG, de WinVector o de otra aplicación. */
  readonly svg: string;
}

/** Resultado de pegar. */
export interface ClipboardPasteResult {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Objetos pegados; 0 si el texto no era un SVG con algo que pegar. */
  readonly count: number;
}

/** Petición de abrir el menú contextual del lienzo. El motor ya ha seleccionado lo que había bajo el puntero. */
export interface ContextMenuRequest {
  /** Documento visible. */
  readonly documentId: string;
  /** Posición horizontal del menú en el lienzo, en píxeles independientes del dispositivo desde su esquina superior izquierda. */
  readonly x: number;
  /** Posición vertical del menú en el lienzo, en píxeles independientes del dispositivo. */
  readonly y: number;
  /** True si se pidió con el teclado (Mayús+F10 o la tecla de menú): el menú se abre junto a la selección. */
  readonly keyboard: boolean;
  /** True si lo seleccionado es una sola forma que se puede editar por vértices. */
  readonly canEditVertices: boolean;
}

/** Radio de las esquinas seleccionadas con la herramienta Vértices: se redondean con arcos exactos, limitados a lo que cabe en cada una. 0 quita el redondeo. */
export interface CornerRadiusChange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Radio en unidades de la forma, 0 o más. */
  readonly radius: number;
}

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

/** Regla de relleno: qué zonas de un trazado que se corta a sí mismo, o con subtrazados unos dentro de otros, se rellenan. evenodd deja agujeros donde se superponen. */
export type FillRule = "nonzero" | "evenodd";

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

/** Atajo de teclado pulsado con el lienzo enfocado que el motor no atiende. */
export interface KeyboardShortcut {
  /** Tecla, como KeyboardEvent.key en minúsculas ("s", "n", "f4"). */
  readonly key: string;
  /** Ctrl pulsado. */
  readonly ctrlKey: boolean;
  /** Mayús pulsado. */
  readonly shiftKey: boolean;
  /** Alt pulsado. */
  readonly altKey: boolean;
}

/** Cambio sobre los nodos seleccionados de un trazado: hacerlos esquina, suaves o simétricos, o hacer rectos o curvos los segmentos que hay entre ellos. */
export type NodeAction = "corner" | "smooth" | "symmetric" | "line" | "curve";

/** Tipo de los nodos seleccionados: esquina, suave, simétrico o mixed si son de varios tipos. */
export type NodeKind = "corner" | "smooth" | "symmetric" | "mixed";

/** Nodos seleccionados de la forma que se edita con la herramienta Vértices: los nodos de un trazado o los vértices de un polígono. Sin forma o sin nodos seleccionados, count es 0. */
export interface NodeSelection {
  /** Documento del trazado. */
  readonly documentId: string;
  /** Número de nodos seleccionados. */
  readonly count: number;
  /** Tipo común de los nodos seleccionados que tienen dos lados; ausente si ninguno los tiene. */
  readonly kind?: NodeKind;
  /** Algún nodo seleccionado tiene dos lados y puede ser suave o simétrico. */
  readonly canSmooth: boolean;
  /** Algún segmento entre dos nodos seleccionados no es recto. */
  readonly canMakeLine: boolean;
  /** Algún segmento entre dos nodos seleccionados no es una curva cúbica. */
  readonly canMakeCurve: boolean;
  /** Alguna esquina seleccionada está entre dos rectas y se puede redondear. */
  readonly canRound?: boolean;
  /** Radio común de las esquinas seleccionadas que se pueden redondear; ausente si son distintos o no hay ninguna. */
  readonly cornerRadius?: number;
}

/** Cambia el orden de apilado de la selección. */
export interface ObjectArrange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Al frente, al fondo, un nivel arriba o un nivel abajo. */
  readonly action: ArrangeAction;
}

/** Resultado de una operación sobre la selección. */
export interface ObjectChange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** False si no había nada que cambiar (por ejemplo, un grupo que no se puede desagrupar sin cambiar su aspecto). */
  readonly changed: boolean;
}

/** Cambia el tipo de los nodos seleccionados con la herramienta Vértices, o el de los segmentos entre ellos. */
export interface PathNodesChange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Qué hacer con los nodos o los segmentos. */
  readonly action: NodeAction;
}

/** Operación del menú Trazado sobre la selección. */
export interface PathOperation {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Qué hacer con los trazados seleccionados. */
  readonly operation: PathOperationKind;
}

/** Operación del menú Trazado: cerrar o abrir los trazados, invertir su dirección, combinar varios en uno o separar uno en sus subtrazados. */
export type PathOperationKind = "close" | "open" | "reverse" | "combine" | "separate";

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
  /** Giro del objeto seleccionado respecto al documento, en grados entre -180 y 180. Solo cuando hay un único objeto seleccionado. */
  readonly rotation?: number;
  /** Estilo de la selección; solo cuando hay algo seleccionado. */
  readonly style?: SelectionStyle;
  /** Propiedades propias de la forma; solo con un único objeto seleccionado que sea una forma (rectángulo, elipse, círculo, línea, polígono o estrella de WinVector). */
  readonly shape?: ShapeProperties;
}

/** Posición, tamaño y giro que se quieren para la selección, en unidades del documento. Un campo null no cambia. */
export interface SelectionGeometry {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Borde izquierdo de la caja de la selección. */
  readonly x: number | null;
  /** Borde superior de la caja de la selección. */
  readonly y: number | null;
  /** Ancho de la caja de la selección; mayor que 0. */
  readonly width: number | null;
  /** Alto de la caja de la selección; mayor que 0. */
  readonly height: number | null;
  /** Giro en grados. Solo se aplica con un único objeto seleccionado. */
  readonly rotation: number | null;
}

/** Estilo calculado de la selección, venga de atributos, de CSS o de los grupos. null: los objetos tienen valores distintos. */
export interface SelectionStyle {
  /** Relleno: "none", un color "#rrggbb" o "url" (degradado o patrón). */
  readonly fill: string | null;
  /** Trazo: "none", "#rrggbb" o "url". */
  readonly stroke: string | null;
  /** Grosor del trazo en unidades del elemento. */
  readonly strokeWidth: number | null;
  /** Opacidad del objeto, de 0 a 1. */
  readonly opacity: number | null;
  /** Regla de relleno común de la selección; ausente si los objetos tienen reglas distintas o no hay formas. */
  readonly fillRule?: FillRule;
}

/** Cambio de propiedades propias de la forma seleccionada. Solo cambian las que se indican; las que no son de su tipo se ignoran. */
export interface ShapeChange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Rectángulo: x de la esquina superior izquierda. */
  readonly x?: number;
  /** Rectángulo: y de la esquina superior izquierda. */
  readonly y?: number;
  /** Rectángulo: ancho (más de 0). */
  readonly width?: number;
  /** Rectángulo: alto (más de 0). */
  readonly height?: number;
  /** Rectángulo: radio de las esquinas (rx y ry iguales), 0 para esquinas rectas. */
  readonly cornerRadius?: number;
  /** Elipse, círculo, polígono y estrella: x del centro. */
  readonly cx?: number;
  /** Elipse, círculo, polígono y estrella: y del centro. */
  readonly cy?: number;
  /** Elipse: radio horizontal (más de 0). */
  readonly rx?: number;
  /** Elipse: radio vertical (más de 0). */
  readonly ry?: number;
  /** Círculo: radio. Polígono y estrella: radio exterior, del centro a cada vértice o punta. */
  readonly r?: number;
  /** Línea: x del primer extremo. */
  readonly x1?: number;
  /** Línea: y del primer extremo. */
  readonly y1?: number;
  /** Línea: x del segundo extremo. */
  readonly x2?: number;
  /** Línea: y del segundo extremo. */
  readonly y2?: number;
  /** Polígono: lados. Estrella: puntas. Entero de 3 a 100. */
  readonly sides?: number;
  /** Estrella: radio interior respecto al exterior, de 0 a 1. */
  readonly inner?: number;
  /** Polígono y estrella: ángulo del primer vértice en grados, desde el eje x. */
  readonly rotation?: number;
  /** Polígono y estrella: redondeo de las esquinas, de 0 (rectas) a 1. */
  readonly rounding?: number;
}

/** Una forma ha pasado a ser un polígono normal al editar sus vértices (pierde lo que la hacía rectángulo o estrella). */
export interface ShapeConverted {
  /** Documento de la forma. */
  readonly documentId: string;
  /** Lo que era: rect, polygon (regular) o star. */
  readonly from: ShapeType;
}

/** Propiedades propias de la forma seleccionada, en las unidades de sus atributos (las de su grupo, sin su transform). Solo están las de su tipo. */
export interface ShapeProperties {
  /** Tipo de forma. */
  readonly type: ShapeType;
  /** Rectángulo: x de la esquina superior izquierda. */
  readonly x?: number;
  /** Rectángulo: y de la esquina superior izquierda. */
  readonly y?: number;
  /** Rectángulo: ancho (más de 0). */
  readonly width?: number;
  /** Rectángulo: alto (más de 0). */
  readonly height?: number;
  /** Rectángulo: radio de las esquinas (rx y ry iguales), 0 para esquinas rectas. */
  readonly cornerRadius?: number;
  /** Elipse, círculo, polígono y estrella: x del centro. */
  readonly cx?: number;
  /** Elipse, círculo, polígono y estrella: y del centro. */
  readonly cy?: number;
  /** Elipse: radio horizontal (más de 0). */
  readonly rx?: number;
  /** Elipse: radio vertical (más de 0). */
  readonly ry?: number;
  /** Círculo: radio. Polígono y estrella: radio exterior, del centro a cada vértice o punta. */
  readonly r?: number;
  /** Línea: x del primer extremo. */
  readonly x1?: number;
  /** Línea: y del primer extremo. */
  readonly y1?: number;
  /** Línea: x del segundo extremo. */
  readonly x2?: number;
  /** Línea: y del segundo extremo. */
  readonly y2?: number;
  /** Polígono: lados. Estrella: puntas. Entero de 3 a 100. */
  readonly sides?: number;
  /** Estrella: radio interior respecto al exterior, de 0 a 1. */
  readonly inner?: number;
  /** Polígono y estrella: ángulo del primer vértice en grados, desde el eje x. */
  readonly rotation?: number;
  /** Polígono y estrella: redondeo de las esquinas, de 0 (rectas) a 1. */
  readonly rounding?: number;
}

/** Tipo de forma con propiedades propias en el panel. */
export type ShapeType = "rect" | "ellipse" | "circle" | "line" | "polygon" | "star";

/** Cambio de estilo de la selección. Un campo null no cambia. */
export interface StyleChange {
  /** Identificador del documento, asignado por la aplicación. */
  readonly documentId: string;
  /** Relleno: "none" o "#rrggbb". */
  readonly fill: string | null;
  /** Trazo: "none" o "#rrggbb". */
  readonly stroke: string | null;
  /** Grosor del trazo, 0 o más. */
  readonly strokeWidth: number | null;
  /** Opacidad, de 0 a 1. */
  readonly opacity: number | null;
  /** Regla de relleno; ausente, no cambia. */
  readonly fillRule?: FillRule;
}

/** Por qué un texto no se puede editar en el lienzo: sigue un trazado, coloca o gira caracteres sueltos, los desplaza de forma relativa o fuerza su longitud, tiene tramos con estilos distintos o contiene otros elementos. */
export type TextLock =
  "text-path" | "per-character" | "relative-position" | "styled-runs" | "other-content";

/** Se ha intentado editar en el lienzo un texto que no se puede editar. */
export interface TextLocked {
  /** Documento del texto. */
  readonly documentId: string;
  /** Por qué no se puede editar. */
  readonly reason: TextLock;
}

/** Herramienta del lienzo que ya implementa el motor. */
export type ToolName =
  | "select"
  | "hand"
  | "zoom"
  | "eyedropper"
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "star"
  | "vertex"
  | "pen"
  | "text";

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
  /** Mueve, redimensiona o gira la selección hasta los valores del panel de propiedades, en un paso que se puede deshacer. */
  readonly "selection.setGeometry": {
    readonly payload: SelectionGeometry;
    readonly response: DocumentRef;
  };
  /** Cambia el relleno, el trazo, su grosor o la opacidad de la selección tocando lo mínimo del archivo. Los cambios seguidos de las mismas propiedades son un solo paso del historial. */
  readonly "selection.setStyle": { readonly payload: StyleChange; readonly response: ObjectChange };
  /** Cambia propiedades propias de la forma seleccionada (radio de las esquinas, lados de un polígono…) en un paso que se puede deshacer. Los cambios seguidos de la misma propiedad son un solo paso del historial. */
  readonly "selection.setShape": { readonly payload: ShapeChange; readonly response: ObjectChange };
  /** Trae al frente, envía al fondo, sube o baja un nivel la selección. Se puede deshacer. */
  readonly "object.arrange": { readonly payload: ObjectArrange; readonly response: ObjectChange };
  /** Convierte en trazados (<path>) las formas seleccionadas (rectángulo, elipse, círculo, línea, polígono, polilínea) sin cambiar su aspecto, conservando sus atributos. Se puede deshacer. */
  readonly "object.toPath": { readonly payload: DocumentRef; readonly response: ObjectChange };
  /** Con la herramienta Vértices en un trazado, hace esquina, suaves o simétricos los nodos seleccionados, o rectos o curvos los segmentos entre ellos. changed es false si no había nada que cambiar. Se puede deshacer. */
  readonly "path.nodes": { readonly payload: PathNodesChange; readonly response: ObjectChange };
  /** Operación del menú Trazado sobre la selección: cerrar o abrir trazados (con la herramienta Vértices, abrir por el nodo seleccionado), invertir su dirección, combinar las formas seleccionadas en un trazado o separar un trazado en sus subtrazados. changed es false si no había nada que hacer. Se puede deshacer. */
  readonly "path.operation": { readonly payload: PathOperation; readonly response: ObjectChange };
  /** Con la herramienta Vértices, redondea las esquinas seleccionadas con el mismo radio (o lo quita con 0). La forma pasa a ser un trazado que guarda sus vértices y radios en atributos data-winvector-*. changed es false si no había esquinas que redondear. Se puede deshacer. */
  readonly "path.cornerRadius": {
    readonly payload: CornerRadiusChange;
    readonly response: ObjectChange;
  };
  /** Agrupa la selección en un <g> sin cambiar su aspecto. Se puede deshacer. */
  readonly "object.group": { readonly payload: DocumentRef; readonly response: ObjectChange };
  /** Desagrupa los grupos seleccionados sin cambiar su aspecto; los que cambiarían (opacidad, filtro, recorte, máscara) se dejan. Se puede deshacer. */
  readonly "object.ungroup": { readonly payload: DocumentRef; readonly response: ObjectChange };
  /** Duplica la selección junto al original y selecciona las copias. Se puede deshacer. */
  readonly "selection.duplicate": {
    readonly payload: DocumentRef;
    readonly response: ObjectChange;
  };
  /** Elimina la selección. Se puede deshacer. */
  readonly "selection.delete": { readonly payload: DocumentRef; readonly response: ObjectChange };
  /** Devuelve la selección como SVG independiente; la aplicación lo pone en el portapapeles de Windows. */
  readonly "clipboard.copy": { readonly payload: DocumentRef; readonly response: ClipboardContent };
  /** Pega un SVG en el puntero, o desplazado respecto a su posición original si el puntero no está sobre el lienzo, y lo selecciona. Se puede deshacer. */
  readonly "clipboard.paste": {
    readonly payload: ClipboardPaste;
    readonly response: ClipboardPasteResult;
  };
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
  /** Al editar sus vértices, un rectángulo o un polígono o estrella de WinVector ha pasado a ser un polígono normal. La aplicación lo avisa en la barra de estado. */
  readonly "shape.converted": ShapeConverted;
  /** Con la herramienta Texto (o con doble clic), se ha intentado editar un texto que no se puede editar en el lienzo. La aplicación explica por qué en la barra de estado. */
  readonly "text.locked": TextLocked;
  /** Han cambiado los nodos seleccionados de la forma que se edita con la herramienta Vértices, o lo que se puede hacer con ellos. La aplicación habilita las órdenes de nodos del menú Trazado y del panel. */
  readonly "nodes.changed": NodeSelection;
  /** El usuario ha pedido el menú contextual del lienzo (clic derecho, Mayús+F10 o la tecla de menú). La aplicación lo abre en el punto indicado. */
  readonly "canvas.contextMenu": ContextMenuRequest;
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
  /** Con el lienzo enfocado, WebView2 entrega el teclado a la página y los atajos de la ventana no se disparan: el motor atiende los suyos (deshacer, zoom, seleccionar todo) y envía los demás a la aplicación. */
  readonly "keyboard.shortcut": KeyboardShortcut;
}

export type BridgeCommandName = keyof BridgeCommands;
export type BridgeEventName = keyof BridgeEvents;

export const BRIDGE_COMMAND_NAMES: readonly BridgeCommandName[] = [
  "app.ping",
  "selection.selectAll",
  "selection.setGeometry",
  "selection.setStyle",
  "selection.setShape",
  "object.arrange",
  "object.toPath",
  "path.nodes",
  "path.operation",
  "path.cornerRadius",
  "object.group",
  "object.ungroup",
  "selection.duplicate",
  "selection.delete",
  "clipboard.copy",
  "clipboard.paste",
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
  "shape.converted",
  "text.locked",
  "nodes.changed",
  "canvas.contextMenu",
  "error",
  "document.changed",
  "files.dropped",
  "history.changed",
  "viewport.changed",
  "tool.changed",
  "artboard.changed",
  "keyboard.shortcut",
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
