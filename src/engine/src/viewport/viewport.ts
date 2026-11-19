import {
  applyToPoint,
  invert,
  rectFromCorners,
  type Matrix,
  type Point,
  type Rect,
} from "../geometry";

/** Límites del zoom: del 1 % al 6400 %. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

/** Niveles por los que pasan Acercar y Alejar. */
const ZOOM_LEVELS = [
  0.01, 0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4,
  6, 8, 12, 16, 24, 32, 48, 64,
];

/** Margen alrededor de la mesa de trabajo al ajustarla a la ventana, en píxeles. */
const FIT_MARGIN = 24;

/** Estado del viewport de un documento. */
export interface ViewportState {
  /** 1 = 100 %: una unidad de tamaño del documento ocupa un píxel CSS. */
  readonly zoom: number;
  /** Posición de la esquina superior izquierda de la mesa de trabajo en el lienzo, en píxeles. */
  readonly x: number;
  readonly y: number;
}

/** Espacio que ocupan las reglas en los bordes izquierdo y superior del lienzo. */
export interface Insets {
  readonly left: number;
  readonly top: number;
}

export interface ViewportOptions {
  readonly insets?: () => Insets;
  readonly onChange?: (state: ViewportState) => void;
}

/**
 * Tamaño natural de la mesa de trabajo en píxeles CSS: el de los atributos width y height del
 * elemento raíz (con sus unidades), o el del viewBox si faltan o son porcentajes.
 */
export function baseSize(root: SVGSVGElement): { width: number; height: number } {
  const viewBox = root.viewBox.baseVal as DOMRect | null;
  const ratio =
    viewBox && viewBox.width > 0 && viewBox.height > 0 ? viewBox.width / viewBox.height : null;
  const length = (name: "width" | "height") => {
    if (!root.hasAttribute(name)) return null;
    const value = root[name].baseVal;
    if (value.unitType === SVGLength.SVG_LENGTHTYPE_PERCENTAGE) return null;
    return value.value > 0 ? value.value : null;
  };
  let width = length("width");
  let height = length("height");
  if (width === null && height !== null && ratio) width = height * ratio;
  if (height === null && width !== null && ratio) height = width / ratio;
  if (width === null || height === null) {
    if (viewBox && ratio) return { width: viewBox.width, height: viewBox.height };
    return { width: width ?? 300, height: height ?? 150 };
  }
  return { width, height };
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/**
 * Zoom y desplazamiento de un documento (ADR 0004: cada documento conserva el suyo).
 *
 * El viewport no toca el documento: coloca y dimensiona el contenedor de la mesa de trabajo, y el
 * navegador pinta el SVG a ese tamaño, nítido a cualquier zoom.
 */
export class Viewport {
  readonly #artboard: HTMLElement;
  readonly #root: SVGSVGElement;
  readonly #workspace: HTMLElement;
  readonly #options: ViewportOptions;
  #zoom = 1;
  #x = 0;
  #y = 0;
  /** Mientras el usuario no cambie el zoom, la mesa se ajusta de nuevo al cambiar la ventana. */
  #fitted = true;
  #initialized = false;

  constructor(
    artboard: HTMLElement,
    root: SVGSVGElement,
    workspace: HTMLElement,
    options: ViewportOptions = {},
  ) {
    this.#artboard = artboard;
    this.#root = root;
    this.#workspace = workspace;
    this.#options = options;
  }

  get state(): ViewportState {
    return { zoom: this.#zoom, x: this.#x, y: this.#y };
  }

  get zoom(): number {
    return this.#zoom;
  }

  /** Se llama al mostrar el documento: la primera vez, lo ajusta a la ventana. */
  show(): void {
    if (this.#initialized) this.#apply();
    else this.fit();
  }

  /** El lienzo ha cambiado de tamaño. */
  resize(): void {
    if (this.#fitted) this.fit();
    else this.#apply();
  }

  /** El documento ha cambiado; puede que su tamaño también. */
  refresh(): void {
    this.#apply();
  }

  /** Ajusta la mesa de trabajo entera al lienzo, centrada. */
  fit(): void {
    const area = this.#area();
    const { width, height } = baseSize(this.#root);
    if (area.width <= 0 || area.height <= 0) {
      // El lienzo aún no tiene tamaño (documento oculto): se ajustará al mostrarlo.
      return;
    }
    const zoom = clampZoom(
      Math.min((area.width - 2 * FIT_MARGIN) / width, (area.height - 2 * FIT_MARGIN) / height),
    );
    this.#set(zoom, this.#centered(zoom, area), true);
  }

  /** Tamaño real (100 %), centrado. */
  actualSize(): void {
    this.#set(1, this.#centered(1, this.#area()), false);
  }

  /** Cambia el zoom manteniendo fijo el punto `anchor` (coordenadas de pantalla); por defecto, el centro. */
  zoomTo(zoom: number, anchor: Point = this.#center()): void {
    const next = clampZoom(zoom);
    const origin = this.#workspaceOrigin();
    const local = { x: anchor.x - origin.x, y: anchor.y - origin.y };
    const factor = next / this.#zoom;
    this.#set(
      next,
      { x: local.x - (local.x - this.#x) * factor, y: local.y - (local.y - this.#y) * factor },
      false,
    );
  }

  zoomBy(factor: number, anchor?: Point): void {
    this.zoomTo(this.#zoom * factor, anchor);
  }

  /** Siguiente nivel de zoom (Ctrl++). */
  zoomIn(anchor?: Point): void {
    this.zoomTo(ZOOM_LEVELS.find((level) => level > this.#zoom * 1.001) ?? MAX_ZOOM, anchor);
  }

  /** Nivel de zoom anterior (Ctrl+-). */
  zoomOut(anchor?: Point): void {
    this.zoomTo(ZOOM_LEVELS.findLast((level) => level < this.#zoom / 1.001) ?? MIN_ZOOM, anchor);
  }

  /** Acerca hasta que un rectángulo de pantalla (arrastrado con la herramienta Zoom) llene el lienzo. */
  zoomToRect(rect: Rect): void {
    const area = this.#area();
    if (rect.width < 1 || rect.height < 1) return;
    const factor = Math.min(area.width / rect.width, area.height / rect.height);
    const next = clampZoom(this.#zoom * factor);
    const applied = next / this.#zoom;
    const origin = this.#workspaceOrigin();
    // El centro del rectángulo pasa al centro del lienzo.
    const center = {
      x: rect.x + rect.width / 2 - origin.x,
      y: rect.y + rect.height / 2 - origin.y,
    };
    const target = {
      x: area.x - origin.x + area.width / 2,
      y: area.y - origin.y + area.height / 2,
    };
    this.#set(
      next,
      {
        x: target.x - (center.x - this.#x) * applied,
        y: target.y - (center.y - this.#y) * applied,
      },
      false,
    );
  }

  /** Desplaza la mesa de trabajo (en píxeles de pantalla). */
  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.#set(this.#zoom, { x: this.#x + dx, y: this.#y + dy }, false);
  }

  /** Matriz de unidades de usuario del documento (las del viewBox) a coordenadas de pantalla. */
  documentToScreen(): Matrix | null {
    const ctm = this.#root.getScreenCTM();
    return ctm ? { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f } : null;
  }

  /** Punto de pantalla en unidades del documento, o `null` si el documento no se ve. */
  screenToDocument(point: Point): Point | null {
    const matrix = this.documentToScreen();
    const inverse = matrix ? invert(matrix) : null;
    return inverse ? applyToPoint(inverse, point) : null;
  }

  /** Rectángulo de la mesa de trabajo en pantalla. */
  artboardRect(): Rect {
    const origin = this.#workspaceOrigin();
    const { width, height } = baseSize(this.#root);
    return rectFromCorners(
      { x: origin.x + this.#x, y: origin.y + this.#y },
      { x: origin.x + this.#x + width * this.#zoom, y: origin.y + this.#y + height * this.#zoom },
    );
  }

  #set(zoom: number, position: Point, fitted: boolean): void {
    this.#zoom = zoom;
    this.#x = position.x;
    this.#y = position.y;
    this.#fitted = fitted;
    this.#initialized = true;
    this.#apply();
  }

  #apply(): void {
    const { width, height } = baseSize(this.#root);
    const style = this.#artboard.style;
    style.setProperty("--artboard-x", `${String(this.#x)}px`);
    style.setProperty("--artboard-y", `${String(this.#y)}px`);
    style.setProperty("--artboard-width", `${String(width * this.#zoom)}px`);
    style.setProperty("--artboard-height", `${String(height * this.#zoom)}px`);
    this.#options.onChange?.(this.state);
  }

  /** Posición centrada de la mesa de trabajo a un zoom dado, relativa al lienzo. */
  #centered(zoom: number, area: Rect): Point {
    const origin = this.#workspaceOrigin();
    const { width, height } = baseSize(this.#root);
    return {
      x: area.x - origin.x + (area.width - width * zoom) / 2,
      y: area.y - origin.y + (area.height - height * zoom) / 2,
    };
  }

  #workspaceOrigin(): Point {
    const rect = this.#workspace.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  /** Zona útil del lienzo en pantalla: sin las reglas. */
  #area(): Rect {
    const rect = this.#workspace.getBoundingClientRect();
    const insets = this.#options.insets?.() ?? { left: 0, top: 0 };
    return {
      x: rect.left + insets.left,
      y: rect.top + insets.top,
      width: Math.max(0, rect.width - insets.left),
      height: Math.max(0, rect.height - insets.top),
    };
  }

  #center(): Point {
    const area = this.#area();
    return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  }
}
