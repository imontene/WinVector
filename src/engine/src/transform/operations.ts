import { multiply, rotation, scaling, translation, type Matrix, type Point } from "../geometry";
import type { History } from "../history";
import {
  applyTransform,
  circleToEllipse,
  elementToRoot,
  outermost,
  restore,
  snapshot,
  type Snapshot,
} from "./apply";

/** Mover: desplazamiento en unidades del documento. */
export const moveBy = (dx: number, dy: number): Matrix => translation(dx, dy);

/** Escalar respecto a un punto fijo (el manejador opuesto o el centro). */
export function scaleAround(sx: number, sy: number, anchor: Point): Matrix {
  return multiply(
    translation(anchor.x, anchor.y),
    multiply(scaling(sx, sy), translation(-anchor.x, -anchor.y)),
  );
}

/** Girar en grados alrededor de un punto. */
export const rotateAround = (degrees: number, center: Point): Matrix => rotation(degrees, center);

/** Aplica `m` (en unidades del documento) a todos los elementos, sin repetir los anidados. */
export function transformItems(items: readonly Element[], m: Matrix, root: SVGSVGElement): void {
  for (const item of outermost(items)) applyTransform(item, m, root);
}

/**
 * Transformación continua de la selección, como un arrastre: cada `update` parte del estado
 * inicial, así que no se acumulan errores, y todo el gesto es un solo paso del historial.
 */
export class TransformSession {
  readonly #root: SVGSVGElement;
  readonly #history: History;
  readonly #snapshots: Snapshot[];
  #open = true;

  constructor(items: readonly Element[], root: SVGSVGElement, history: History, action: string) {
    this.#root = root;
    this.#history = history;
    this.#snapshots = outermost(items).map(snapshot);
    history.begin(action);
  }

  /** Deja la selección como al empezar transformada por `m`. */
  update(m: Matrix): void {
    if (!this.#open) return;
    for (const saved of this.#snapshots) {
      restore(saved);
      applyTransform(saved.element, m, this.#root);
    }
  }

  /**
   * Termina el gesto: queda como un paso del historial (si cambió algo). Los círculos que el gesto
   * ha escalado de forma desigual pasan a ser elipses; devuelve cada elemento sustituido con el
   * que lo sustituye, para actualizar la selección.
   */
  commit(): ReadonlyMap<Element, Element> {
    const replaced = new Map<Element, Element>();
    if (!this.#open) return replaced;
    this.#open = false;
    for (const saved of this.#snapshots) {
      if (saved.attributes.get("transform") !== null) continue;
      const ellipse = circleToEllipse(saved.element);
      if (ellipse) replaced.set(saved.element, ellipse);
    }
    this.#history.commit();
    return replaced;
  }

  /** Cancela el gesto (Esc): todo vuelve a como estaba y no queda ningún paso. */
  cancel(): void {
    if (!this.#open) return;
    for (const saved of this.#snapshots) restore(saved);
    this.#open = false;
    this.#history.commit();
  }
}

/**
 * Giro de un elemento respecto al documento, en grados entre -180 y 180 (0 si no se puede medir).
 * Es el ángulo del eje x del elemento.
 */
export function rotationOf(element: Element, root: SVGSVGElement): number {
  const m = elementToRoot(element, root);
  if (!m) return 0;
  const degrees = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const rounded = Math.round(degrees * 1e6) / 1e6;
  return rounded === -180 || Object.is(rounded, -0) ? Math.abs(rounded) : rounded;
}
