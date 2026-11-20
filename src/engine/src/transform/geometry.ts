import { multiply, scaling, translation, type Rect } from "../geometry";
import type { History } from "../history";
import { selectionBounds } from "../selection";
import { circleToEllipse, outermost } from "./apply";
import { rotateAround, rotationOf, transformItems } from "./operations";

/** Valores que se quieren para la selección; `null` deja el valor como está. */
export interface GeometryTarget {
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number | null;
  readonly height: number | null;
  /** Giro en grados; solo con un único objeto. */
  readonly rotation: number | null;
}

const EPSILON = 1e-6;
const differs = (target: number | null, current: number) =>
  target !== null && Number.isFinite(target) && Math.abs(target - current) > EPSILON;

/** Diferencia entre dos ángulos, entre -180 y 180. */
const angleDelta = (to: number, from: number) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * Lleva la selección a la posición, el tamaño y el giro indicados (panel de propiedades), en un
 * solo paso del historial. La caja es la de toda la selección en unidades del documento: escalar
 * fija su esquina superior izquierda.
 *
 * Los círculos sin `transform` que se escalan de forma desigual pasan a ser elipses; si se pasa
 * `replaced`, se anota en él cada elemento sustituido con el que lo sustituye.
 *
 * @returns `false` si no había nada que cambiar.
 */
export function setGeometry(
  items: readonly Element[],
  root: SVGSVGElement,
  history: History,
  target: GeometryTarget,
  replaced?: Map<Element, Element>,
): boolean {
  const initial = selectionBounds(items, root);
  if (!initial) return false;
  const single = items.length === 1 ? items[0] : undefined;
  const rotate =
    single !== undefined &&
    target.rotation !== null &&
    Math.abs(angleDelta(target.rotation, rotationOf(single, root))) > EPSILON;
  const resize =
    (differs(target.width, initial.width) && initial.width > EPSILON && (target.width ?? 0) > 0) ||
    (differs(target.height, initial.height) &&
      initial.height > EPSILON &&
      (target.height ?? 0) > 0);
  const move = differs(target.x, initial.x) || differs(target.y, initial.y);
  if (!rotate && !resize && !move) return false;

  const action =
    rotate && !resize && !move
      ? "rotate"
      : resize && !rotate
        ? "scale"
        : !rotate && !resize
          ? "move"
          : "transform";
  const plainCircles = outermost(items).filter(
    (item) => item.localName === "circle" && !item.hasAttribute("transform"),
  );
  history.transact(action, () => {
    let bounds: Rect = initial;
    if (rotate) {
      const delta = angleDelta(target.rotation, rotationOf(single, root));
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      transformItems(items, rotateAround(delta, center), root);
      bounds = selectionBounds(items, root) ?? bounds;
    }
    const scale = (value: number | null, current: number) =>
      value !== null && value > 0 && current > EPSILON ? value / current : 1;
    const sx = scale(target.width, bounds.width);
    const sy = scale(target.height, bounds.height);
    const x = target.x ?? bounds.x;
    const y = target.y ?? bounds.y;
    // La esquina superior izquierda va a (x, y) y la caja toma el tamaño pedido.
    const m = multiply(
      translation(x, y),
      multiply(scaling(sx, sy), translation(-bounds.x, -bounds.y)),
    );
    transformItems(items, m, root);
    for (const circle of plainCircles) {
      const ellipse = circleToEllipse(circle);
      if (ellipse) replaced?.set(circle, ellipse);
    }
  });
  return true;
}
