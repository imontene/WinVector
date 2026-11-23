import type { Point } from "../geometry";
import type { PathData, Segment, Subpath } from "./model";
import { nodeKey, pathNodes } from "./nodes";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

/**
 * Redondear vértices (issue #80): cada esquina entre dos rectas se sustituye por un arco circular
 * exacto, tangente a las dos, del radio pedido. El radio se limita a lo que cabe: si los arcos de
 * los dos extremos de un lado no caben en él, los dos se reducen en la misma proporción.
 *
 * Un trazado redondeado guarda su forma sin redondear y los radios en atributos `data-winvector-*`,
 * para cambiar o quitar el redondeo después sin perder la forma.
 */

/** `d` sin redondear. */
export const UNROUNDED = "data-winvector-unrounded";
/** Radios por nodo del `d` sin redondear: `"0:2=10 0:3=5"` (clave del nodo = radio). */
export const CORNER_RADII = "data-winvector-corner-radii";

const EPSILON = 1e-9;

/** Esquina entre dos rectas: el vértice, sus vecinos y lo que hace falta para redondearla. */
export interface Corner {
  readonly vertex: Point;
  readonly previous: Point;
  readonly next: Point;
  /** Direcciones unitarias del vértice hacia cada vecino. */
  readonly toPrevious: Point;
  readonly toNext: Point;
  /** Mitad del ángulo entre los dos lados, en radianes (0 a π/2). */
  readonly half: number;
  /** La esquina gira en el sentido de las agujas del reloj (en pantalla, con la y hacia abajo). */
  readonly clockwise: boolean;
}

/** Subtrazado como nodos y segmentos, con la vuelta al inicio escrita si está cerrado. */
interface Chain {
  readonly nodes: Point[];
  readonly segments: Segment[];
  readonly closed: boolean;
}

function chainOf(subpath: Subpath): Chain {
  const segments = [...subpath.segments];
  const last = segments.at(-1);
  const same = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
  if (subpath.closed && !(last && same(last.to, subpath.start))) {
    segments.push({ kind: "line", to: subpath.start });
  }
  const nodes = [subpath.start, ...segments.map((segment) => segment.to)];
  if (subpath.closed) nodes.pop();
  return { nodes, segments, closed: subpath.closed };
}

const unit = (from: Point, to: Point): Point | null => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length < EPSILON ? null : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** La esquina del nodo `i` de la cadena, o `null` si no está entre dos rectas o no hace esquina. */
function cornerAt(chain: Chain, i: number): Corner | null {
  const n = chain.nodes.length;
  const incoming = chain.closed ? (i - 1 + n) % n : i - 1;
  const outgoing = i;
  if (incoming < 0 || outgoing >= chain.segments.length || incoming === outgoing) return null;
  if (chain.segments[incoming]?.kind !== "line" || chain.segments[outgoing]?.kind !== "line") {
    return null;
  }
  const vertex = chain.nodes[i];
  const previous = chain.nodes[chain.closed ? (i - 1 + n) % n : i - 1];
  const next = chain.nodes[chain.closed ? (i + 1) % n : i + 1];
  if (!vertex || !previous || !next) return null;
  const toPrevious = unit(vertex, previous);
  const toNext = unit(vertex, next);
  if (!toPrevious || !toNext) return null;
  const cos = Math.min(1, Math.max(-1, toPrevious.x * toNext.x + toPrevious.y * toNext.y));
  const half = Math.acos(cos) / 2;
  // Sin esquina (los lados siguen recto) o con los lados uno encima del otro: no hay arco.
  if (half > Math.PI / 2 - 1e-6 || half < 1e-6) return null;
  const cross =
    (vertex.x - previous.x) * (next.y - vertex.y) - (vertex.y - previous.y) * (next.x - vertex.x);
  return { vertex, previous, next, toPrevious, toNext, half, clockwise: cross > 0 };
}

/** Esquina de un nodo de un trazado (por su clave), o `null` si no está entre dos rectas. */
export function cornerOf(data: PathData, key: string): Corner | null {
  const node = pathNodes(data).find((n) => nodeKey(n) === key);
  const subpath = node ? data[node.subpath] : undefined;
  return node && subpath ? cornerAt(chainOf(subpath), node.index) : null;
}

/** Claves de todos los nodos que son esquinas entre dos rectas (los que se pueden redondear). */
export function cornerKeys(data: PathData): string[] {
  return data.flatMap((subpath, s) => {
    const chain = chainOf(subpath);
    return chain.nodes.flatMap((_, i) =>
      cornerAt(chain, i) ? [nodeKey({ subpath: s, index: i })] : [],
    );
  });
}

/**
 * Redondea las esquinas de un subtrazado. `tangent` da, para cada esquina, la distancia del vértice
 * a la que empieza el arco (0: sin redondear); se reduce si no cabe.
 */
/** Distancia del vértice a la que empieza cada arco, reducida si no cabe en los lados. */
function filletLengths(
  chain: Chain,
  corners: readonly (Corner | null)[],
  tangent: (index: number, corner: Corner) => number,
): number[] {
  const n = chain.nodes.length;
  const wanted = corners.map((corner, i) => (corner ? Math.max(0, tangent(i, corner)) : 0));
  // Si los arcos de los dos extremos de un lado no caben en él, los dos se reducen igual.
  const scale = new Array<number>(n).fill(1);
  chain.segments.forEach((segment, j) => {
    const a = j;
    const b = chain.closed ? (j + 1) % n : j + 1;
    const from = chain.nodes[a];
    const to = chain.nodes[b];
    if (segment.kind !== "line" || !from || !to) return;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const total = (wanted[a] ?? 0) + (wanted[b] ?? 0);
    if (total > length) {
      const factor = length / total;
      scale[a] = Math.min(scale[a] ?? 1, factor);
      scale[b] = Math.min(scale[b] ?? 1, factor);
    }
  });
  return wanted.map((length, i) => length * (scale[i] ?? 1));
}

/**
 * Redondea las esquinas de un subtrazado. `tangent` da, para cada esquina, la distancia del vértice
 * a la que empieza el arco (0: sin redondear); se reduce si no cabe.
 */
function filletSubpath(
  subpath: Subpath,
  tangent: (index: number, corner: Corner) => number,
): Subpath {
  const chain = chainOf(subpath);
  const n = chain.nodes.length;
  const corners = chain.nodes.map((_, i) => cornerAt(chain, i));
  const lengths = filletLengths(chain, corners, tangent);
  if (lengths.every((length) => length < EPSILON)) return subpath;

  const along = (p: Point, direction: Point, distance: number): Point => ({
    x: p.x + direction.x * distance,
    y: p.y + direction.y * distance,
  });
  const rounded = (i: number) => {
    const corner = corners[i];
    const length = lengths[i] ?? 0;
    if (!corner || length < EPSILON) return null;
    return {
      enter: along(corner.vertex, corner.toPrevious, length),
      leave: along(corner.vertex, corner.toNext, length),
      radius: length * Math.tan(corner.half),
      sweep: corner.clockwise,
    };
  };

  const firstRound = chain.closed ? rounded(0) : null;
  const start = firstRound?.leave ?? subpath.start;
  const segments: Segment[] = [];
  let current = start;
  const lineTo = (to: Point) => {
    if (Math.hypot(to.x - current.x, to.y - current.y) > 1e-7) segments.push({ kind: "line", to });
    current = to;
  };
  chain.segments.forEach((segment, j) => {
    const target = chain.closed ? (j + 1) % n : j + 1;
    const round = segment.kind === "line" ? rounded(target) : null;
    if (!round) {
      if (segment.kind === "line") lineTo(segment.to);
      else {
        segments.push(segment);
        current = segment.to;
      }
      return;
    }
    lineTo(round.enter);
    segments.push({
      kind: "arc",
      rx: round.radius,
      ry: round.radius,
      rotation: 0,
      large: false,
      sweep: round.sweep,
      to: round.leave,
    });
    current = round.leave;
  });
  // En un subtrazado cerrado, la recta final que vuelve al inicio la dibuja la `Z`.
  const last = segments.at(-1);
  if (
    chain.closed &&
    segments.length > 1 &&
    last?.kind === "line" &&
    Math.hypot(last.to.x - start.x, last.to.y - start.y) < 1e-7
  ) {
    segments.pop();
  }
  return { start, segments, closed: subpath.closed };
}

/** Redondea las esquinas con los radios de cada nodo (por su clave); las demás no cambian. */
export function roundCorners(data: PathData, radii: ReadonlyMap<string, number>): PathData {
  return data.map((subpath, s) => {
    if (![...radii.keys()].some((key) => key.startsWith(`${String(s)}:`))) return subpath;
    return filletSubpath(subpath, (index, corner) => {
      const radius = radii.get(nodeKey({ subpath: s, index })) ?? 0;
      return radius / Math.tan(corner.half);
    });
  });
}

/**
 * Polígono con todas las esquinas redondeadas en proporción (polígonos regulares y estrellas, #58):
 * cada arco empieza a `rounding` veces la mitad del lado más corto de los dos que llegan al vértice.
 */
export function roundPolygon(vertices: readonly Point[], rounding: number): PathData {
  const [start, ...rest] = vertices;
  if (!start) return [];
  const subpath: Subpath = {
    start,
    segments: rest.map((to) => ({ kind: "line", to })),
    closed: true,
  };
  const amount = Math.min(1, Math.max(0, rounding));
  return [
    filletSubpath(subpath, (_, corner) => {
      const shortest = Math.min(
        Math.hypot(corner.previous.x - corner.vertex.x, corner.previous.y - corner.vertex.y),
        Math.hypot(corner.next.x - corner.vertex.x, corner.next.y - corner.vertex.y),
      );
      return (shortest / 2) * amount;
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Atributos del redondeo.
// ---------------------------------------------------------------------------------------------

/** Radio que de verdad tiene cada esquina redondeada: el pedido, reducido si no cabe. */
export function effectiveRadii(
  data: PathData,
  radii: ReadonlyMap<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  data.forEach((subpath, s) => {
    const chain = chainOf(subpath);
    const corners = chain.nodes.map((_, i) => cornerAt(chain, i));
    const tangent = (index: number, corner: Corner) =>
      (radii.get(nodeKey({ subpath: s, index })) ?? 0) / Math.tan(corner.half);
    filletLengths(chain, corners, tangent).forEach((length, i) => {
      const corner = corners[i];
      if (corner && length > EPSILON) {
        result.set(nodeKey({ subpath: s, index: i }), length * Math.tan(corner.half));
      }
    });
  });
  return result;
}

/** Forma sin redondear y radios de un trazado redondeado, o `null` si no lo está. */
export function readRounding(
  element: Element,
): { readonly source: PathData; readonly radii: Map<string, number> } | null {
  const unrounded = element.getAttribute(UNROUNDED);
  if (unrounded === null) return null;
  const radii = new Map<string, number>();
  for (const pair of (element.getAttribute(CORNER_RADII) ?? "").split(/\s+/)) {
    const [key, value] = pair.split("=");
    const radius = Number(value);
    if (key && /^\d+:\d+$/.test(key) && Number.isFinite(radius) && radius > 0)
      radii.set(key, radius);
  }
  return { source: parsePath(unrounded).data, radii };
}

const radiusText = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * Escribe un trazado con sus radios: el `d` redondeado y los atributos para volver a editarlo. Sin
 * radios, el trazado queda sin redondear y sin los atributos.
 */
export function writeRounding(
  element: Element,
  source: PathData,
  radii: ReadonlyMap<string, number>,
): void {
  const kept = [...radii].filter(([, radius]) => radius > 0);
  if (kept.length === 0) {
    forgetRounding(element);
    element.setAttribute("d", serializePath(source));
    return;
  }
  element.setAttribute("d", serializePath(roundCorners(source, new Map(kept))));
  element.setAttribute(UNROUNDED, serializePath(source));
  element.setAttribute(
    CORNER_RADII,
    kept
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
      .map(([key, radius]) => `${key}=${radiusText(radius)}`)
      .join(" "),
  );
}

/** Olvida el redondeo: el trazado queda como se ve, con sus arcos (al cambiar su `d` por otro lado). */
export function forgetRounding(element: Element): void {
  element.removeAttribute(UNROUNDED);
  element.removeAttribute(CORNER_RADII);
}

/**
 * Cambia la forma sin redondear de un trazado redondeado y conserva el radio de los nodos que siguen
 * en el mismo punto (al mover, añadir o quitar nodos, sus claves pueden cambiar).
 */
export function remapRadii(
  before: PathData,
  after: PathData,
  radii: ReadonlyMap<string, number>,
): Map<string, number> {
  const at = new Map(pathNodes(before).map((node) => [nodeKey(node), node.point]));
  const result = new Map<string, number>();
  const nodes = pathNodes(after);
  for (const [key, radius] of radii) {
    const point = at.get(key);
    if (!point) continue;
    const found = nodes.find(
      (node) => Math.abs(node.point.x - point.x) < 1e-9 && Math.abs(node.point.y - point.y) < 1e-9,
    );
    if (found) result.set(nodeKey(found), radius);
  }
  return result;
}

/**
 * Geometría que se edita de un trazado: la forma sin redondear si está redondeado (las herramientas
 * mueven sus vértices, no los arcos), o su `d`.
 */
export function editableData(element: Element): PathData {
  return readRounding(element)?.source ?? parsePath(element.getAttribute("d") ?? "").data;
}

/**
 * Escribe la geometría que se edita. En un trazado redondeado, los arcos se vuelven a calcular:
 * con `sameNodes` (al mover nodos) cada radio sigue en su nodo; si no, en el nodo que sigue en el
 * mismo punto.
 */
export function writeEditableData(element: Element, data: PathData, sameNodes: boolean): void {
  const rounding = readRounding(element);
  if (!rounding) {
    element.setAttribute("d", serializePath(data));
    return;
  }
  const radii = sameNodes ? rounding.radii : remapRadii(rounding.source, data, rounding.radii);
  writeRounding(element, data, radii);
}
