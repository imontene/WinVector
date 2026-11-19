import { scanXml, type ScannedDocument, type SourceElement, type SourceNode } from "./scanner";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** El texto no es un SVG válido. `line` y `column` indican dónde, si el analizador lo sabe. */
export class SvgParseError extends Error {
  readonly line: number | null;
  readonly column: number | null;

  constructor(message: string, line: number | null = null, column: number | null = null) {
    super(message);
    this.name = "SvgParseError";
    this.line = line;
    this.column = column;
  }
}

export interface SvgDocumentOptions {
  /** Se llama tras cada lote de cambios del documento, con la revisión nueva. */
  readonly onChange?: (revision: number) => void;
}

/** Origen de un nodo mostrado: su posición en el texto original y, si es un elemento, sus atributos. */
interface NodeOrigin {
  readonly source: SourceNode;
  /** Valores originales de los atributos por nombre cualificado (solo elementos). */
  readonly attributes?: ReadonlyMap<string, string>;
}

/**
 * Presentación de la mesa de trabajo dentro del shadow root. Las variables (--artboard-*) vienen de
 * la página del motor y atraviesan el límite del shadow root.
 */
const ARTBOARD_STYLES = `
  :host { display: contents; }
  :host([hidden]) { display: none; }
  .artboard { display: contents; }
  .artboard > svg {
    width: min(90vw, calc(90vh * var(--artboard-ratio, 1)));
    height: auto;
    max-height: 90vh;
    background: #fff;
    box-shadow: 0 1px 4px var(--artboard-shadow, rgb(0 0 0 / 18%));
  }
`;

/**
 * Documento SVG en edición.
 *
 * - Se muestra dentro de un shadow root: sus estilos e identificadores no afectan a la página del
 *   motor ni a la interfaz de edición, y nada de esa interfaz entra en el documento.
 * - Su contenido activo no se ejecuta: los `<script>` se sustituyen en pantalla por un marcador
 *   inerte y la política de seguridad de la página bloquea los manejadores `on*`. Todo se guarda
 *   intacto.
 * - Al guardar, lo que no se ha modificado se copia exactamente del texto original y solo se
 *   regenera lo que ha cambiado.
 */
export class SvgDocument {
  readonly root: SVGSVGElement;
  /** Texto original completo, tal como llegó. */
  readonly #original: string;
  /** Texto original sin la marca BOM: las posiciones del escáner se refieren a él. */
  readonly #source: string;
  readonly #prolog: string;
  readonly #epilog: string;
  readonly #origins = new WeakMap<Node, NodeOrigin>();
  readonly #inertOriginals = new WeakMap<Node, Element>();
  readonly #dirtyStartTags = new WeakSet<Node>();
  readonly #dirtyChildren = new WeakSet<Node>();
  readonly #dirtyData = new WeakSet<Node>();
  readonly #reservedIds = new Set<string>();
  readonly #observer: MutationObserver;
  readonly #exactMapping: boolean;
  #revision = 0;

  readonly #onChange: ((revision: number) => void) | undefined;

  private constructor(source: string, host: HTMLElement, options: SvgDocumentOptions) {
    this.#onChange = options.onChange;
    // DOMParser no admite la marca BOM al principio; se aparta y se conserva en el prólogo.
    const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = source.slice(bom.length);
    this.#original = source;
    this.#source = body;
    const xml = parseXml(body);
    const xmlRoot = xml.documentElement;

    const scanned = tryScan(body);
    this.#prolog = bom + (scanned ? body.slice(0, scanned.root.start) : guessProlog(body));
    this.#epilog = scanned ? body.slice(scanned.root.end) : "";

    const shown = host.ownerDocument.importNode(xmlRoot, true) as unknown as SVGSVGElement;
    this.#exactMapping = scanned !== null && this.#mapTree(xmlRoot, shown, scanned.root);
    this.#neutralizeScripts(xmlRoot, shown);
    this.root = shown;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = host.ownerDocument.createElement("style");
    style.textContent = ARTBOARD_STYLES;
    const artboard = host.ownerDocument.createElement("div");
    artboard.className = "artboard";
    const { width, height } = shown.viewBox.baseVal;
    if (width > 0 && height > 0)
      artboard.style.setProperty("--artboard-ratio", String(width / height));
    artboard.append(shown);
    shadow.replaceChildren(style, artboard);

    this.#observer = new MutationObserver((records) => {
      this.#record(records);
    });
    this.#observer.observe(shown, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  }

  /**
   * Analiza `source` y lo muestra dentro de `host`.
   * @throws {SvgParseError} si el texto no es XML bien formado o su raíz no es `<svg>`.
   */
  static load(source: string, host: HTMLElement, options: SvgDocumentOptions = {}): SvgDocument {
    return new SvgDocument(source, host, options);
  }

  /** Aumenta con cada cambio del documento. */
  get revision(): number {
    this.#flush();
    return this.#revision;
  }

  /**
   * `true` si cada nodo se pudo localizar en el texto original. Si es `false` (casos raros, como
   * entidades que se expanden en elementos), el documento se guarda sin perder contenido, pero con
   * el formato que genera el editor en lugar del original.
   */
  get hasExactMapping(): boolean {
    return this.#exactMapping;
  }

  /** Texto del documento para guardarlo. Sin cambios, es exactamente el texto original. */
  serialize(): string {
    this.#flush();
    if (this.#revision === 0) return this.#original;
    return this.#prolog + this.#serializeNode(this.root) + this.#epilog;
  }

  /**
   * Devuelve un identificador legible que no existe en el documento, a partir de `base`:
   * `degradado`, `degradado-2`… Nunca cambia los identificadores existentes.
   */
  createId(base: string): string {
    const clean = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[^A-Za-z_]+/, "") || "id";
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? clean : `${clean}-${String(n)}`;
      if (!this.#idInUse(candidate)) {
        this.#reservedIds.add(candidate);
        return candidate;
      }
    }
  }

  /** El primer `<defs>` hijo de la raíz, o uno nuevo colocado tras `<title>`, `<desc>` y `<metadata>`. */
  getOrCreateDefs(): SVGDefsElement {
    const existing = [...this.root.children].find(
      (child) => child.namespaceURI === SVG_NS && child.localName === "defs",
    );
    if (existing) return existing as SVGDefsElement;

    const defs = this.root.ownerDocument.createElementNS(SVG_NS, "defs");
    const leading = [...this.root.children].filter((child) =>
      ["title", "desc", "metadata"].includes(child.localName),
    );
    const after = leading.at(-1);
    if (after) after.after(defs);
    else this.root.prepend(defs);
    return defs;
  }

  /** Definiciones (hijos con `id` de un `<defs>`) a las que nada del documento hace referencia. */
  findUnusedDefinitions(): Element[] {
    const referenced = new Set<string>();
    const addFrom = (value: string): void => {
      for (const match of value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) {
        if (match[1]) referenced.add(match[1]);
      }
    };

    for (const element of [this.root, ...this.root.querySelectorAll("*")]) {
      for (const attribute of element.attributes) {
        if (attribute.localName === "id") continue;
        if (attribute.localName === "href" && attribute.value.startsWith("#")) {
          referenced.add(attribute.value.slice(1));
        }
        addFrom(attribute.value);
      }
      if (element.localName === "style") addFrom(element.textContent);
    }

    return [...this.root.querySelectorAll("defs > [id]")].filter((def) => !referenced.has(def.id));
  }

  /** Deja de seguir los cambios. El contenido mostrado no se retira. */
  dispose(): void {
    this.#observer.disconnect();
  }

  #flush(): void {
    this.#record(this.#observer.takeRecords());
  }

  #record(records: MutationRecord[]): void {
    if (records.length === 0) return;
    for (const record of records) {
      this.#revision++;
      if (record.type === "attributes") this.#dirtyStartTags.add(record.target);
      else if (record.type === "childList") this.#dirtyChildren.add(record.target);
      else this.#dirtyData.add(record.target);
    }
    this.#onChange?.(this.#revision);
  }

  #idInUse(id: string): boolean {
    return (
      this.#reservedIds.has(id) ||
      this.root.id === id ||
      this.root.querySelector(`[id="${CSS.escape(id)}"]`) !== null
    );
  }

  /** Asocia cada nodo mostrado con su posición en el texto. Devuelve `false` si no cuadran. */
  #mapTree(xmlNode: Node, shown: Node, source: SourceNode): boolean {
    if (!sameKind(xmlNode, source)) return false;

    if (source.kind === "element") {
      const element = xmlNode as Element;
      if (element.nodeName !== source.name) return false;
      if (element.childNodes.length !== source.children.length) return false;
      const attributes = new Map<string, string>();
      for (const attribute of element.attributes) attributes.set(attribute.name, attribute.value);
      for (const [index, child] of source.children.entries()) {
        const xmlChild = element.childNodes[index];
        const shownChild = shown.childNodes[index];
        if (!xmlChild || !shownChild || !this.#mapTree(xmlChild, shownChild, child)) return false;
      }
      this.#origins.set(shown, { source, attributes });
    } else {
      this.#origins.set(shown, { source });
    }
    return true;
  }

  /** Sustituye en pantalla cada `<script>` (de cualquier espacio de nombres) por un marcador inerte. */
  #neutralizeScripts(xmlRoot: Element, shown: Element): void {
    const xmlScripts = [...xmlRoot.getElementsByTagNameNS("*", "script")];
    const shownScripts = [...shown.getElementsByTagNameNS("*", "script")];
    for (const [index, script] of shownScripts.entries()) {
      const placeholder = shown.ownerDocument.createElementNS(SVG_NS, "metadata");
      const origin = this.#origins.get(script);
      if (origin) this.#origins.set(placeholder, origin);
      const original = xmlScripts[index];
      if (original) this.#inertOriginals.set(placeholder, original);
      script.replaceWith(placeholder);
    }
  }

  #isClean(node: Node): boolean {
    if (!this.#origins.has(node)) return false;
    if (this.#inertOriginals.has(node)) return true;
    if (this.#dirtyData.has(node)) return false;
    if (node.nodeType !== Node.ELEMENT_NODE) return true;
    if (this.#dirtyStartTags.has(node) || this.#dirtyChildren.has(node)) return false;
    return [...node.childNodes].every((child) => this.#isClean(child));
  }

  #slice(source: { start: number; end: number }): string {
    return this.#source.slice(source.start, source.end);
  }

  #serializeNode(node: Node): string {
    const origin = this.#exactMapping ? this.#origins.get(node) : undefined;

    const inert = this.#inertOriginals.get(node);
    if (inert)
      return origin ? this.#slice(origin.source) : new XMLSerializer().serializeToString(inert);

    if (origin && this.#isClean(node)) return this.#slice(origin.source);

    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        return this.#serializeElement(node as Element, origin);
      case Node.TEXT_NODE:
        return escapeText((node as Text).data);
      case Node.CDATA_SECTION_NODE:
        return `<![CDATA[${(node as CDATASection).data}]]>`;
      case Node.COMMENT_NODE:
        return `<!--${(node as Comment).data}-->`;
      case Node.PROCESSING_INSTRUCTION_NODE: {
        const pi = node as ProcessingInstruction;
        return `<?${pi.target}${pi.data ? ` ${pi.data}` : ""}?>`;
      }
      default:
        return "";
    }
  }

  #serializeElement(element: Element, origin: NodeOrigin | undefined): string {
    const source = origin?.source.kind === "element" ? origin.source : undefined;
    const children = [...element.childNodes];
    const empty = children.length === 0;
    const name = qualifiedName(element);

    let startTag: string;
    let selfClosing: boolean;
    if (source && origin && !this.#dirtyStartTags.has(element)) {
      const original = this.#source.slice(source.start, source.startTagEnd);
      if (!source.selfClosing) {
        startTag = original;
        selfClosing = false;
      } else if (empty) {
        startTag = original;
        selfClosing = true;
      } else {
        // Era <x/> y ahora tiene hijos: misma etiqueta, abierta.
        startTag = `${original.slice(0, -2).trimEnd()}>`;
        selfClosing = false;
      }
    } else {
      selfClosing = empty && (source ? source.selfClosing : true);
      startTag = this.#buildStartTag(element, source, origin, selfClosing);
    }

    if (selfClosing) return startTag;
    const inner = children.map((child) => this.#serializeNode(child)).join("");
    const endTag =
      source?.endTagStart != null
        ? this.#source.slice(source.endTagStart, source.end)
        : `</${name}>`;
    return startTag + inner + endTag;
  }

  /** Regenera la etiqueta de apertura conservando el orden y el texto de los atributos sin cambios. */
  #buildStartTag(
    element: Element,
    source: SourceElement | undefined,
    origin: NodeOrigin | undefined,
    selfClosing: boolean,
  ): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const attribute of source?.attributes ?? []) {
      seen.add(attribute.name);
      const current = element.getAttribute(attribute.name);
      if (current === null) continue;
      parts.push(
        current === origin?.attributes?.get(attribute.name)
          ? this.#slice(attribute)
          : `${attribute.name}="${escapeAttribute(current)}"`,
      );
    }
    for (const attribute of element.attributes) {
      if (!seen.has(attribute.name))
        parts.push(`${attribute.name}="${escapeAttribute(attribute.value)}"`);
    }
    const attributes = parts.map((part) => ` ${part}`).join("");
    return `<${qualifiedName(element)}${attributes}${selfClosing ? "/>" : ">"}`;
  }
}

function parseXml(source: string): XMLDocument {
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  const error = xml.getElementsByTagNameNS("*", "parsererror")[0];
  if (error) {
    const text = error.textContent;
    const match = /line (\d+) at column (\d+):\s*([^\n]*)/.exec(text);
    if (match) {
      const line = Number(match[1]);
      const column = Number(match[2]);
      throw new SvgParseError(
        `El XML no es válido en la línea ${String(line)}, columna ${String(column)}: ${(match[3] ?? "").trim()}`,
        line,
        column,
      );
    }
    throw new SvgParseError(`El XML no es válido: ${text.trim()}`);
  }

  const root = xml.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new SvgParseError(
      `El archivo no es un SVG: su elemento raíz es <${root.nodeName}> en lugar de <svg> del espacio de nombres SVG.`,
    );
  }
  return xml;
}

/** Escanea el texto; si el escáner no lo entiende, se guardará sin conservar el formato original. */
function tryScan(source: string): ScannedDocument | null {
  try {
    return scanXml(source);
  } catch {
    return null;
  }
}

/**
 * Nombre cualificado tal como se escribió. No se usa `nodeName` porque, en un documento HTML, el de
 * los elementos XHTML (por ejemplo dentro de `<foreignObject>`) se devuelve en mayúsculas.
 */
function qualifiedName(element: Element): string {
  return element.prefix ? `${element.prefix}:${element.localName}` : element.localName;
}

function sameKind(node: Node, source: SourceNode): boolean {
  switch (source.kind) {
    case "element":
      return node.nodeType === Node.ELEMENT_NODE;
    case "text":
      return node.nodeType === Node.TEXT_NODE;
    case "cdata":
      return node.nodeType === Node.CDATA_SECTION_NODE;
    case "comment":
      return node.nodeType === Node.COMMENT_NODE;
    case "pi":
      return node.nodeType === Node.PROCESSING_INSTRUCTION_NODE;
  }
}

/** Prólogo aproximado cuando no se pudo escanear el texto: todo lo anterior a la primera etiqueta de elemento. */
function guessProlog(source: string): string {
  const match = /<(?![?!])/.exec(source);
  return match ? source.slice(0, match.index) : "";
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}
