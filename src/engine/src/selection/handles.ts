import { applyToPoint, transformRect, type Point, type Rect } from "../geometry";
import { selectionBounds } from "./bounds";

/** Manejadores de la selección: ocho para escalar y uno para girar. */
export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

/** Lado de cada manejador cuadrado, en píxeles de pantalla. */
export const HANDLE_SIZE = 8;
/** Distancia del manejador de giro sobre el borde superior, en píxeles de pantalla. */
export const ROTATE_HANDLE_OFFSET = 24;
/** Margen alrededor de cada manejador para acertar con el puntero. */
const HIT_TOLERANCE = 4;

/** Posición en pantalla de cada manejador para una caja de selección en pantalla. */
export function handlePositions(rect: Rect): { id: HandleId; point: Point }[] {
  const { x, y, width, height } = rect;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return [
    { id: "nw", point: { x, y } },
    { id: "n", point: { x: cx, y } },
    { id: "ne", point: { x: x + width, y } },
    { id: "e", point: { x: x + width, y: cy } },
    { id: "se", point: { x: x + width, y: y + height } },
    { id: "s", point: { x: cx, y: y + height } },
    { id: "sw", point: { x, y: y + height } },
    { id: "w", point: { x, y: cy } },
    { id: "rotate", point: { x: cx, y: y - ROTATE_HANDLE_OFFSET } },
  ];
}

/** Manejador bajo un punto de la pantalla, o `null`. */
export function handleAt(point: Point, rect: Rect): HandleId | null {
  const reach = HANDLE_SIZE / 2 + HIT_TOLERANCE;
  for (const { id, point: handle } of handlePositions(rect)) {
    if (Math.abs(point.x - handle.x) <= reach && Math.abs(point.y - handle.y) <= reach) return id;
  }
  return null;
}

/** Caja de la selección en pantalla (la de unidades del documento, llevada a la pantalla). */
export function selectionScreenRect(items: readonly Element[], root: SVGSVGElement): Rect | null {
  const bounds = selectionBounds(items, root);
  const ctm = root.getScreenCTM();
  if (!bounds || !ctm) return null;
  return transformRect({ a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f }, bounds);
}

/** Punto de la pantalla en unidades del documento. */
export function screenToRoot(point: Point, root: SVGSVGElement): Point | null {
  const ctm = root.getScreenCTM();
  if (!ctm) return null;
  const inverse = ctm.inverse();
  return applyToPoint(
    { a: inverse.a, b: inverse.b, c: inverse.c, d: inverse.d, e: inverse.e, f: inverse.f },
    point,
  );
}
