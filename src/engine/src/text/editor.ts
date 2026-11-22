import type { Point } from "../geometry";
import { baselines, fontSize, lineHeight, origin, readLines, writeLines } from "./model";

/**
 * Edición de un texto en el lienzo (issue #93), con el enfoque B del ADR 0006: el cursor y la
 * selección se calculan con la geometría del propio `<text>` y se dibujan en la capa de
 * superposición (fuera del documento); un `textarea` invisible recibe el teclado.
 *
 * El `textarea` hace lo que el sistema ya sabe hacer con texto: escribir, borrar, tildes con teclas
 * muertas, IME (su ventana se coloca junto al cursor porque el `textarea` se mueve con él), atajos de
 * selección, portapapeles y deshacer mientras se edita, y es lo que lee el lector de pantalla. El
 * SVG solo se reescribe a partir de su valor. El ratón y las flechas arriba y abajo se resuelven con
 * la geometría del SVG.
 */

export interface Position {
  readonly line: number;
  readonly column: number;
}

/** Lo que dibuja la capa de superposición, en pantalla: el cursor o los rectángulos seleccionados. */
export interface TextEditScene {
  readonly caret: readonly [Point, Point] | null;
  readonly selection: readonly (readonly Point[])[];
}

/** Ascendente y descendente aproximados, en múltiplos del tamaño de la fuente. */
const ASCENT = 0.8;
const DESCENT = 0.2;

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

/** Número del primer carácter de una línea entre los caracteres del SVG (sin saltos de línea). */
export function firstChar(lines: readonly string[], line: number): number {
  let index = 0;
  for (let i = 0; i < line; i++) index += (lines[i] ?? "").length;
  return index;
}

/** Teclas modificadoras: pulsarlas solas no mueve el cursor. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** Teclas con Ctrl que atiende el propio `textarea` (no deben llegar a los atajos del lienzo). */
const NATIVE_CTRL_KEYS = new Set([
  "a",
  "c",
  "x",
  "v",
  "z",
  "y",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "backspace",
  "delete",
]);

export interface TextEditorHost {
  /** Ha cambiado el texto, el cursor o la selección: hay que volver a dibujar. */
  changed(): void;
  /** El usuario ha pedido terminar (Esc). */
  finish(): void;
}

export class TextEditor {
  readonly text: SVGTextElement;
  readonly input: HTMLTextAreaElement;
  /** El valor al empezar, para saber si se ha cambiado algo. */
  readonly initial: string;
  #lines: string[];
  /** Columna en unidades del texto que se mantiene al subir y bajar de línea. */
  #goalX: number | undefined;
  #dragAnchor: number | undefined;
  readonly #host: TextEditorHost;
  readonly #abort = new AbortController();

  constructor(text: SVGTextElement, host: TextEditorHost, label: string) {
    this.text = text;
    this.#host = host;
    this.#lines = readLines(text);
    this.initial = this.#lines.join("\n");
    writeLines(text, this.#lines);

    const page = text.ownerDocument;
    this.input = page.createElement("textarea");
    this.input.className = "text-input";
    this.input.setAttribute("aria-label", label);
    this.input.spellcheck = false;
    this.input.value = this.initial;
    page.body.append(this.input);

    const signal = this.#abort.signal;
    this.input.addEventListener(
      "input",
      () => {
        this.#onInput();
      },
      { signal },
    );
    this.input.addEventListener(
      "keydown",
      (event) => {
        this.#onKeyDown(event);
      },
      { signal },
    );
    this.input.addEventListener(
      "keyup",
      (event) => {
        event.stopPropagation();
      },
      { signal },
    );
    page.addEventListener(
      "selectionchange",
      () => {
        this.#host.changed();
      },
      { signal },
    );
    this.input.addEventListener(
      "blur",
      () => {
        this.#host.changed();
      },
      { signal },
    );

    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.#place();
  }

  get value(): string {
    return this.input.value;
  }

  /** Termina la edición: el texto queda en el SVG y se quita la entrada. */
  close(): void {
    this.#abort.abort();
    this.input.remove();
  }

  /** Vuelve a leer el texto del SVG (después de deshacer o de un cambio de estilo). */
  focus(): void {
    this.input.focus({ preventScroll: true });
  }

  #onInput(): void {
    this.#lines = this.input.value.split("\n");
    writeLines(this.text, this.#lines);
    this.#goalX = undefined;
    this.#place();
    this.#host.changed();
  }

  #onKeyDown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    // Lo que va al texto no debe llegar a los atajos del lienzo ni de las herramientas. Los demás
    // atajos con Ctrl (guardar, zoom…) siguen su camino hasta la aplicación.
    if (!ctrl || NATIVE_CTRL_KEYS.has(event.key.toLowerCase())) event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.#host.finish();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      // Pulsar solo una tecla modificadora (Mayús para seleccionar) no olvida la columna.
      if (!MODIFIER_KEYS.has(event.key)) this.#goalX = undefined;
      return;
    }
    event.preventDefault();
    const focus = this.#focusIndex();
    const position = toPosition(this.#lines, focus);
    const line = position.line + (event.key === "ArrowUp" ? -1 : 1);
    const x = this.#goalX ?? this.#caretPoint(position).x;
    let target: number;
    if (line < 0) target = 0;
    else if (line >= this.#lines.length) target = this.input.value.length;
    else target = toIndex(this.#lines, this.#columnAt(line, x));
    this.#select(event.shiftKey ? this.#anchorIndex() : target, target);
    this.#goalX = x;
  }

  /** Pulsación sobre el texto que se edita: coloca el cursor (con Mayús, amplía la selección). */
  pointerDown(clientX: number, clientY: number, extend: boolean): void {
    const index = this.indexAt(clientX, clientY);
    const anchor = extend ? this.#anchorIndex() : index;
    this.#select(anchor, index);
    this.#dragAnchor = anchor;
    this.focus();
  }

  /** Arrastre con el botón pulsado: selecciona desde donde se pulsó. */
  pointerMove(clientX: number, clientY: number): void {
    if (this.#dragAnchor === undefined) return;
    this.#select(this.#dragAnchor, this.indexAt(clientX, clientY));
  }

  pointerUp(): void {
    this.#dragAnchor = undefined;
  }

  /** Índice del texto (con saltos de línea) más cercano a un punto de la pantalla. */
  indexAt(clientX: number, clientY: number): number {
    const matrix = this.text.getScreenCTM();
    const point = matrix
      ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      : new DOMPoint(clientX, clientY);
    const lines = baselinesOf(this.text, this.#lines);
    const size = fontSize(this.text);
    // La línea cuya franja (de ascendente a descendente) está más cerca del punto.
    let line = 0;
    let best = Infinity;
    lines.forEach((baseline, i) => {
      const middle = baseline - ((ASCENT - DESCENT) / 2) * size;
      const distance = Math.abs(point.y - middle);
      if (distance < best) {
        best = distance;
        line = i;
      }
    });
    return toIndex(this.#lines, this.#columnAt(line, point.x));
  }

  /** Doble clic: selecciona la palabra del punto (con los separadores de palabras del idioma). */
  selectWordAt(clientX: number, clientY: number): void {
    const { line, column } = toPosition(this.#lines, this.indexAt(clientX, clientY));
    const text = this.#lines[line] ?? "";
    const start = toIndex(this.#lines, { line, column: 0 });
    for (const segment of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
      const end = segment.index + segment.segment.length;
      if (column < end || end === text.length) {
        this.#select(start + segment.index, start + end);
        return;
      }
    }
    this.#select(start, start);
  }

  /** Triple clic: selecciona la línea entera del punto. */
  selectLineAt(clientX: number, clientY: number): void {
    const { line } = toPosition(this.#lines, this.indexAt(clientX, clientY));
    const start = toIndex(this.#lines, { line, column: 0 });
    this.#select(start, start + (this.#lines[line] ?? "").length);
  }

  /** Selecciona entre dos índices del texto (con saltos de línea). */
  selectRange(anchor: number, focus: number): void {
    this.#select(anchor, focus);
  }

  /** Lo que hay que dibujar, en pantalla. */
  scene(): TextEditScene {
    const matrix = this.text.getScreenCTM();
    const toScreen = (x: number, y: number): Point => {
      const p = matrix ? new DOMPoint(x, y).matrixTransform(matrix) : new DOMPoint(x, y);
      return { x: p.x, y: p.y };
    };
    const size = fontSize(this.text);
    const start = toPosition(this.#lines, this.input.selectionStart);
    const end = toPosition(this.#lines, this.input.selectionEnd);
    const selection: Point[][] = [];
    for (let line = start.line; line <= end.line; line++) {
      const from = line === start.line ? start.column : 0;
      const to = line === end.line ? end.column : (this.#lines[line] ?? "").length;
      if (to <= from) continue;
      const left = this.#caretPoint({ line, column: from });
      const right = this.#caretPoint({ line, column: to });
      const top = left.y - ASCENT * size;
      const bottom = left.y + DESCENT * size;
      selection.push([
        toScreen(left.x, top),
        toScreen(right.x, top),
        toScreen(right.x, bottom),
        toScreen(left.x, bottom),
      ]);
    }
    const focused = this.text.ownerDocument.activeElement === this.input;
    if (selection.length > 0 || !focused) return { caret: null, selection };
    const caret = this.#caretPoint(toPosition(this.#lines, this.#focusIndex()));
    return {
      caret: [
        toScreen(caret.x, caret.y - ASCENT * size),
        toScreen(caret.x, caret.y + DESCENT * size),
      ],
      selection,
    };
  }

  /**
   * Columna de una línea más cercana a una x en unidades del texto. Solo entre grafemas: el cursor
   * nunca queda en medio de un emoji, de un par sustituto o de una letra con su acento combinado.
   */
  #columnAt(line: number, x: number): Position {
    const text = this.#lines[line] ?? "";
    const first = firstChar(this.#lines, line);
    const parts = graphemes(text);
    for (const [i, { index }] of parts.entries()) {
      // Un grafema de varias unidades se dibuja con la primera (las demás no tienen anchura): va de
      // donde empieza la primera a donde empieza el siguiente grafema (o acaba la línea).
      const left = this.text.getStartPositionOfChar(first + index).x;
      const next = parts[i + 1];
      const right = next
        ? this.text.getStartPositionOfChar(first + next.index).x
        : this.text.getEndPositionOfChar(first + text.length - 1).x;
      if (x < (left + right) / 2) return { line, column: index };
    }
    return { line, column: text.length };
  }

  /** Punto de la línea base donde va el cursor, según la disposición que hace el propio SVG. */
  #caretPoint(position: Position): DOMPoint {
    const length = (this.#lines[position.line] ?? "").length;
    const first = firstChar(this.#lines, position.line);
    if (length === 0) {
      const baseline = baselinesOf(this.text, this.#lines)[position.line] ?? origin(this.text).y;
      return new DOMPoint(lineStartX(this.text, position.line), baseline);
    }
    return position.column < length
      ? this.text.getStartPositionOfChar(first + position.column)
      : this.text.getEndPositionOfChar(first + length - 1);
  }

  #anchorIndex(): number {
    return this.input.selectionDirection === "backward"
      ? this.input.selectionEnd
      : this.input.selectionStart;
  }

  #focusIndex(): number {
    return this.input.selectionDirection === "backward"
      ? this.input.selectionStart
      : this.input.selectionEnd;
  }

  #select(anchor: number, focus: number): void {
    if (anchor <= focus) this.input.setSelectionRange(anchor, focus, "forward");
    else this.input.setSelectionRange(focus, anchor, "backward");
    this.#place();
    this.#host.changed();
  }

  /** Lleva el `textarea` al cursor, para que la ventana del IME salga junto a él. */
  #place(): void {
    const caret = this.#caretPoint(toPosition(this.#lines, this.#focusIndex()));
    const matrix = this.text.getScreenCTM();
    const screen = matrix ? caret.matrixTransform(matrix) : caret;
    this.input.style.left = `${String(screen.x)}px`;
    this.input.style.top = `${String(screen.y)}px`;
  }
}

/** Línea base de cada línea; las que no tienen `tspan` (una sola línea) usan el origen. */
function baselinesOf(text: SVGTextElement, lines: readonly string[]): number[] {
  const found = baselines(text);
  if (found.length === lines.length) return found;
  const { y } = origin(text);
  const step = fontSize(text) * lineHeight(text);
  return lines.map((_, i) => y + i * step);
}

/** Dónde empieza una línea vacía: su `x`, o la del texto. */
function lineStartX(text: SVGTextElement, line: number): number {
  const span = [...text.children].filter((child) => child.localName === "tspan")[line];
  const x = Number.parseFloat(span?.getAttribute("x") ?? "");
  return Number.isFinite(x) ? x : origin(text).x;
}

/** Grafemas de un texto, con su posición en unidades UTF-16 (las del SVG y del `textarea`). */
function graphemes(text: string): Intl.SegmentData[] {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
}
