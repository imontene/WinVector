/**
 * Modelo común de los dos prototipos de edición de texto (issue #35): un texto SVG de varias
 * líneas es un `text` con un `tspan` por línea, cada uno con `x` e `y` absolutos. Con `y` absoluto
 * las líneas vacías conservan su sitio (un `tspan` vacío no tiene caracteres a los que aplicar `dy`).
 */

export const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** Interlineado, en múltiplos del tamaño de la fuente. */
export const LINE_HEIGHT = 1.2;

export interface Position {
  readonly line: number;
  readonly column: number;
}

/** Líneas del texto: una por `tspan`, o el texto entero si no tiene. */
export function readLines(text: SVGTextElement): string[] {
  const spans = Array.from(text.children).filter((child) => child instanceof SVGTSpanElement);
  return spans.length === 0 ? [text.textContent] : spans.map((span) => span.textContent);
}

/** Tamaño de la fuente en unidades de usuario del texto. */
export function fontSize(text: SVGTextElement): number {
  return parseFloat(getComputedStyle(text).fontSize) || 16;
}

/** Origen del texto: la línea base de la primera línea. */
export function origin(text: SVGTextElement): { x: number; y: number } {
  return { x: text.x.baseVal[0]?.value ?? 0, y: text.y.baseVal[0]?.value ?? 0 };
}

/** Separación entre líneas base, en unidades de usuario. */
export const lineHeight = (text: SVGTextElement) => fontSize(text) * LINE_HEIGHT;

/** Escribe las líneas como `tspan` con `x` e `y` absolutos. */
export function writeLines(text: SVGTextElement, lines: readonly string[]): void {
  // Sin esto, el SVG junta los espacios seguidos y quita los del principio y el final: los
  // caracteres dejarían de corresponder con lo escrito (y un espacio al final no se vería).
  text.setAttributeNS(XML_NS, "xml:space", "preserve");
  const { x, y } = origin(text);
  const step = lineHeight(text);
  const spans = lines.map((line, index) => {
    const span = document.createElementNS(SVG_NS, "tspan");
    span.setAttribute("x", String(x));
    span.setAttribute("y", String(round(y + index * step)));
    span.textContent = line;
    return span;
  });
  text.replaceChildren(...spans);
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Posición (línea y columna) de un índice del texto con saltos de línea. */
export function toPosition(lines: readonly string[], index: number): Position {
  let rest = index;
  for (let line = 0; line < lines.length; line++) {
    const length = (lines[line] ?? "").length;
    if (rest <= length) return { line, column: rest };
    rest -= length + 1;
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, column: (lines[last] ?? "").length };
}

/** Índice del texto con saltos de línea de una posición. */
export function toIndex(lines: readonly string[], { line, column }: Position): number {
  let index = 0;
  for (let i = 0; i < line; i++) index += (lines[i] ?? "").length + 1;
  return index + column;
}

/** Número del primer carácter de la línea entre los caracteres del SVG (sin saltos de línea). */
export function firstChar(lines: readonly string[], line: number): number {
  let index = 0;
  for (let i = 0; i < line; i++) index += (lines[i] ?? "").length;
  return index;
}

/**
 * Punto de la línea base donde va el cursor, en unidades de usuario del texto, según la
 * disposición que hace el propio SVG.
 */
export function caretPoint(
  text: SVGTextElement,
  lines: readonly string[],
  position: Position,
): DOMPoint {
  const length = (lines[position.line] ?? "").length;
  const first = firstChar(lines, position.line);
  if (length === 0) {
    const { x, y } = origin(text);
    return new DOMPoint(x, y + position.line * lineHeight(text));
  }
  return position.column < length
    ? text.getStartPositionOfChar(first + position.column)
    : text.getEndPositionOfChar(first + length - 1);
}

/** Pasa un punto de la pantalla (clientX/Y) a unidades de usuario del texto. */
export function toUserSpace(text: SVGTextElement, clientX: number, clientY: number): DOMPoint {
  const matrix = text.getScreenCTM();
  if (!matrix) return new DOMPoint(clientX, clientY);
  return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
}

/**
 * Posición del texto más cercana a un punto en unidades de usuario: la línea por la altura y la
 * columna por la mitad de cada carácter, con la geometría del SVG.
 */
export function hitTest(text: SVGTextElement, lines: readonly string[], point: DOMPoint): Position {
  const size = fontSize(text);
  const { y } = origin(text);
  const top = y - 0.8 * size;
  const line = Math.min(
    lines.length - 1,
    Math.max(0, Math.floor((point.y - top) / lineHeight(text))),
  );
  const length = (lines[line] ?? "").length;
  const first = firstChar(lines, line);
  for (let column = 0; column < length; column++) {
    const extent = text.getExtentOfChar(first + column);
    if (point.x < extent.x + extent.width / 2) return { line, column };
  }
  return { line, column: length };
}

/** Escala de una matriz: cuántos píxeles de pantalla mide una unidad de usuario. */
export function scaleOf(matrix: DOMMatrixReadOnly | null): number {
  if (!matrix) return 1;
  return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
}
