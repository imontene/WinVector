import { multiplesBetween, niceStep, type Matrix, type Rect } from "../geometry";

/** Grosor de las reglas en píxeles. */
export const RULER_SIZE = 20;

/** Separación mínima en pantalla entre las líneas de la cuadrícula y entre los números de la regla. */
const GRID_MIN_PIXELS = 8;
const GRID_MAJOR_MIN_PIXELS = 40;
const RULER_LABEL_MIN_PIXELS = 60;

/** Qué guías se muestran. */
export interface GuideOptions {
  readonly showRulers: boolean;
  readonly showGrid: boolean;
}

/**
 * Separación de la cuadrícula en unidades del documento a una escala dada (píxeles por unidad).
 * Se adapta al zoom; el ajuste a la cuadrícula usa la misma separación que se ve.
 */
export function gridSpacing(scale: number): number {
  return niceStep(scale, GRID_MIN_PIXELS);
}

/** Paso de las marcas pequeñas de la regla para un paso de números dado. */
function minorStep(major: number, scale: number): number {
  for (const divisions of [10, 5, 2]) {
    if ((major / divisions) * scale >= 5) return major / divisions;
  }
  return major;
}

/** Texto de un número de la regla: sin decimales de más. */
const label = (value: number) => String(Number(value.toPrecision(6)));

/**
 * Reglas y cuadrícula del lienzo, en unidades del documento (las del viewBox).
 *
 * Se dibujan en lienzos de mapa de bits fuera del documento y no reciben el puntero. Se vuelven a
 * dibujar en cada cambio de zoom o desplazamiento, así que siguen al documento sin saltos.
 */
export class Guides {
  readonly #workspace: HTMLElement;
  readonly #grid: HTMLCanvasElement;
  readonly #top: HTMLCanvasElement;
  readonly #left: HTMLCanvasElement;
  readonly #corner: HTMLElement;
  #options: GuideOptions = { showRulers: true, showGrid: false };

  constructor(workspace: HTMLElement) {
    this.#workspace = workspace;
    const doc = workspace.ownerDocument;
    const make = (className: string) => {
      const canvas = doc.createElement("canvas");
      canvas.className = className;
      canvas.setAttribute("aria-hidden", "true");
      return canvas;
    };
    this.#grid = make("grid");
    this.#top = make("ruler ruler-top");
    this.#left = make("ruler ruler-left");
    this.#corner = doc.createElement("div");
    this.#corner.className = "ruler-corner";
    workspace.append(this.#grid, this.#top, this.#left, this.#corner);
    this.options = this.#options;
  }

  get options(): GuideOptions {
    return this.#options;
  }

  set options(options: GuideOptions) {
    this.#options = options;
    const rulers = options.showRulers ? "" : "none";
    this.#top.style.display = rulers;
    this.#left.style.display = rulers;
    this.#corner.style.display = rulers;
    this.#grid.style.display = options.showGrid ? "" : "none";
  }

  /** Espacio que ocupan las reglas. */
  get insets(): { left: number; top: number } {
    const size = this.#options.showRulers ? RULER_SIZE : 0;
    return { left: size, top: size };
  }

  /**
   * Dibuja las guías. `matrix` lleva las unidades del documento a la pantalla (sin giro) y
   * `artboard` es la mesa de trabajo en pantalla; los dos son `null` si no hay documento visible.
   */
  render(matrix: Matrix | null, artboard: Rect | null): void {
    const area = this.#workspace.getBoundingClientRect();
    const colors = this.#colors();
    if (this.#options.showGrid) this.#renderGrid(area, matrix, artboard, colors);
    if (this.#options.showRulers) {
      this.#renderRuler(this.#top, "x", area, matrix, colors);
      this.#renderRuler(this.#left, "y", area, matrix, colors);
    }
  }

  #renderGrid(area: DOMRect, matrix: Matrix | null, artboard: Rect | null, colors: Colors): void {
    const ctx = prepare(this.#grid, area.width, area.height);
    if (!ctx || !matrix || !artboard) return;
    const scaleX = matrix.a;
    const scaleY = matrix.d;
    const minor = gridSpacing(Math.min(scaleX, scaleY));
    const major = niceStep(Math.min(scaleX, scaleY), GRID_MAJOR_MIN_PIXELS);
    // Solo dentro de la mesa de trabajo y de la parte visible del lienzo.
    const left = Math.max(artboard.x, area.left);
    const top = Math.max(artboard.y, area.top);
    const right = Math.min(artboard.x + artboard.width, area.right);
    const bottom = Math.min(artboard.y + artboard.height, area.bottom);
    if (right <= left || bottom <= top) return;
    ctx.save();
    ctx.translate(-area.left, -area.top);
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    const isMajor = (value: number) => Math.abs(value / major - Math.round(value / major)) < 1e-6;
    for (const kind of ["minor", "major"] as const) {
      ctx.beginPath();
      for (const value of multiplesBetween(
        (left - matrix.e) / scaleX,
        (right - matrix.e) / scaleX,
        minor,
      )) {
        if ((kind === "major") !== isMajor(value)) continue;
        const x = Math.round(scaleX * value + matrix.e) + 0.5;
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (const value of multiplesBetween(
        (top - matrix.f) / scaleY,
        (bottom - matrix.f) / scaleY,
        minor,
      )) {
        if ((kind === "major") !== isMajor(value)) continue;
        const y = Math.round(scaleY * value + matrix.f) + 0.5;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.strokeStyle = kind === "major" ? colors.gridMajor : colors.grid;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  #renderRuler(
    canvas: HTMLCanvasElement,
    axis: "x" | "y",
    area: DOMRect,
    matrix: Matrix | null,
    colors: Colors,
  ): void {
    const horizontal = axis === "x";
    const length = (horizontal ? area.width : area.height) - RULER_SIZE;
    const ctx = horizontal
      ? prepare(canvas, length, RULER_SIZE)
      : prepare(canvas, RULER_SIZE, length);
    if (!ctx) return;
    ctx.fillStyle = colors.rulerBackground;
    ctx.fillRect(0, 0, horizontal ? length : RULER_SIZE, horizontal ? RULER_SIZE : length);
    ctx.fillStyle = colors.rulerLine;
    if (horizontal) ctx.fillRect(0, RULER_SIZE - 1, length, 1);
    else ctx.fillRect(RULER_SIZE - 1, 0, 1, length);
    if (!matrix) return;

    const scale = horizontal ? matrix.a : matrix.d;
    // Posición en la regla del valor 0 del documento.
    const offset = horizontal
      ? matrix.e - area.left - RULER_SIZE
      : matrix.f - area.top - RULER_SIZE;
    const major = niceStep(Math.abs(scale), RULER_LABEL_MIN_PIXELS);
    const minor = minorStep(major, Math.abs(scale));
    const from = (0 - offset) / scale;
    const to = (length - offset) / scale;
    const isMajor = (value: number) => Math.abs(value / major - Math.round(value / major)) < 1e-6;
    const half = Math.abs(major / 2);

    ctx.fillStyle = colors.rulerText;
    ctx.strokeStyle = colors.rulerLine;
    ctx.lineWidth = 1;
    ctx.font = "10px 'Segoe UI', system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.beginPath();
    for (const value of multiplesBetween(Math.min(from, to), Math.max(from, to), minor)) {
      const position = Math.round(offset + value * scale) + 0.5;
      const big = isMajor(value);
      const middle = !big && Math.abs(value / half - Math.round(value / half)) < 1e-6;
      const tick = big ? RULER_SIZE : middle ? 8 : 4;
      if (horizontal) {
        ctx.moveTo(position, RULER_SIZE - tick);
        ctx.lineTo(position, RULER_SIZE);
      } else {
        ctx.moveTo(RULER_SIZE - tick, position);
        ctx.lineTo(RULER_SIZE, position);
      }
      if (!big) continue;
      if (horizontal) {
        ctx.fillText(label(value), position + 3, 2);
      } else {
        // En la regla vertical, el número se escribe girado, como en las aplicaciones de diseño.
        ctx.save();
        ctx.translate(2, position + 3);
        ctx.rotate(Math.PI / 2);
        ctx.fillText(label(value), 0, -10);
        ctx.restore();
      }
    }
    ctx.stroke();
  }

  #colors(): Colors {
    const style = getComputedStyle(this.#workspace);
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      grid: read("--grid-line", "rgb(0 0 0 / 8%)"),
      gridMajor: read("--grid-line-major", "rgb(0 0 0 / 16%)"),
      rulerBackground: read("--ruler-background", "#f3f3f3"),
      rulerLine: read("--ruler-line", "#8a8a8a"),
      rulerText: read("--ruler-text", "#5c5c5c"),
    };
  }
}

interface Colors {
  readonly grid: string;
  readonly gridMajor: string;
  readonly rulerBackground: string;
  readonly rulerLine: string;
  readonly rulerText: string;
}

/** Ajusta el tamaño del lienzo a la densidad de la pantalla y lo deja limpio. */
function prepare(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(0, Math.round(width * ratio));
  const pixelHeight = Math.max(0, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${String(Math.max(0, width))}px`;
  canvas.style.height = `${String(Math.max(0, height))}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
