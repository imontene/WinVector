/**
 * Escáner de XML que localiza cada nodo en el texto original.
 *
 * Solo se usa sobre documentos que `DOMParser` ya ha aceptado, así que puede suponer que el XML está
 * bien formado. Su único fin es saber dónde empieza y termina cada nodo para poder copiar tal cual,
 * al guardar, lo que no se ha modificado.
 */

export interface SourceAttribute {
  /** Nombre cualificado tal como aparece (por ejemplo `xlink:href`). */
  readonly name: string;
  /** Inicio y fin del atributo completo, desde el nombre hasta la comilla de cierre. */
  readonly start: number;
  readonly end: number;
}

interface SourceNodeBase {
  readonly start: number;
  readonly end: number;
}

export interface SourceElement extends SourceNodeBase {
  readonly kind: "element";
  /** Nombre cualificado tal como aparece en la etiqueta. */
  readonly name: string;
  /** Fin de la etiqueta de apertura (después de `>` o `/>`). */
  readonly startTagEnd: number;
  /** Inicio de la etiqueta de cierre, o `null` si el elemento se cerró con `/>`. */
  readonly endTagStart: number | null;
  readonly selfClosing: boolean;
  readonly attributes: readonly SourceAttribute[];
  readonly children: readonly SourceNode[];
}

export interface SourceLeaf extends SourceNodeBase {
  readonly kind: "text" | "comment" | "cdata" | "pi";
}

export type SourceNode = SourceElement | SourceLeaf;

/** Resultado del escaneo: el elemento raíz y lo que hay antes y después de él. */
export interface ScannedDocument {
  readonly root: SourceElement;
}

interface MutableElement {
  kind: "element";
  name: string;
  start: number;
  end: number;
  startTagEnd: number;
  endTagStart: number | null;
  selfClosing: boolean;
  attributes: SourceAttribute[];
  children: SourceNode[];
}

const NAME_END = /[\s/>=]/;

export class ScanError extends Error {
  constructor(message: string, position: number) {
    super(`${message} (posición ${String(position)})`);
    this.name = "ScanError";
  }
}

export function scanXml(source: string): ScannedDocument {
  const stack: MutableElement[] = [];
  let root: MutableElement | undefined;
  let i = 0;

  const addLeaf = (kind: SourceLeaf["kind"], start: number, end: number): void => {
    const parent = stack.at(-1);
    // Fuera del elemento raíz no hay nodos de texto en el DOM, y el resto se conserva como prólogo o epílogo.
    if (parent) parent.children.push({ kind, start, end });
  };

  const indexOrThrow = (needle: string, from: number, what: string): number => {
    const index = source.indexOf(needle, from);
    if (index < 0) throw new ScanError(`Falta el cierre de ${what}`, from);
    return index;
  };

  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next < 0 ? source.length : next;
      addLeaf("text", i, end);
      i = end;
      continue;
    }

    if (source.startsWith("<!--", i)) {
      const end = indexOrThrow("-->", i + 4, "un comentario") + 3;
      addLeaf("comment", i, end);
      i = end;
    } else if (source.startsWith("<![CDATA[", i)) {
      const end = indexOrThrow("]]>", i + 9, "una sección CDATA") + 3;
      addLeaf("cdata", i, end);
      i = end;
    } else if (source.startsWith("<?", i)) {
      const end = indexOrThrow("?>", i + 2, "una instrucción de procesamiento") + 2;
      addLeaf("pi", i, end);
      i = end;
    } else if (source.startsWith("<!", i)) {
      i = skipDoctype(source, i);
    } else if (source.startsWith("</", i)) {
      const close = indexOrThrow(">", i, "una etiqueta de cierre");
      const element = stack.pop();
      if (!element) throw new ScanError("Etiqueta de cierre sin apertura", i);
      element.endTagStart = i;
      element.end = close + 1;
      i = close + 1;
    } else {
      const element = scanStartTag(source, i);
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (!root) root = element;
      else throw new ScanError("Hay más de un elemento raíz", i);
      if (!element.selfClosing) stack.push(element);
      i = element.startTagEnd;
    }
  }

  if (!root) throw new ScanError("No hay elemento raíz", 0);
  if (stack.length > 0) throw new ScanError("Hay elementos sin cerrar", source.length);
  return { root };
}

function scanStartTag(source: string, start: number): MutableElement {
  let i = start + 1;
  const nameStart = i;
  while (i < source.length && !NAME_END.test(source.charAt(i))) i++;
  const name = source.slice(nameStart, i);
  const attributes: SourceAttribute[] = [];

  for (;;) {
    while (/\s/.test(source.charAt(i))) i++;
    if (source.startsWith("/>", i)) {
      return element(name, start, i + 2, true, attributes);
    }
    if (source[i] === ">") {
      return element(name, start, i + 1, false, attributes);
    }
    if (i >= source.length) throw new ScanError(`Etiqueta <${name}> sin cerrar`, start);

    const attributeStart = i;
    while (i < source.length && !NAME_END.test(source.charAt(i))) i++;
    const attributeName = source.slice(attributeStart, i);
    while (/\s/.test(source.charAt(i))) i++;
    if (source[i] !== "=") throw new ScanError(`Falta "=" en el atributo ${attributeName}`, i);
    i++;
    while (/\s/.test(source.charAt(i))) i++;
    const quote = source.charAt(i);
    if (quote !== '"' && quote !== "'")
      throw new ScanError(`Falta la comilla del atributo ${attributeName}`, i);
    const close = source.indexOf(quote, i + 1);
    if (close < 0) throw new ScanError(`Atributo ${attributeName} sin cerrar`, i);
    i = close + 1;
    attributes.push({ name: attributeName, start: attributeStart, end: i });
  }
}

function element(
  name: string,
  start: number,
  startTagEnd: number,
  selfClosing: boolean,
  attributes: SourceAttribute[],
): MutableElement {
  return {
    kind: "element",
    name,
    start,
    end: startTagEnd,
    startTagEnd,
    endTagStart: null,
    selfClosing,
    attributes,
    children: [],
  };
}

/** Salta una declaración `<!DOCTYPE …>`, incluido su subconjunto interno entre corchetes. */
function skipDoctype(source: string, start: number): number {
  let i = start + 2;
  let depth = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const close = source.indexOf(char, i + 1);
      i = close < 0 ? source.length : close + 1;
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      i = close < 0 ? source.length : close + 3;
      continue;
    }
    if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === ">" && depth <= 0) return i + 1;
    i++;
  }
  throw new ScanError("Declaración <!DOCTYPE> sin cerrar", start);
}
