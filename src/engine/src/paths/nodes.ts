import type { Point } from "../geometry";
import type { PathData, Segment, Subpath } from "./model";

/**
 * Nodos y manejadores de un trazado (issue #76), para la herramienta de nodos.
 *
 * - Los **nodos** son el inicio de cada subtrazado y el final de cada segmento. En un subtrazado
 *   cerrado cuyo último segmento vuelve exactamente al inicio, ese final es el mismo nodo que el
 *   inicio: mover uno mueve el otro.
 * - Los **manejadores** son los puntos de control: en una cúbica, `c1` sale del nodo de su inicio y
 *   `c2` llega al nodo de su final; en una cuadrática, su único control cuelga del nodo de su inicio.
 *   Los arcos no tienen manejadores (ADR 0007).
 */

/** Nodo de un trazado: subtrazado e índice (0: el inicio; `i`: el final del segmento `i - 1`). */
export interface NodeRef {
  readonly subpath: number;
  readonly index: number;
}

export type HandleKind = "c1" | "c2" | "c";

/** Manejador: el punto de control `kind` del segmento `segment` de un subtrazado. */
export interface HandleRef {
  readonly subpath: number;
  readonly segment: number;
  readonly kind: HandleKind;
}

export interface PathNode extends NodeRef {
  readonly point: Point;
  /** Manejadores del nodo: el que llega (del segmento anterior) y el que sale (del siguiente). */
  readonly handles: readonly HandleRef[];
}

const EPSILON = 1e-9;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

/** True si el último segmento de un subtrazado cerrado vuelve al inicio: su final no es otro nodo. */
function lastIsStart(subpath: Subpath): boolean {
  const last = subpath.segments.at(-1);
  return subpath.closed && last !== undefined && same(last.to, subpath.start);
}

/** Punto de un manejador en su subtrazado, o `null` si el segmento no lo tiene. */
function handlePoint(subpath: Subpath, handle: HandleRef): Point | null {
  const segment = subpath.segments[handle.segment];
  if (!segment) return null;
  if (handle.kind === "c" && segment.kind === "quad") return segment.c;
  if (segment.kind === "cubic" && handle.kind !== "c") return segment[handle.kind];
  return null;
}

/** Todos los nodos del trazado, con sus manejadores. */
export function pathNodes(data: PathData): PathNode[] {
  const nodes: PathNode[] = [];
  data.forEach((subpath, s) => {
    const merged = lastIsStart(subpath);
    const count = subpath.segments.length + 1 - (merged ? 1 : 0);
    for (let index = 0; index < count; index++) {
      const point =
        index === 0 ? subpath.start : (subpath.segments[index - 1]?.to ?? subpath.start);
      const handles: HandleRef[] = [];
      // El que llega: c2 del segmento anterior (en el inicio de uno cerrado y fundido, el del último).
      const incoming = index === 0 ? (merged ? subpath.segments.length - 1 : -1) : index - 1;
      const previous = subpath.segments[incoming];
      if (previous?.kind === "cubic") handles.push({ subpath: s, segment: incoming, kind: "c2" });
      // El que sale: c1 (o c) del segmento siguiente.
      const next = subpath.segments[index];
      if (next?.kind === "cubic") handles.push({ subpath: s, segment: index, kind: "c1" });
      if (next?.kind === "quad") handles.push({ subpath: s, segment: index, kind: "c" });
      nodes.push({ subpath: s, index, point, handles });
    }
  });
  return nodes;
}

/** Punto de un manejador, o `null` si ya no existe. */
export function handleAt(data: PathData, handle: HandleRef): Point | null {
  const subpath = data[handle.subpath];
  return subpath ? handlePoint(subpath, handle) : null;
}

/** Nodo al que pertenece un manejador. */
export function handleNode(data: PathData, handle: HandleRef): NodeRef {
  const subpath = data[handle.subpath];
  const index = handle.kind === "c2" ? handle.segment + 1 : handle.segment;
  // El final del último segmento fundido con el inicio es el nodo 0.
  if (index === subpath?.segments.length && lastIsStart(subpath)) {
    return { subpath: handle.subpath, index: 0 };
  }
  return { subpath: handle.subpath, index };
}

export const nodeKey = (node: NodeRef) => `${String(node.subpath)}:${String(node.index)}`;

const offset = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

/** Cambia un segmento del subtrazado. */
function withSegment(
  subpath: Subpath,
  index: number,
  change: (segment: Segment) => Segment,
): Subpath {
  return {
    ...subpath,
    segments: subpath.segments.map((segment, i) => (i === index ? change(segment) : segment)),
  };
}

/**
 * Mueve los nodos indicados (por `nodeKey`) con sus manejadores. Los nodos de los subtrazados
 * cerrados fundidos se mueven juntos.
 */
export function moveNodes(
  data: PathData,
  keys: ReadonlySet<string>,
  dx: number,
  dy: number,
): PathData {
  return data.map((subpath, s) => {
    const merged = lastIsStart(subpath);
    const moves = (index: number) =>
      keys.has(nodeKey({ subpath: s, index })) ||
      (merged && index === subpath.segments.length && keys.has(nodeKey({ subpath: s, index: 0 })));
    const start = keys.has(nodeKey({ subpath: s, index: 0 }))
      ? offset(subpath.start, dx, dy)
      : subpath.start;
    const segments = subpath.segments.map((segment, i): Segment => {
      const fromMoves = moves(i);
      const toMoves = moves(i + 1);
      const to = toMoves ? offset(segment.to, dx, dy) : segment.to;
      switch (segment.kind) {
        case "cubic":
          return {
            ...segment,
            c1: fromMoves ? offset(segment.c1, dx, dy) : segment.c1,
            c2: toMoves ? offset(segment.c2, dx, dy) : segment.c2,
            to,
          };
        case "quad":
          // El control de una cuadrática cuelga del nodo de su inicio.
          return { ...segment, c: fromMoves ? offset(segment.c, dx, dy) : segment.c, to };
        default:
          return { ...segment, to };
      }
    });
    return { ...subpath, start, segments };
  });
}

/** El otro manejador del mismo nodo (el que sale si se mueve el que llega, y al revés), o `null`. */
export function oppositeHandle(data: PathData, handle: HandleRef): HandleRef | null {
  const node = handleNode(data, handle);
  const found = pathNodes(data).find((n) => n.subpath === node.subpath && n.index === node.index);
  return found?.handles.find((h) => h.segment !== handle.segment || h.kind !== handle.kind) ?? null;
}

/** Cómo es un nodo según sus dos manejadores. */
export type NodeKind = "corner" | "smooth" | "symmetric";

/** Tipo de un nodo deducido de la geometría: suave si sus manejadores están alineados en sentidos opuestos. */
export function nodeKind(data: PathData, node: NodeRef): NodeKind {
  const found = pathNodes(data).find((n) => n.subpath === node.subpath && n.index === node.index);
  if (!found || found.handles.length < 2) return "corner";
  const [a, b] = found.handles.map((h) => handleAt(data, h));
  if (!a || !b) return "corner";
  const p = found.point;
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return "corner";
  const cross = (ax * by - ay * bx) / (la * lb);
  const dot = (ax * bx + ay * by) / (la * lb);
  if (Math.abs(cross) > 1e-3 || dot > -0.999) return "corner";
  return Math.abs(la - lb) < Math.max(1e-6, la * 1e-3) ? "symmetric" : "smooth";
}

/**
 * Mueve un manejador a `to`. Si su nodo es suave, el manejador opuesto gira para seguir alineado
 * (conserva su longitud); si es simétrico, queda como su reflejo. `kind` es el tipo del nodo al
 * empezar el arrastre (el de ahora ya no lo dice: los manejadores se están moviendo).
 */
export function moveHandle(data: PathData, handle: HandleRef, to: Point, kind: NodeKind): PathData {
  const opposite = kind === "corner" ? null : oppositeHandle(data, handle);
  const node = handleNode(data, handle);
  const subpathOf = data[node.subpath];
  const nodePoint =
    subpathOf && (node.index === 0 ? subpathOf.start : subpathOf.segments[node.index - 1]?.to);
  let result = data.map((subpath, s) =>
    s !== handle.subpath
      ? subpath
      : withSegment(subpath, handle.segment, (segment) => setHandle(segment, handle.kind, to)),
  );
  const oppositeCurrent = opposite ? handleAt(data, opposite) : null;
  if (opposite && oppositeCurrent && nodePoint) {
    const dx = to.x - nodePoint.x;
    const dy = to.y - nodePoint.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-9) {
      const keep =
        kind === "symmetric"
          ? length
          : Math.hypot(oppositeCurrent.x - nodePoint.x, oppositeCurrent.y - nodePoint.y);
      const mirrored = {
        x: nodePoint.x - (dx / length) * keep,
        y: nodePoint.y - (dy / length) * keep,
      };
      result = result.map((subpath, s) =>
        s !== opposite.subpath
          ? subpath
          : withSegment(subpath, opposite.segment, (segment) =>
              setHandle(segment, opposite.kind, mirrored),
            ),
      );
    }
  }
  return result;
}

function setHandle(segment: Segment, kind: HandleKind, to: Point): Segment {
  if (segment.kind === "cubic" && kind !== "c") return { ...segment, [kind]: to };
  if (segment.kind === "quad" && kind === "c") return { ...segment, c: to };
  return segment;
}
