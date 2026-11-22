/**
 * Modelo de texto (issue #92), el del ADR 0006: un texto de varias líneas es un `<text>` con un
 * `<tspan>` por línea, cada uno con `x` e `y` absolutos, y `xml:space="preserve"` para que los
 * espacios se conserven tal cual. Un texto de una sola línea se queda sin `tspan`.
 *
 * Los textos de otros programas se clasifican: los que siguen ese modelo (o uno parecido, como las
 * líneas de Inkscape) se editan en el lienzo; los demás (sobre un trazado, con posiciones o giros
 * por carácter, con tramos anidados) se mueven, se transforman y cambian de estilo, pero no se
 * editan, para no perder lo que los hace así.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Interlineado por defecto, en múltiplos del tamaño de la fuente (el del prototipo). */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** Interlineado guardado en un texto de una sola línea, para cuando se le añadan más. */
export const LINE_HEIGHT_ATTRIBUTE = "data-winvector-line-height";

/** Por qué un texto no se puede editar en el lienzo. */
export type TextLock =
  /** Sigue un trazado (`textPath`). */
  | "text-path"
  /** Coloca o gira caracteres sueltos (varios valores en `x`/`y`, o `rotate`). */
  | "per-character"
  /** Desplaza caracteres o líneas de forma relativa (`dx`/`dy`) o fuerza su longitud. */
  | "relative-position"
  /** Tiene tramos con estilos distintos (`tspan` anidados o dentro de una línea): MVP 4, #96. */
  | "styled-runs"
  /** Contiene otros elementos (enlaces, `title`…). */
  | "other-content";

export type TextEditability =
  { readonly editable: true } | { readonly editable: false; readonly reason: TextLock };

const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
const isBlankText = (node: Node) =>
  node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "";

/** Número de valores de un atributo de longitudes (`x="1 2 3"` tiene tres). */
const valueCount = (element: Element, name: string) =>
  (element.getAttribute(name) ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean).length;

/** Atributos que colocan caracteres de forma relativa o fuerzan la longitud del texto. */
const RELATIVE = ["dx", "dy", "textLength", "lengthAdjust"] as const;

function lockOf(element: Element, isLine: boolean): TextLock | null {
  if (element.hasAttribute("rotate")) return "per-character";
  if (valueCount(element, "x") > 1 || valueCount(element, "y") > 1) return "per-character";
  // Las líneas de otros programas a veces bajan con `dy` en lugar de una `y` absoluta.
  for (const name of RELATIVE) {
    if (
      element.hasAttribute(name) &&
      !(isLine && name === "dy" && valueCount(element, "dy") <= 1)
    ) {
      return "relative-position";
    }
  }
  return null;
}

/** Si un texto se puede editar en el lienzo y, si no, por qué. */
export function textEditability(text: Element): TextEditability {
  if (text.namespaceURI !== SVG_NS || text.localName !== "text") {
    return { editable: false, reason: "other-content" };
  }
  const own = lockOf(text, false);
  if (own) return { editable: false, reason: own };
  const children = [...text.childNodes];
  const elements = children.filter(isElement);
  if (elements.some((element) => element.localName === "textPath")) {
    return { editable: false, reason: "text-path" };
  }
  if (elements.length === 0) return { editable: true };
  if (
    elements.some((element) => element.namespaceURI !== SVG_NS || element.localName !== "tspan")
  ) {
    return { editable: false, reason: "other-content" };
  }
  // Con tspan, cada uno es una línea; el texto suelto entre ellos solo puede ser sangría.
  if (children.some((node) => !isElement(node) && !isBlankText(node))) {
    return { editable: false, reason: "styled-runs" };
  }
  for (const line of elements) {
    if (line.children.length > 0) return { editable: false, reason: "styled-runs" };
    const lock = lockOf(line, true);
    if (lock) return { editable: false, reason: lock };
  }
  return { editable: true };
}

/** Las líneas de un texto editable: los `tspan` que hay directamente en él, o su texto. */
export function lineElements(text: Element): Element[] {
  return [...text.children].filter(
    (child) => child.namespaceURI === SVG_NS && child.localName === "tspan",
  );
}

/** Líneas de un texto editable. */
export function readLines(text: Element): string[] {
  const lines = lineElements(text);
  return lines.length === 0 ? [text.textContent] : lines.map((line) => line.textContent);
}

/** Tamaño de la fuente en unidades de usuario del texto. */
export function fontSize(text: Element): number {
  return Number.parseFloat(getComputedStyle(text).fontSize) || 16;
}

const number = (element: Element, name: string): number | null => {
  const [first] = (element.getAttribute(name) ?? "").trim().split(/[\s,]+/);
  const value = first ? Number.parseFloat(first) : Number.NaN;
  return Number.isFinite(value) ? value : null;
};

/** Origen del texto: dónde empieza la línea base de la primera línea. */
export function origin(text: Element): { x: number; y: number } {
  const [first] = lineElements(text);
  return {
    x: number(text, "x") ?? (first ? number(first, "x") : null) ?? 0,
    y: number(text, "y") ?? (first ? number(first, "y") : null) ?? 0,
  };
}

/**
 * Línea base de cada línea: su `y` o, en las líneas que bajan con `dy` (como hacen algunos
 * programas), la de la anterior más ese desplazamiento.
 */
export function baselines(text: Element): number[] {
  let y = number(text, "y") ?? 0;
  return lineElements(text).map((line) => {
    y = number(line, "y") ?? y + (number(line, "dy") ?? 0);
    return y;
  });
}

/**
 * Interlineado del texto en múltiplos del tamaño de la fuente: el que tienen sus líneas, el guardado
 * en un texto de una sola línea, o el de por defecto.
 */
export function lineHeight(text: Element): number {
  const [y0, y1] = baselines(text);
  const size = fontSize(text);
  if (y0 !== undefined && y1 !== undefined && size > 0 && y1 > y0) {
    return round((y1 - y0) / size, 4);
  }
  const stored = Number.parseFloat(text.getAttribute(LINE_HEIGHT_ATTRIBUTE) ?? "");
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_LINE_HEIGHT;
}

const round = (value: number, decimals = 3) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const text3 = (value: number) => String(round(value));

/**
 * Escribe las líneas en el texto tocando lo mínimo:
 * - Una sola línea va sin `tspan`, en el propio texto.
 * - Con varias, cada línea es un `tspan` con `x` e `y` absolutos. Los `tspan` que ya había se
 *   reutilizan (conservan sus atributos, como los estilos que pone Inkscape) y los nuevos copian los
 *   del último.
 *
 * `spacing` es el interlineado en múltiplos del tamaño de la fuente; por defecto, el que ya tiene.
 */
export function writeLines(
  text: Element,
  lines: readonly string[],
  spacing = lineHeight(text),
): void {
  // Sin esto, el SVG junta los espacios seguidos y quita los del principio y el final: los
  // caracteres dejarían de corresponder con lo escrito.
  if (text.getAttributeNS(XML_NS, "space") !== "preserve") {
    text.setAttributeNS(XML_NS, "xml:space", "preserve");
  }
  const { x, y } = origin(text);
  const existing = lineElements(text);
  // Una línea sin tspan se queda así; si ya tenía tspan (con sus estilos), se siguen usando.
  if (lines.length <= 1 && existing.length === 0) {
    text.textContent = lines[0] ?? "";
    if (!text.hasAttribute("x")) text.setAttribute("x", text3(x));
    if (!text.hasAttribute("y")) text.setAttribute("y", text3(y));
    if (Math.abs(spacing - DEFAULT_LINE_HEIGHT) > 1e-9) {
      text.setAttribute(LINE_HEIGHT_ATTRIBUTE, String(round(spacing, 4)));
    } else {
      text.removeAttribute(LINE_HEIGHT_ATTRIBUTE);
    }
    return;
  }
  const step = fontSize(text) * spacing;
  // Con tspan, el origen es la línea base de la primera línea, aunque bajara con dy.
  const [firstBaseline] = baselines(text);
  const top = firstBaseline ?? y;
  const template = existing.at(-1);
  const spans = lines.map((line, index) => {
    const span =
      existing[index] ??
      (template
        ? (template.cloneNode(false) as Element)
        : text.ownerDocument.createElementNS(SVG_NS, "tspan"));
    // Una copia del último no repite su identificador.
    if (!existing[index]) span.removeAttribute("id");
    span.setAttribute("x", text3(x));
    span.setAttribute("y", text3(top + index * step));
    // Las líneas que bajaban con dy pasan a tener su y absoluta.
    span.removeAttribute("dy");
    span.textContent = line;
    return span;
  });
  text.replaceChildren(...spans);
  if (lines.length > 1) text.removeAttribute(LINE_HEIGHT_ATTRIBUTE);
  else if (Math.abs(spacing - DEFAULT_LINE_HEIGHT) > 1e-9) {
    text.setAttribute(LINE_HEIGHT_ATTRIBUTE, String(round(spacing, 4)));
  }
  // El origen queda en el texto para que se mueva con sus atributos de siempre.
  if (!text.hasAttribute("x")) text.setAttribute("x", text3(x));
  if (!text.hasAttribute("y")) text.setAttribute("y", text3(y));
}
