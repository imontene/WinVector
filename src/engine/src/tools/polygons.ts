import type { Point } from "../geometry";
import { roundPolygon } from "../paths/round";
import { serializePath } from "../paths/serialize";
import { coordinate, snapAngle, type ShapeDrag, type ShapeKind } from "./shapes";

/**
 * Polígonos regulares y estrellas con sus parámetros: se guardan como `<polygon>` (o como `<path>`
 * si tienen las esquinas redondeadas) con los parámetros en atributos `data-winvector-*`, para poder
 * volver a editarlos. Un polígono de otro programa, sin esos atributos, es un polígono normal.
 */

export type PolygonKind = "polygon" | "star";

export interface PolygonParams {
  readonly kind: PolygonKind;
  /** Lados del polígono o puntas de la estrella (3 o más). */
  readonly sides: number;
  /** Radio interior de la estrella respecto al exterior (entre 0 y 1). */
  readonly inner: number;
  readonly cx: number;
  readonly cy: number;
  /** Radio exterior: del centro a cada vértice o punta. */
  readonly r: number;
  /** Ángulo del primer vértice en grados, desde el eje x (hacia abajo es positivo). */
  readonly rotation: number;
  /** Redondeo de las esquinas, entre 0 (rectas) y 1 (tanto como cabe). */
  readonly rounding: number;
}

export const MIN_SIDES = 3;
export const MAX_SIDES = 100;

const PREFIX = "data-winvector-";
const NAMES = ["shape", "sides", "inner", "cx", "cy", "r", "rotation", "rounding"] as const;

/** Vértices: los del polígono o, en una estrella, las puntas alternando con los valles. */
export function polygonVertices(params: PolygonParams): Point[] {
  const count = params.kind === "star" ? params.sides * 2 : params.sides;
  const vertices: Point[] = [];
  for (let i = 0; i < count; i++) {
    const radius = params.kind === "star" && i % 2 === 1 ? params.r * params.inner : params.r;
    const angle = ((params.rotation + (360 * i) / count) * Math.PI) / 180;
    vertices.push({
      x: params.cx + radius * Math.cos(angle),
      y: params.cy + radius * Math.sin(angle),
    });
  }
  return vertices;
}

/** El elemento que corresponde a los parámetros: `polygon`, o `path` si hay redondeo. */
export const polygonTag = (params: PolygonParams) => (params.rounding > 0 ? "path" : "polygon");

const pointText = (p: Point) => `${coordinate(p.x)},${coordinate(p.y)}`;

/**
 * Trazado de un polígono con las esquinas redondeadas con arcos circulares exactos (issue #80): cada
 * arco empieza a una distancia del vértice proporcional al redondeo (como mucho, la mitad del lado
 * más corto de los dos que llegan a él).
 */
export function roundedPath(vertices: readonly Point[], rounding: number): string {
  return serializePath(roundPolygon(vertices, rounding));
}

/** Escribe la geometría y los parámetros en el elemento (que debe ser del tipo de `polygonTag`). */
export function writePolygon(element: Element, params: PolygonParams): void {
  const vertices = polygonVertices(params);
  if (element.localName === "path")
    element.setAttribute("d", roundedPath(vertices, params.rounding));
  else element.setAttribute("points", vertices.map(pointText).join(" "));
  const values: Record<(typeof NAMES)[number], string | null> = {
    shape: params.kind,
    sides: String(params.sides),
    inner: params.kind === "star" ? coordinate(params.inner) : null,
    cx: coordinate(params.cx),
    cy: coordinate(params.cy),
    r: coordinate(params.r),
    rotation: coordinate(params.rotation),
    rounding: params.rounding > 0 ? coordinate(params.rounding) : null,
  };
  for (const name of NAMES) {
    const value = values[name];
    if (value === null) element.removeAttribute(PREFIX + name);
    else if (element.getAttribute(PREFIX + name) !== value)
      element.setAttribute(PREFIX + name, value);
  }
}

/** Parámetros de un polígono o estrella creado con WinVector, o `null` si no los tiene. */
export function readPolygon(element: Element): PolygonParams | null {
  const kind = element.getAttribute(`${PREFIX}shape`);
  if (kind !== "polygon" && kind !== "star") return null;
  const read = (name: string, fallback?: number) => {
    const text = element.getAttribute(PREFIX + name);
    const value = text === null ? fallback : Number(text);
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
  const sides = read("sides");
  const cx = read("cx");
  const cy = read("cy");
  const r = read("r");
  const rotation = read("rotation", 0);
  const inner = read("inner", 0.5);
  const rounding = read("rounding", 0);
  if (
    sides === null ||
    !Number.isInteger(sides) ||
    sides < MIN_SIDES ||
    cx === null ||
    cy === null ||
    r === null ||
    rotation === null ||
    inner === null ||
    rounding === null
  ) {
    return null;
  }
  return { kind, sides, inner, cx, cy, r, rotation, rounding };
}

/** Quita los parámetros: la forma pasa a ser un polígono normal (al editar sus vértices). */
export function forgetPolygon(element: Element): void {
  for (const name of NAMES) element.removeAttribute(PREFIX + name);
}

/** Lados y puntas con los que nacen las formas; las flechas los cambian durante el arrastre. */
const created = { polygon: 6, star: 5, inner: 0.5 };

/** Centro, radio y giro de un arrastre: del centro al primer vértice (`Mayús`: de 15° en 15°). */
function dragGeometry(drag: ShapeDrag) {
  const end = drag.proportional ? snapAngle(drag.start, drag.end) : drag.end;
  const dx = end.x - drag.start.x;
  const dy = end.y - drag.start.y;
  return { r: Math.hypot(dx, dy), rotation: (Math.atan2(dy, dx) * 180) / Math.PI };
}

function polygonKind(kind: PolygonKind): ShapeKind {
  return {
    tagFor: () => "polygon",
    action: kind === "star" ? "create-star" : "create-polygon",
    apply(element, drag) {
      const { r, rotation } = dragGeometry(drag);
      writePolygon(element, {
        kind,
        sides: created[kind],
        inner: created.inner,
        cx: drag.start.x,
        cy: drag.start.y,
        r,
        rotation,
        rounding: 0,
      });
    },
    isEmpty: (drag) => dragGeometry(drag).r < 1e-6,
    adjust(key) {
      const step = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
      if (step === 0) return false;
      created[kind] = Math.min(MAX_SIDES, Math.max(MIN_SIDES, created[kind] + step));
      return true;
    },
  };
}

/** Polígono regular: se arrastra desde el centro hasta un vértice. */
export const POLYGON = polygonKind("polygon");
/** Estrella: se arrastra desde el centro hasta una punta. */
export const STAR = polygonKind("star");

/**
 * Cambia parámetros de un polígono o estrella de WinVector y rehace su geometría. Si el redondeo
 * hace que pase de `polygon` a `path` (o al revés), el elemento se sustituye por otro con los mismos
 * atributos; devuelve el elemento resultante, o `null` si no tenía parámetros.
 */
export function updatePolygon(element: Element, changes: Partial<PolygonParams>): Element | null {
  const current = readPolygon(element);
  if (!current) return null;
  const sides = Math.round(changes.sides ?? current.sides);
  const params: PolygonParams = {
    ...current,
    ...changes,
    kind: current.kind,
    sides: Math.min(MAX_SIDES, Math.max(MIN_SIDES, sides)),
    inner: Math.min(1, Math.max(0.01, changes.inner ?? current.inner)),
    r: Math.max(0, changes.r ?? current.r),
    rounding: Math.min(1, Math.max(0, changes.rounding ?? current.rounding)),
  };
  let target = element;
  const tag = polygonTag(params);
  if (element.localName !== tag) {
    target = element.ownerDocument.createElementNS(element.namespaceURI, tag);
    for (const attribute of [...element.attributes]) {
      if (
        attribute.namespaceURI === null &&
        (attribute.name === "points" || attribute.name === "d")
      )
        continue;
      target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
    target.append(...element.childNodes);
    element.replaceWith(target);
  }
  writePolygon(target, params);
  return target;
}
