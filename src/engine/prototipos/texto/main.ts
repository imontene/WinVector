import { CASES, EDIT_ID, FONTS } from "./casos";
import { SVG_NS, caretPoint, hitTest, readLines, scaleOf, toUserSpace } from "./modelo";
import { OwnCaretEditor } from "./propio";
import { OverlayEditor } from "./superpuesto";

/**
 * Página del prototipo (issue #35). Se abre con `npm run dev` en /prototipos/texto/ para probarlo
 * a mano, y la usan las mediciones de prototipos/texto.spec.ts a través de `window.__prototipo`.
 */

type Mode = "propio" | "superpuesto";
type Editor = OwnCaretEditor | OverlayEditor;

const ROW = 150;
const scene = document.getElementById("escena");
if (!scene) throw new Error("Falta #escena");

const svg = document.createElementNS(SVG_NS, "svg");
const height = (CASES.length + 2) * ROW;
svg.setAttribute("width", "1200");
svg.setAttribute("height", String(height));
svg.setAttribute("viewBox", `0 0 1200 ${String(height)}`);
scene.append(svg);

function addText(
  id: string,
  y: number,
  family: string,
  size: number,
  content: string,
  transform = "",
  letterSpacing?: number,
) {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", `translate(40 ${String(y)})`);
  const text = document.createElementNS(SVG_NS, "text");
  text.id = id;
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  text.setAttribute("font-family", family);
  text.setAttribute("font-size", String(size));
  text.setAttribute("aria-label", `Texto ${id}`);
  if (transform) text.setAttribute("transform", transform);
  if (letterSpacing !== undefined) text.setAttribute("letter-spacing", String(letterSpacing));
  text.textContent = content;
  group.append(text);
  svg.append(group);
  return text;
}

addText(EDIT_ID, 60, FONTS[0].family, 32, "Hola mundo");
CASES.forEach((item, index) => {
  addText(
    item.id,
    (index + 1.6) * ROW,
    item.font,
    item.size,
    item.text,
    item.transform,
    item.letterSpacing,
  );
});

let editor: Editor | undefined;

function text(id: string): SVGTextElement {
  const element = document.getElementById(id);
  if (!(element instanceof SVGTextElement)) throw new Error(`No hay texto ${id}`);
  return element;
}

function start(id: string, mode: Mode): void {
  stop();
  editor = mode === "propio" ? new OwnCaretEditor(text(id)) : new OverlayEditor(text(id));
}

function stop(): void {
  editor?.close();
  editor = undefined;
}

/** Punto de la pantalla en el centro vertical del carácter, a `fraction` de su anchura. */
function charPoint(id: string, index: number, fraction: number): { x: number; y: number } {
  const element = text(id);
  const extent = element.getExtentOfChar(index);
  const point = new DOMPoint(extent.x + extent.width * fraction, extent.y + extent.height / 2);
  const matrix = element.getScreenCTM();
  const screen = matrix ? point.matrixTransform(matrix) : point;
  return { x: screen.x, y: screen.y };
}

/**
 * Enfoque A: diferencia entre dónde coloca cada carácter el editor HTML y dónde lo dibuja el SVG,
 * en píxeles de pantalla. La disposición HTML no depende de la transformación, así que se mide sin
 * ella; la del SVG sí (Chromium ajusta la fuente a la escala de la pantalla).
 */
function measureOverlay(id: string) {
  const element = text(id);
  const overlay = new OverlayEditor(element);
  const node = overlay.input.firstChild;
  const content = readLines(element)[0] ?? "";
  const scale = scaleOf(element.getScreenCTM());
  overlay.input.style.transform = "none";
  const box = overlay.input.getBoundingClientRect();
  const range = document.createRange();
  let maxX = 0;
  let maxY = 0;
  let endX = 0;
  for (let index = 0; node && index < content.length; index++) {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    const extent = element.getExtentOfChar(index);
    const dx = rect.left - box.left - extent.x;
    const dy = rect.top - box.top - overlay.baseline - extent.y;
    maxX = Math.max(maxX, Math.abs(dx));
    maxY = Math.max(maxY, Math.abs(dy));
    endX = rect.right - box.left - (extent.x + extent.width);
  }
  overlay.close();
  const px = (value: number) => Math.round(value * scale * 100) / 100;
  return {
    maxX: px(maxX),
    maxY: px(maxY),
    endX: px(Math.abs(endX)),
    scale: Math.round(scale * 100) / 100,
  };
}

/** Enfoque B: el cálculo de posiciones con la geometría del SVG acierta el carácter de cada punto. */
function measureOwn(id: string) {
  const element = text(id);
  const lines = readLines(element);
  const content = lines[0] ?? "";
  let hits = 0;
  let maxCaret = 0;
  for (let index = 0; index < content.length; index++) {
    const point = charPoint(id, index, 0.4);
    const position = hitTest(element, lines, toUserSpace(element, point.x, point.y));
    if (position.line === 0 && position.column === index) hits++;
    const caret = caretPoint(element, lines, { line: 0, column: index });
    const start = element.getStartPositionOfChar(index);
    maxCaret = Math.max(maxCaret, Math.hypot(caret.x - start.x, caret.y - start.y));
  }
  return { hits, total: content.length, maxCaret };
}

function value(): string {
  return editor?.value ?? "";
}

function caretScreenX(): number | undefined {
  const caret = document.querySelector(".cursor");
  return caret?.getBoundingClientRect().x;
}

Object.assign(window, {
  __prototipo: {
    cases: CASES,
    start,
    stop,
    value,
    charPoint,
    measureOverlay,
    measureOwn,
    caretScreenX,
  },
});

// Uso manual: doble clic en un texto para editarlo con el modo elegido; Esc termina.
svg.addEventListener("dblclick", (event) => {
  if (!(event.target instanceof SVGTextElement || event.target instanceof SVGTSpanElement)) return;
  const target =
    event.target instanceof SVGTSpanElement ? event.target.parentElement : event.target;
  const checked = document.querySelector<HTMLInputElement>("input[name=modo]:checked");
  if (target instanceof SVGTextElement)
    start(target.id, checked?.value === "superpuesto" ? "superpuesto" : "propio");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") stop();
});
