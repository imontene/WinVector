import { applyToPoint, determinant, type Matrix, type Point } from "../geometry";
import { arcToCubics } from "./curves";
import type { PathData, Segment, Subpath } from "./model";

/**
 * Operaciones sobre la geometría de un trazado (issue #79): invertir su dirección, abrir y cerrar
 * subtrazados y transformarlo. Combinar y separar trazados están en `combine.ts`.
 */

const EPSILON = 1e-9;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

/** El mismo segmento recorrido al revés: termina en `from`, donde empezaba. */
function reverseSegment(from: Point, segment: Segment): Segment {
  switch (segment.kind) {
    case "line":
      return { kind: "line", to: from };
    case "cubic":
      return { kind: "cubic", c1: segment.c2, c2: segment.c1, to: from };
    case "quad":
      return { kind: "quad", c: segment.c, to: from };
    case "arc":
      return { ...segment, sweep: !segment.sweep, to: from };
  }
}

/** Segmentos de un subtrazado cerrado con la vuelta al inicio escrita (si no lo estaba ya). */
function explicitClosing(subpath: Subpath): Segment[] {
  const segments = [...subpath.segments];
  const last = segments.at(-1);
  if (subpath.closed && !(last && same(last.to, subpath.start))) {
    segments.push({ kind: "line", to: subpath.start });
  }
  return segments;
}

/** Quita la recta final que vuelve al inicio de un subtrazado cerrado: la dibuja la `Z`. */
function implicitClosing(start: Point, segments: Segment[]): Segment[] {
  const last = segments.at(-1);
  if (segments.length > 1 && last?.kind === "line" && same(last.to, start)) segments.pop();
  return segments;
}

/** Un subtrazado recorrido al revés. Uno cerrado sigue empezando en el mismo punto. */
export function reverseSubpath(subpath: Subpath): Subpath {
  const segments = explicitClosing(subpath);
  const starts = [subpath.start, ...segments.map((segment) => segment.to)];
  const reversed: Segment[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    const from = starts[i];
    if (segment && from) reversed.push(reverseSegment(from, segment));
  }
  const start = starts.at(-1) ?? subpath.start;
  return {
    start,
    segments: subpath.closed ? implicitClosing(start, reversed) : reversed,
    closed: subpath.closed,
  };
}

/** Todos los subtrazados recorridos al revés, en el mismo orden. */
export const reversePath = (data: PathData): PathData => data.map(reverseSubpath);

/** Cierra los subtrazados abiertos. Devuelve el mismo trazado si no había ninguno. */
export function closePath(data: PathData): PathData {
  if (data.every((subpath) => subpath.closed || subpath.segments.length === 0)) return data;
  return data.map((subpath) =>
    subpath.segments.length === 0 ? subpath : { ...subpath, closed: true },
  );
}

/**
 * Abre un subtrazado cerrado por uno de sus nodos (numerados como en `pathNodes`): empieza y termina
 * en ese nodo, sin la `Z`. Se ve igual, pero sus extremos se pueden separar.
 */
export function openSubpath(subpath: Subpath, node = 0): Subpath {
  if (!subpath.closed) return subpath;
  const segments = explicitClosing(subpath);
  const count = segments.length;
  const k = ((node % count) + count) % count;
  const start = k === 0 ? subpath.start : (segments[k - 1]?.to ?? subpath.start);
  return { start, segments: [...segments.slice(k), ...segments.slice(0, k)], closed: false };
}

/**
 * Abre los subtrazados cerrados por su primer nodo, o solo el de `at` por ese nodo. Devuelve el
 * mismo trazado si no había nada que abrir.
 */
export function openPath(data: PathData, at?: { subpath: number; index: number }): PathData {
  if (at) {
    const target = data[at.subpath];
    if (!target?.closed) return data;
    return data.map((subpath, s) => (s === at.subpath ? openSubpath(subpath, at.index) : subpath));
  }
  if (!data.some((subpath) => subpath.closed)) return data;
  return data.map((subpath) => openSubpath(subpath));
}

const IDENTITY_EPSILON = 1e-12;

const isIdentity = (m: Matrix) =>
  Math.abs(m.a - 1) < IDENTITY_EPSILON &&
  Math.abs(m.b) < IDENTITY_EPSILON &&
  Math.abs(m.c) < IDENTITY_EPSILON &&
  Math.abs(m.d - 1) < IDENTITY_EPSILON &&
  Math.abs(m.e) < IDENTITY_EPSILON &&
  Math.abs(m.f) < IDENTITY_EPSILON;

/**
 * Escala uniforme, giro, traslación y quizá simetría: lleva elipses a elipses con los mismos ejes
 * girados, así que un arco sigue siendo un arco.
 */
function similarity(m: Matrix): { scale: number; angle: number; flip: boolean } | null {
  const flip = determinant(m) < 0;
  const rotationLike = Math.abs(m.a - m.d) < 1e-9 && Math.abs(m.b + m.c) < 1e-9;
  const reflectionLike = Math.abs(m.a + m.d) < 1e-9 && Math.abs(m.b - m.c) < 1e-9;
  if (!(flip ? reflectionLike : rotationLike)) return null;
  return { scale: Math.hypot(m.a, m.b), angle: (Math.atan2(m.b, m.a) * 180) / Math.PI, flip };
}

/**
 * El trazado transformado por `m`. Los arcos siguen siendo arcos con escalas uniformes, giros y
 * simetrías; con otras transformaciones (escala distinta en cada eje, sesgo) pasan a ser curvas.
 */
export function transformPath(data: PathData, m: Matrix): PathData {
  if (isIdentity(m)) return data;
  const p = (point: Point) => applyToPoint(m, point);
  const similar = similarity(m);
  return data.map((subpath) => {
    let from = subpath.start;
    const segments = subpath.segments.flatMap((segment): Segment[] => {
      const start = from;
      from = segment.to;
      switch (segment.kind) {
        case "line":
          return [{ kind: "line", to: p(segment.to) }];
        case "cubic":
          return [{ kind: "cubic", c1: p(segment.c1), c2: p(segment.c2), to: p(segment.to) }];
        case "quad":
          return [{ kind: "quad", c: p(segment.c), to: p(segment.to) }];
        case "arc":
          if (similar) {
            const rotation = similar.flip
              ? similar.angle - segment.rotation
              : similar.angle + segment.rotation;
            return [
              {
                ...segment,
                rx: segment.rx * similar.scale,
                ry: segment.ry * similar.scale,
                rotation: ((rotation % 360) + 360) % 360,
                sweep: similar.flip ? !segment.sweep : segment.sweep,
                to: p(segment.to),
              },
            ];
          }
          return arcToCubics(start, segment).map((piece) =>
            piece.kind === "cubic"
              ? { kind: "cubic", c1: p(piece.c1), c2: p(piece.c2), to: p(piece.to) }
              : { kind: "line", to: p(piece.to) },
          );
      }
    });
    return { start: p(subpath.start), segments, closed: subpath.closed };
  });
}
