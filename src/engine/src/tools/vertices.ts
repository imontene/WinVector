import type { Point } from "../geometry";
import { parsePath, pathNodes } from "../paths";
import { forgetPolygon, readPolygon } from "./polygons";
import { coordinate } from "./shapes";

/**
 * Vértices de las formas de segmentos rectos (issue #61): polígonos, polilíneas y líneas. Los
 * rectángulos y los polígonos y estrellas de WinVector también se editan, pero antes pasan a ser
 * polígonos normales (`toEditablePolygon`). Los nodos de los trazados se editan con el módulo
 * `paths` (issue #76).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Vertices {
  /** Vértices en las coordenadas del elemento (las de sus atributos). */
  readonly points: Point[];
  /** True si el último vértice se une con el primero (polígono). */
  readonly closed: boolean;
  /** Vértices que hay que dejar como mínimo: 3 en un polígono, 2 en una polilínea o una línea. */
  readonly minimum: number;
  /** False si no se pueden añadir ni quitar vértices (una línea tiene siempre dos). */
  readonly resizable: boolean;
}

/** Qué le pasa a una forma al editar sus vértices. */
export type VertexEditKind = "direct" | "rect" | "polygon" | "star";

/** Si la forma se puede editar por vértices y cómo, o `null` si no se puede. */
export function vertexEditKind(element: Element): VertexEditKind | null {
  if (element.namespaceURI !== SVG_NS) return null;
  const params = readPolygon(element);
  if (params)
    return element.localName === "polygon" || element.localName === "path" ? params.kind : null;
  if (element.localName === "rect") return "rect";
  // Los trazados se editan por nodos (issue #76).
  if (["polygon", "polyline", "line", "path"].includes(element.localName)) return "direct";
  return null;
}

/** Vértices de un polígono, una polilínea o una línea; `null` si no es uno de ellos. */
export function readVertices(element: Element): Vertices | null {
  if (element instanceof SVGPolygonElement || element instanceof SVGPolylineElement) {
    const closed = element instanceof SVGPolygonElement;
    return {
      points: Array.from(element.points, (p) => ({ x: p.x, y: p.y })),
      closed,
      minimum: closed ? 3 : 2,
      resizable: true,
    };
  }
  if (element instanceof SVGLineElement) {
    return {
      points: [
        { x: element.x1.baseVal.value, y: element.y1.baseVal.value },
        { x: element.x2.baseVal.value, y: element.y2.baseVal.value },
      ],
      closed: false,
      minimum: 2,
      resizable: false,
    };
  }
  return null;
}

/** Escribe los vértices en el elemento (que debe ser del tipo del que se leyeron). */
export function writeVertices(element: Element, points: readonly Point[]): void {
  if (element.localName === "line") {
    const [a, b] = points;
    if (!a || !b) return;
    element.setAttribute("x1", coordinate(a.x));
    element.setAttribute("y1", coordinate(a.y));
    element.setAttribute("x2", coordinate(b.x));
    element.setAttribute("y2", coordinate(b.y));
    return;
  }
  element.setAttribute(
    "points",
    points.map((p) => `${coordinate(p.x)},${coordinate(p.y)}`).join(" "),
  );
}

/**
 * Prepara una forma para editar sus vértices: un rectángulo pasa a ser un `<polygon>` con sus cuatro
 * esquinas (sin redondeo) y un polígono o estrella de WinVector pierde sus parámetros. Conserva el
 * resto de atributos y los hijos. Devuelve el elemento editable (el mismo u otro), o `null`.
 */
export function toEditablePolygon(element: Element): Element | null {
  const kind = vertexEditKind(element);
  if (kind === null) return null;
  if (kind === "direct") return element;
  if (kind === "polygon" || kind === "star") {
    forgetPolygon(element);
    return element;
  }
  const rect = element as SVGRectElement;
  const x = rect.x.baseVal.value;
  const y = rect.y.baseVal.value;
  const w = rect.width.baseVal.value;
  const h = rect.height.baseVal.value;
  const polygon = element.ownerDocument.createElementNS(SVG_NS, "polygon");
  const geometry = new Set(["x", "y", "width", "height", "rx", "ry"]);
  let wrote = false;
  for (const attribute of [...element.attributes]) {
    if (attribute.namespaceURI === null && geometry.has(attribute.name)) {
      if (!wrote) {
        writeVertices(polygon, [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ]);
      }
      wrote = true;
      continue;
    }
    polygon.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  if (!wrote)
    writeVertices(polygon, [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]);
  polygon.append(...element.childNodes);
  element.replaceWith(polygon);
  return polygon;
}

/**
 * Vértices de una forma editable para dibujarlos, también de un rectángulo (sus esquinas) y de un
 * trazado (sus nodos; de momento no se pueden añadir ni quitar desde aquí).
 */
export function displayVertices(element: Element): Vertices | null {
  if (element.localName === "path" && element.namespaceURI === SVG_NS) {
    const nodes = pathNodes(parsePath(element.getAttribute("d") ?? "").data);
    return { points: nodes.map((node) => node.point), closed: false, minimum: 0, resizable: false };
  }
  if (element instanceof SVGRectElement) {
    const x = element.x.baseVal.value;
    const y = element.y.baseVal.value;
    const w = element.width.baseVal.value;
    const h = element.height.baseVal.value;
    return {
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      closed: true,
      minimum: 3,
      resizable: true,
    };
  }
  return vertexEditKind(element) === null ? null : readVertices(element);
}

/** Punto del segmento de `a` a `b` más cercano a `p`, con su posición `t` entre 0 y 1. */
export function nearestOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Segmento más cercano a un punto: el índice del vértice donde empieza y el punto del segmento.
 * `null` si está más lejos que `tolerance` (en las unidades de los puntos).
 */
export function segmentAt(
  vertices: Vertices,
  p: Point,
  tolerance: number,
): { index: number; point: Point } | null {
  const { points, closed } = vertices;
  const count = closed ? points.length : points.length - 1;
  let best: { index: number; point: Point; distance: number } | null = null;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    const { point } = nearestOnSegment(p, a, b);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance <= tolerance && (!best || distance < best.distance))
      best = { index: i, point, distance };
  }
  return best ? { index: best.index, point: best.point } : null;
}

/** Inserta un vértice después del vértice `index`. */
export function insertVertex(points: readonly Point[], index: number, point: Point): Point[] {
  return [...points.slice(0, index + 1), point, ...points.slice(index + 1)];
}

/**
 * Quita los vértices indicados sin bajar del mínimo. Devuelve los puntos que quedan, o `null` si no
 * se puede quitar ninguno.
 */
export function removeVertices(vertices: Vertices, indices: ReadonlySet<number>): Point[] | null {
  if (!vertices.resizable || indices.size === 0) return null;
  const kept = vertices.points.filter((_, i) => !indices.has(i));
  return kept.length >= vertices.minimum ? kept : null;
}
