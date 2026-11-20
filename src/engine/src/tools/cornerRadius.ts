import { applyToPoint, invert, type Matrix, type Point } from "../geometry";
import { formatNumber } from "../transform";
import type { ShapeHandles } from "./shapeHandles";

/**
 * Radio de las esquinas de un rectángulo, con un manejador en el lienzo: un círculo dentro de la
 * esquina superior derecha, en el centro del arco. Arrastrarlo hacia dentro redondea las esquinas
 * y llevarlo a la esquina las deja rectas.
 */

/** Distancia mínima del manejador a la esquina, en píxeles: así no tapa al manejador de escalar. */
export const RADIUS_HANDLE_INSET = 14;

interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Radio actual en unidades propias del rectángulo (el de `rx`, o el de `ry` si solo tiene ese). */
  readonly radius: number;
  /** Del rectángulo a la pantalla. */
  readonly toScreen: Matrix;
}

function geometry(rect: SVGRectElement): Geometry | null {
  const ctm = rect.getScreenCTM();
  if (!ctm) return null;
  const width = rect.width.baseVal.value;
  const height = rect.height.baseVal.value;
  if (width <= 0 || height <= 0) return null;
  const rx = rect.hasAttribute("rx") ? rect.rx.baseVal.value : null;
  const ry = rect.hasAttribute("ry") ? rect.ry.baseVal.value : null;
  return {
    x: rect.x.baseVal.value,
    y: rect.y.baseVal.value,
    width,
    height,
    radius: Math.min(rx ?? ry ?? 0, width / 2, height / 2),
    toScreen: { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f },
  };
}

/** Píxeles de pantalla por unidad del rectángulo (la media de sus dos ejes). */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

/**
 * Lado menor, en píxeles, por debajo del cual no hay manejador: en un rectángulo pequeño taparía el
 * centro y no dejaría arrastrarlo.
 */
export const RADIUS_HANDLE_MIN_SIZE = 3 * RADIUS_HANDLE_INSET;

/**
 * Posición del manejador en pantalla, o `null` si el rectángulo no se puede medir o es demasiado
 * pequeño en pantalla.
 */
export function radiusHandlePoint(rect: SVGRectElement): Point | null {
  const g = geometry(rect);
  if (!g) return null;
  if (Math.min(g.width, g.height) * scaleOf(g.toScreen) < RADIUS_HANDLE_MIN_SIZE) return null;
  const limit = Math.min(g.width, g.height) / 2;
  const inset = Math.min(limit, Math.max(g.radius, RADIUS_HANDLE_INSET / scaleOf(g.toScreen)));
  return applyToPoint(g.toScreen, { x: g.x + g.width - inset, y: g.y + inset });
}

/** Manejador del radio de un rectángulo, o `null` si no se puede medir. */
export function radiusHandles(rect: SVGRectElement): ShapeHandles | null {
  const point = radiusHandlePoint(rect);
  if (!point) return null;
  return {
    action: "corner-radius",
    cursor: "radius",
    replacesBox: false,
    points: () => [point],
    start: (_, pointer) => new RadiusDrag(rect, pointer),
  };
}

/**
 * Un arrastre del manejador: el radio cambia tanto como el puntero se acerca al centro siguiendo la
 * diagonal de la esquina, así que pulsar sin mover no cambia nada.
 */
export class RadiusDrag {
  readonly #rect: SVGRectElement;
  readonly #start: number;
  readonly #startDiagonal: number;
  readonly #limit: number;
  readonly #toLocal: Matrix;
  readonly #corner: Point;

  constructor(rect: SVGRectElement, pointer: Point) {
    const g = geometry(rect);
    const toLocal = g ? invert(g.toScreen) : null;
    if (!g || !toLocal) throw new Error("No se puede medir el rectángulo.");
    this.#rect = rect;
    this.#start = g.radius;
    this.#limit = Math.min(g.width, g.height) / 2;
    this.#toLocal = toLocal;
    this.#corner = { x: g.x + g.width, y: g.y };
    this.#startDiagonal = this.#diagonal(pointer);
  }

  /** Distancia del puntero a la esquina medida a lo largo de la diagonal, en unidades del rectángulo. */
  #diagonal(pointer: Point): number {
    const local = applyToPoint(this.#toLocal, pointer);
    return (this.#corner.x - local.x + (local.y - this.#corner.y)) / 2;
  }

  /** Radio para la posición del puntero, entre 0 y la mitad del lado menor. */
  radiusAt(pointer: Point): number {
    const radius = this.#start + this.#diagonal(pointer) - this.#startDiagonal;
    return Math.min(this.#limit, Math.max(0, radius));
  }

  /** Escribe el radio: `rx` y `ry` iguales, o ninguno si las esquinas quedan rectas. */
  update(pointer: Point): void {
    setCornerRadius(this.#rect, this.radiusAt(pointer));
  }
}

/** Escribe el radio de las esquinas de un rectángulo (sin `rx` ni `ry` si es cero). */
export function setCornerRadius(rect: Element, radius: number): void {
  const value = Math.round(radius * 100) / 100;
  if (value <= 0) {
    rect.removeAttribute("rx");
    rect.removeAttribute("ry");
    return;
  }
  const text = formatNumber(value);
  if (rect.getAttribute("rx") !== text) rect.setAttribute("rx", text);
  if (rect.getAttribute("ry") !== text) rect.setAttribute("ry", text);
}
