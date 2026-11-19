import { applyToPoint, type Matrix, type Point } from "./matrix";

/** Rectángulo alineado con los ejes. El ancho y el alto nunca son negativos. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Rectángulo entre dos esquinas cualesquiera (por ejemplo, el inicio y el final de un arrastre). */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Las cuatro esquinas de un rectángulo, en el sentido de las agujas del reloj desde arriba a la izquierda. */
export function corners(rect: Rect): [Point, Point, Point, Point] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ];
}

/** Rectángulo más pequeño que contiene todos los puntos, o `null` si no hay ninguno. */
export function boundsOfPoints(points: Iterable<Point>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Caja alineada con los ejes de un rectángulo tras aplicarle `m` (que puede girarlo). */
export function transformRect(m: Matrix, rect: Rect): Rect {
  return boundsOfPoints(corners(rect).map((p) => applyToPoint(m, p))) ?? rect;
}

/** Rectángulo que contiene a todos, o `null` si no hay ninguno. */
export function union(rects: Iterable<Rect>): Rect | null {
  return boundsOfPoints([...rects].flatMap((rect) => [corners(rect)[0], corners(rect)[2]]));
}

/** True si `inner` está entero dentro de `outer` (los bordes cuentan como dentro). */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
