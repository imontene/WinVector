import {
  SVG_NS,
  caretPoint,
  firstChar,
  fontSize,
  hitTest,
  readLines,
  toIndex,
  toPosition,
  toUserSpace,
  writeLines,
  type Position,
} from "./modelo";

/**
 * Enfoque B: cursor y selección propios dibujados sobre el SVG con su propia geometría
 * (getStartPositionOfChar, getExtentOfChar), y un `textarea` invisible que recibe el teclado.
 *
 * El `textarea` hace todo lo que el sistema ya sabe hacer con texto: escribir, borrar, tildes con
 * teclas muertas, IME (la ventana de candidatos se coloca en el cursor porque el `textarea` se mueve
 * con él), atajos de selección y portapapeles, y es lo que lee un lector de pantalla. El SVG solo
 * se reescribe a partir de su valor, y el cursor y la selección se dibujan según su selección.
 * Las flechas arriba y abajo se resuelven con la geometría del SVG.
 */
export class OwnCaretEditor {
  readonly input: HTMLTextAreaElement;
  private readonly layer: SVGGElement;
  private readonly caret: SVGLineElement;
  private readonly selection: SVGPathElement;
  private lines: string[];
  /** Columna en unidades de usuario que se mantiene al subir y bajar de línea. */
  private goalX: number | undefined;
  private dragAnchor: number | undefined;
  private readonly abort = new AbortController();

  constructor(private readonly text: SVGTextElement) {
    this.lines = readLines(text);
    writeLines(text, this.lines);

    this.layer = document.createElementNS(SVG_NS, "g");
    this.layer.setAttribute("class", "edicion");
    const transform = text.getAttribute("transform");
    if (transform) this.layer.setAttribute("transform", transform);
    this.selection = document.createElementNS(SVG_NS, "path");
    this.selection.setAttribute("class", "seleccion");
    this.caret = document.createElementNS(SVG_NS, "line");
    this.caret.setAttribute("class", "cursor");
    this.layer.append(this.selection, this.caret);
    text.after(this.layer);

    this.input = document.createElement("textarea");
    this.input.className = "entrada-oculta";
    this.input.setAttribute("aria-label", text.getAttribute("aria-label") ?? "Texto");
    this.input.spellcheck = false;
    this.input.value = this.lines.join("\n");
    document.body.append(this.input);

    const signal = this.abort.signal;
    this.input.addEventListener(
      "input",
      () => {
        this.onInput();
      },
      { signal },
    );
    this.input.addEventListener(
      "keydown",
      (event) => {
        this.onKeyDown(event);
      },
      { signal },
    );
    document.addEventListener(
      "selectionchange",
      () => {
        this.render();
      },
      { signal },
    );
    text.addEventListener(
      "pointerdown",
      (event) => {
        this.onPointerDown(event);
      },
      { signal },
    );
    window.addEventListener(
      "pointermove",
      (event) => {
        this.onPointerMove(event);
      },
      { signal },
    );
    window.addEventListener("pointerup", () => (this.dragAnchor = undefined), { signal });

    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.render();
  }

  get value(): string {
    return this.input.value;
  }

  /** Termina la edición: el texto queda en el SVG y se quitan el cursor y la entrada. */
  close(): void {
    this.abort.abort();
    this.layer.remove();
    this.input.remove();
  }

  private onInput(): void {
    this.lines = this.input.value.split("\n");
    writeLines(this.text, this.lines);
    this.goalX = undefined;
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      if (!event.isComposing) this.goalX = undefined;
      return;
    }
    if (event.isComposing) return;
    event.preventDefault();
    const focus = this.focusIndex();
    const position = toPosition(this.lines, focus);
    const line = position.line + (event.key === "ArrowUp" ? -1 : 1);
    const x = this.goalX ?? caretPoint(this.text, this.lines, position).x;
    let target: number;
    if (line < 0) target = 0;
    else if (line >= this.lines.length) target = this.input.value.length;
    else target = toIndex(this.lines, this.columnAt(line, x));
    this.select(event.shiftKey ? this.anchorIndex() : target, target);
    this.goalX = x;
  }

  private onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    const index = this.indexAt(event);
    const anchor = event.shiftKey ? this.anchorIndex() : index;
    this.select(anchor, index);
    this.dragAnchor = anchor;
    this.input.focus();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.dragAnchor === undefined || event.buttons === 0) return;
    this.select(this.dragAnchor, this.indexAt(event));
  }

  private indexAt(event: PointerEvent): number {
    const point = toUserSpace(this.text, event.clientX, event.clientY);
    return toIndex(this.lines, hitTest(this.text, this.lines, point));
  }

  private columnAt(line: number, x: number): Position {
    const length = (this.lines[line] ?? "").length;
    const first = firstChar(this.lines, line);
    for (let column = 0; column < length; column++) {
      const extent = this.text.getExtentOfChar(first + column);
      if (x < extent.x + extent.width / 2) return { line, column };
    }
    return { line, column: length };
  }

  private anchorIndex(): number {
    return this.input.selectionDirection === "backward"
      ? this.input.selectionEnd
      : this.input.selectionStart;
  }

  private focusIndex(): number {
    return this.input.selectionDirection === "backward"
      ? this.input.selectionStart
      : this.input.selectionEnd;
  }

  private select(anchor: number, focus: number): void {
    if (anchor <= focus) this.input.setSelectionRange(anchor, focus, "forward");
    else this.input.setSelectionRange(focus, anchor, "backward");
    this.render();
  }

  /** Dibuja el cursor y la selección, y lleva el `textarea` al cursor para la ventana del IME. */
  render(): void {
    const size = fontSize(this.text);
    const focus = toPosition(this.lines, this.focusIndex());
    const point = caretPoint(this.text, this.lines, focus);
    this.caret.setAttribute("x1", String(point.x));
    this.caret.setAttribute("x2", String(point.x));
    this.caret.setAttribute("y1", String(point.y - 0.8 * size));
    this.caret.setAttribute("y2", String(point.y + 0.2 * size));

    const start = toPosition(this.lines, this.input.selectionStart);
    const end = toPosition(this.lines, this.input.selectionEnd);
    const parts: string[] = [];
    for (let line = start.line; line <= end.line && start.line !== -1; line++) {
      const from = line === start.line ? start.column : 0;
      const to = line === end.line ? end.column : (this.lines[line] ?? "").length;
      if (to <= from) continue;
      const left = caretPoint(this.text, this.lines, { line, column: from });
      const right = caretPoint(this.text, this.lines, { line, column: to });
      const top = left.y - 0.8 * size;
      const bottom = left.y + 0.2 * size;
      parts.push(
        `M${String(left.x)} ${String(top)}H${String(right.x)}V${String(bottom)}H${String(left.x)}Z`,
      );
    }
    this.selection.setAttribute("d", parts.join(""));
    this.caret.style.visibility = parts.length > 0 ? "hidden" : "visible";

    const matrix = this.text.getScreenCTM();
    const screen = matrix ? point.matrixTransform(matrix) : point;
    this.input.style.left = `${String(screen.x)}px`;
    this.input.style.top = `${String(screen.y)}px`;
  }
}
