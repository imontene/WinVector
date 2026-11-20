import { LINE_HEIGHT, fontSize, origin, readLines, writeLines } from "./modelo";

/**
 * Enfoque A: un editor HTML (`contenteditable`) superpuesto exactamente al `text`, con la misma
 * fuente y la transformación del texto en pantalla. El editor es transparente: el texto lo sigue
 * dibujando el SVG, que se reescribe con cada cambio, y del editor solo se ven el cursor y la
 * selección. Todo lo demás (teclado, IME, tildes, selección, lectores de pantalla) lo hace el
 * navegador. El riesgo es que el HTML y el SVG no coloquen los caracteres en el mismo sitio.
 */
export class OverlayEditor {
  readonly input: HTMLDivElement;
  private readonly abort = new AbortController();
  /** Desde la parte de arriba de la línea hasta su línea base, en unidades de usuario. */
  readonly baseline: number;

  constructor(private readonly text: SVGTextElement) {
    const lines = readLines(text);
    writeLines(text, lines);
    const style = getComputedStyle(text);
    const size = fontSize(text);
    const lineHeight = size * LINE_HEIGHT;

    // La línea base dentro de la línea HTML: medio interlineado más el ascendente de la fuente.
    const context = document.createElement("canvas").getContext("2d");
    let ascent = 0.8 * size;
    let descent = 0.2 * size;
    if (context) {
      context.font = `${style.fontStyle} ${style.fontWeight} ${String(size)}px ${style.fontFamily}`;
      const metrics = context.measureText("Hg");
      ascent = metrics.fontBoundingBoxAscent;
      descent = metrics.fontBoundingBoxDescent;
    }
    this.baseline = (lineHeight - ascent - descent) / 2 + ascent;

    this.input = document.createElement("div");
    this.input.className = "editor-superpuesto";
    this.input.contentEditable = "plaintext-only";
    this.input.spellcheck = false;
    this.input.setAttribute("role", "textbox");
    this.input.setAttribute("aria-multiline", "true");
    this.input.setAttribute("aria-label", text.getAttribute("aria-label") ?? "Texto");
    Object.assign(this.input.style, {
      fontFamily: style.fontFamily,
      fontSize: `${String(size)}px`,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing,
      wordSpacing: style.wordSpacing,
      fontKerning: style.fontKerning,
      lineHeight: `${String(lineHeight)}px`,
    });
    this.input.textContent = lines.join("\n");
    document.body.append(this.input);
    this.place();

    const signal = this.abort.signal;
    this.input.addEventListener(
      "input",
      () => {
        this.onInput();
      },
      { signal },
    );
    window.addEventListener(
      "resize",
      () => {
        this.place();
      },
      { signal },
    );

    this.input.focus();
    const selection = getSelection();
    selection?.selectAllChildren(this.input);
    selection?.collapseToEnd();
  }

  get value(): string {
    return this.input.innerText.replace(/\n$/, "");
  }

  /** Coloca el editor sobre el texto: su línea base coincide con la del primer `tspan`. */
  place(): void {
    const matrix = this.text.getScreenCTM();
    const { x, y } = origin(this.text);
    const local = `translate(${String(x)}px, ${String(y - this.baseline)}px)`;
    this.input.style.transform = matrix
      ? `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(String).join(", ")}) ${local}`
      : local;
  }

  close(): void {
    this.abort.abort();
    this.input.remove();
  }

  private onInput(): void {
    writeLines(this.text, this.value.split("\n"));
  }
}
