import type { Point } from "../geometry";
import { arcToCubics, type PathData, type Segment, type Subpath } from "../paths";

/**
 * Nodos de la pluma con curvas (issue #78): cada nodo tiene su punto y, si los tiene, el manejador
 * que llega (`in`) y el que sale (`out`), en coordenadas absolutas. Un segmento es una curva cúbica
 * si alguno de sus dos extremos tiene manejador hacia él; si no, es una recta.
 */
export interface Anchor {
  p: Point;
  in: Point | null;
  out: Point | null;
}

const EPSILON = 1e-9;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

/** Manejador que de verdad se separa del nodo, o `null`. */
const handle = (h: Point | null, p: Point) => (h && !same(h, p) ? h : null);

/** Segmento de `a` a `b`: cúbico si alguno tiene manejador hacia el otro, recto si no. */
function segmentBetween(a: Anchor, b: Anchor): Segment {
  const c1 = handle(a.out, a.p);
  const c2 = handle(b.in, b.p);
  if (!c1 && !c2) return { kind: "line", to: b.p };
  return { kind: "cubic", c1: c1 ?? a.p, c2: c2 ?? b.p, to: b.p };
}

/** True si algún segmento (también el de cierre, si `closed`) es curvo. */
export function hasCurves(anchors: readonly Anchor[], closed: boolean): boolean {
  return anchors.some((anchor, i) => {
    const previous = i > 0 || closed;
    const next = i < anchors.length - 1 || closed;
    const incoming = previous && handle(anchor.in, anchor.p) !== null;
    const outgoing = next && handle(anchor.out, anchor.p) !== null;
    return incoming || outgoing;
  });
}

/** Subtrazado que dibujan los nodos. Un cierre recto lo hace la `Z`; uno curvo, una cúbica. */
export function anchorsToSubpath(anchors: readonly Anchor[], closed: boolean): Subpath {
  const [first] = anchors;
  if (!first) return { start: { x: 0, y: 0 }, segments: [], closed };
  const segments: Segment[] = [];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (a && b) segments.push(segmentBetween(a, b));
  }
  const last = anchors.at(-1);
  if (closed && last && anchors.length > 1) {
    const back = segmentBetween(last, first);
    if (back.kind !== "line") segments.push(back);
  }
  return { start: first.p, segments, closed };
}

/**
 * Nodos de un subtrazado abierto, para seguir dibujándolo. Las cuadráticas y los arcos pasan a ser
 * cúbicas (los arcos, con sus nodos intermedios: ADR 0007).
 */
export function subpathToAnchors(subpath: Subpath): Anchor[] {
  const anchors: Anchor[] = [{ p: subpath.start, in: null, out: null }];
  const add = (segment: Segment) => {
    const previous = anchors.at(-1);
    if (!previous) return;
    switch (segment.kind) {
      case "line":
        anchors.push({ p: segment.to, in: null, out: null });
        return;
      case "cubic":
        previous.out = handle(segment.c1, previous.p);
        anchors.push({ p: segment.to, in: handle(segment.c2, segment.to), out: null });
        return;
      case "quad": {
        const c1 = {
          x: previous.p.x + ((segment.c.x - previous.p.x) * 2) / 3,
          y: previous.p.y + ((segment.c.y - previous.p.y) * 2) / 3,
        };
        const c2 = {
          x: segment.to.x + ((segment.c.x - segment.to.x) * 2) / 3,
          y: segment.to.y + ((segment.c.y - segment.to.y) * 2) / 3,
        };
        add({ kind: "cubic", c1, c2, to: segment.to });
        return;
      }
      case "arc":
        arcToCubics(previous.p, segment).forEach(add);
        return;
    }
  };
  subpath.segments.forEach(add);
  return anchors;
}

/** Los mismos nodos recorridos al revés: cada manejador que llegaba pasa a salir. */
export function reverseAnchors(anchors: readonly Anchor[]): Anchor[] {
  return [...anchors].reverse().map((anchor) => ({ p: anchor.p, in: anchor.out, out: anchor.in }));
}

/** Subtrazado abierto con un solo tramo de rectas a partir de los puntos de una polilínea. */
export function polylineSubpath(points: readonly Point[]): PathData {
  const [start, ...rest] = points;
  if (!start) return [];
  return [{ start, segments: rest.map((to) => ({ kind: "line", to })), closed: false }];
}
