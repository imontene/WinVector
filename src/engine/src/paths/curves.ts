import { boundsOfPoints, type Point, type Rect } from "../geometry";
import type { ArcSegment, CubicSegment, PathData, Segment } from "./model";

/**
 * Geometría de curvas (issue #75): caja exacta, punto de un segmento, punto más cercano, partir un
 * segmento sin cambiar su forma y convertir arcos en cúbicas. Lo usan la herramienta de nodos y la
 * pluma con curvas.
 *
 * Los segmentos del modelo no guardan su punto inicial: las funciones lo reciben como `from` (el
 * final del segmento anterior o el inicio del subtrazado).
 */

const EPSILON = 1e-9;

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

// ---------------------------------------------------------------------------------------------
// Arcos: de la forma de SVG (extremos, radios y banderas) a la de centro y ángulos.
// ---------------------------------------------------------------------------------------------

/** Un arco con su centro: ángulo inicial y barrido en radianes, radios ya corregidos. */
export interface ArcCenter {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** Giro de la elipse en radianes. */
  readonly phi: number;
  readonly theta: number;
  /** Barrido con signo: positivo en el sentido de las agujas del reloj (y hacia abajo). */
  readonly delta: number;
}

/**
 * Centro y ángulos de un arco (SVG 2, apéndice de implementación de arcos). Los radios demasiado
 * pequeños para unir los dos extremos se agrandan como hace el navegador. `null` si el arco se
 * dibuja como una recta (algún radio 0) o no se dibuja (extremos iguales).
 */
export function arcCenter(from: Point, arc: ArcSegment): ArcCenter | null {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  const to = arc.to;
  if (rx < EPSILON || ry < EPSILON) return null;
  if (Math.abs(from.x - to.x) < EPSILON && Math.abs(from.y - to.y) < EPSILON) return null;
  const phi = (arc.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (arc.large === arc.sweep) factor = -factor;
  const cxp = (factor * rx * y1) / ry;
  const cyp = (-factor * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2;
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!arc.sweep && delta > 0) delta -= 2 * Math.PI;
  else if (arc.sweep && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta, delta };
}

/** Punto de la elipse de un arco en el ángulo `angle`. */
function ellipsePoint(c: ArcCenter, angle: number): Point {
  const cos = Math.cos(c.phi);
  const sin = Math.sin(c.phi);
  const x = c.rx * Math.cos(angle);
  const y = c.ry * Math.sin(angle);
  return { x: c.cx + cos * x - sin * y, y: c.cy + sin * x + cos * y };
}

/**
 * Cúbicas que aproximan un arco: una por cada cuarto de vuelta como mucho, con el error radial
 * máximo de esa aproximación (menos de un 0,03 % del radio). Un arco que se dibuja como recta da
 * una recta.
 */
export function arcToCubics(from: Point, arc: ArcSegment): Segment[] {
  const c = arcCenter(from, arc);
  if (!c) return [{ kind: "line", to: arc.to }];
  const pieces = Math.max(1, Math.ceil(Math.abs(c.delta) / (Math.PI / 2) - 1e-9));
  const step = c.delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const cos = Math.cos(c.phi);
  const sin = Math.sin(c.phi);
  // Derivada de la elipse en un ángulo, ya girada.
  const tangent = (angle: number): Point => {
    const x = -c.rx * Math.sin(angle);
    const y = c.ry * Math.cos(angle);
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };
  const result: Segment[] = [];
  let start = from;
  for (let i = 0; i < pieces; i++) {
    const a1 = c.theta + i * step;
    const a2 = a1 + step;
    const end = i === pieces - 1 ? arc.to : ellipsePoint(c, a2);
    const t1 = tangent(a1);
    const t2 = tangent(a2);
    result.push({
      kind: "cubic",
      c1: { x: start.x + k * t1.x, y: start.y + k * t1.y },
      c2: { x: end.x - k * t2.x, y: end.y - k * t2.y },
      to: end,
    });
    start = end;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Punto de un segmento y partir un segmento.
// ---------------------------------------------------------------------------------------------

/** Punto del segmento en el parámetro `t` (0: inicio, 1: final). En un arco, `t` recorre el ángulo. */
export function pointAt(from: Point, segment: Segment, t: number): Point {
  switch (segment.kind) {
    case "line":
      return lerp(from, segment.to, t);
    case "quad": {
      const a = lerp(from, segment.c, t);
      const b = lerp(segment.c, segment.to, t);
      return lerp(a, b, t);
    }
    case "cubic": {
      const [first] = splitCubic(from, segment, t);
      return first.to;
    }
    case "arc": {
      const c = arcCenter(from, segment);
      return c ? ellipsePoint(c, c.theta + c.delta * t) : lerp(from, segment.to, t);
    }
  }
}

function splitCubic(from: Point, s: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const p01 = lerp(from, s.c1, t);
  const p12 = lerp(s.c1, s.c2, t);
  const p23 = lerp(s.c2, s.to, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    { kind: "cubic", c1: p01, c2: p012, to: mid },
    { kind: "cubic", c1: p123, c2: p23, to: s.to },
  ];
}

/**
 * Parte un segmento en `t` en dos que dibujan exactamente lo mismo (de Casteljau para las curvas;
 * los arcos, por su ángulo, con los radios ya corregidos para que cada mitad sea válida).
 */
export function splitSegment(from: Point, segment: Segment, t: number): [Segment, Segment] {
  const at = Math.min(1, Math.max(0, t));
  switch (segment.kind) {
    case "line": {
      const mid = lerp(from, segment.to, at);
      return [
        { kind: "line", to: mid },
        { kind: "line", to: segment.to },
      ];
    }
    case "quad": {
      const a = lerp(from, segment.c, at);
      const b = lerp(segment.c, segment.to, at);
      const mid = lerp(a, b, at);
      return [
        { kind: "quad", c: a, to: mid },
        { kind: "quad", c: b, to: segment.to },
      ];
    }
    case "cubic":
      return splitCubic(from, segment, at);
    case "arc": {
      const c = arcCenter(from, segment);
      if (!c) {
        const mid = lerp(from, segment.to, at);
        return [
          { ...segment, to: mid },
          { ...segment, to: segment.to },
        ];
      }
      const mid = ellipsePoint(c, c.theta + c.delta * at);
      const piece = (sweep: number, to: Point): Segment => ({
        kind: "arc",
        rx: c.rx,
        ry: c.ry,
        rotation: segment.rotation,
        large: Math.abs(sweep) > Math.PI,
        sweep: segment.sweep,
        to,
      });
      return [piece(c.delta * at, mid), piece(c.delta * (1 - at), segment.to)];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Caja exacta.
// ---------------------------------------------------------------------------------------------

/** Raíces en (0, 1) de a·t² + b·t + c. */
function rootsInUnit(a: number, b: number, c: number): number[] {
  const roots: number[] = [];
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** Puntos donde el segmento llega a sus extremos en x o en y (además de sus dos puntas). */
function extremes(from: Point, segment: Segment): Point[] {
  const points: Point[] = [from, segment.to];
  switch (segment.kind) {
    case "line":
      break;
    case "quad":
      for (const axis of ["x", "y"] as const) {
        const denominator = from[axis] - 2 * segment.c[axis] + segment.to[axis];
        if (Math.abs(denominator) > EPSILON) {
          const t = (from[axis] - segment.c[axis]) / denominator;
          if (t > 0 && t < 1) points.push(pointAt(from, segment, t));
        }
      }
      break;
    case "cubic":
      for (const axis of ["x", "y"] as const) {
        // Derivada de la cúbica: 3(a t² + b t + c).
        const p0 = from[axis];
        const p1 = segment.c1[axis];
        const p2 = segment.c2[axis];
        const p3 = segment.to[axis];
        const a = -p0 + 3 * p1 - 3 * p2 + p3;
        const b = 2 * (p0 - 2 * p1 + p2);
        const c = p1 - p0;
        for (const t of rootsInUnit(a, b, c)) points.push(pointAt(from, segment, t));
      }
      break;
    case "arc": {
      const c = arcCenter(from, segment);
      if (!c) break;
      const cos = Math.cos(c.phi);
      const sin = Math.sin(c.phi);
      // Ángulos donde la elipse girada es tangente a una vertical o a una horizontal.
      const candidates = [Math.atan2(-c.ry * sin, c.rx * cos), Math.atan2(c.ry * cos, c.rx * sin)];
      const lo = Math.min(c.theta, c.theta + c.delta);
      const hi = Math.max(c.theta, c.theta + c.delta);
      for (const base of candidates) {
        for (let k = -4; k <= 4; k++) {
          const angle = base + k * Math.PI;
          if (angle > lo && angle < hi) points.push(ellipsePoint(c, angle));
        }
      }
      break;
    }
  }
  return points;
}

/** Caja exacta de un segmento (la de la curva, no la de sus puntos de control). */
export function segmentBounds(from: Point, segment: Segment): Rect {
  return boundsOfPoints(extremes(from, segment)) ?? { x: from.x, y: from.y, width: 0, height: 0 };
}

/** Caja exacta de un trazado, o `null` si no tiene ningún punto. */
export function pathBounds(data: PathData): Rect | null {
  const points: Point[] = [];
  for (const subpath of data) {
    points.push(subpath.start);
    let from = subpath.start;
    for (const segment of subpath.segments) {
      points.push(...extremes(from, segment));
      from = segment.to;
    }
  }
  return boundsOfPoints(points);
}

// ---------------------------------------------------------------------------------------------
// Punto más cercano.
// ---------------------------------------------------------------------------------------------

export interface NearestPoint {
  readonly t: number;
  readonly point: Point;
  readonly distance: number;
}

/**
 * Punto del segmento más cercano a `p`. Las rectas se resuelven exactas; las curvas, muestreando y
 * afinando alrededor de la mejor muestra hasta una precisión de 1e-9 en el parámetro.
 */
export function nearestOnSegment(from: Point, segment: Segment, p: Point): NearestPoint {
  const distanceAt = (t: number) => {
    const q = pointAt(from, segment, t);
    return Math.hypot(q.x - p.x, q.y - p.y);
  };
  if (segment.kind === "line" || (segment.kind === "arc" && !arcCenter(from, segment))) {
    const dx = segment.to.x - from.x;
    const dy = segment.to.y - from.y;
    const length = dx * dx + dy * dy;
    const t =
      length < EPSILON
        ? 0
        : Math.min(1, Math.max(0, ((p.x - from.x) * dx + (p.y - from.y) * dy) / length));
    const point = lerp(from, segment.to, t);
    return { t, point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
  }
  const samples = 64;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= samples; i++) {
    const d = distanceAt(i / samples);
    if (d < bestDistance) {
      bestDistance = d;
      best = i / samples;
    }
  }
  // Búsqueda de la sección áurea en el intervalo de la mejor muestra.
  let lo = Math.max(0, best - 1 / samples);
  let hi = Math.min(1, best + 1 / samples);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = hi - ratio * (hi - lo);
  let b = lo + ratio * (hi - lo);
  let da = distanceAt(a);
  let db = distanceAt(b);
  while (hi - lo > 1e-9) {
    if (da < db) {
      hi = b;
      b = a;
      db = da;
      a = hi - ratio * (hi - lo);
      da = distanceAt(a);
    } else {
      lo = a;
      a = b;
      da = db;
      b = lo + ratio * (hi - lo);
      db = distanceAt(b);
    }
  }
  const t = (lo + hi) / 2;
  const point = pointAt(from, segment, t);
  return { t, point, distance: Math.hypot(point.x - p.x, point.y - p.y) };
}

/** Lugar del trazado más cercano a un punto: qué segmento, en qué parámetro y a qué distancia. */
export interface PathLocation extends NearestPoint {
  readonly subpath: number;
  /**
   * Índice del segmento en su subtrazado. En un subtrazado cerrado, `segments.length` es la recta de
   * cierre (de vuelta al inicio), que no está en la lista.
   */
  readonly segment: number;
}

/** Punto del trazado más cercano a `p`, incluidas las rectas de cierre; `null` si no tiene segmentos. */
export function nearestOnPath(data: PathData, p: Point): PathLocation | null {
  let best: PathLocation | null = null;
  data.forEach((subpath, s) => {
    let from = subpath.start;
    const visit = (segment: Segment, index: number) => {
      const found = nearestOnSegment(from, segment, p);
      if (!best || found.distance < best.distance) best = { ...found, subpath: s, segment: index };
      from = segment.to;
    };
    subpath.segments.forEach(visit);
    const back = from;
    if (
      subpath.closed &&
      (Math.abs(back.x - subpath.start.x) > EPSILON || Math.abs(back.y - subpath.start.y) > EPSILON)
    ) {
      visit({ kind: "line", to: subpath.start }, subpath.segments.length);
    }
  });
  return best;
}

/**
 * Parte el segmento indicado de un trazado (añade un nodo) sin cambiar lo que se ve. Partir la recta
 * de cierre de un subtrazado cerrado añade un segmento recto al final.
 */
export function splitPathAt(
  data: PathData,
  location: { subpath: number; segment: number; t: number },
): PathData {
  return data.map((subpath, s) => {
    if (s !== location.subpath) return subpath;
    let from = subpath.start;
    for (let i = 0; i < location.segment && i < subpath.segments.length; i++)
      from = subpath.segments[i]?.to ?? from;
    if (location.segment >= subpath.segments.length) {
      if (!subpath.closed) return subpath;
      const mid = lerp(from, subpath.start, location.t);
      return { ...subpath, segments: [...subpath.segments, { kind: "line", to: mid }] };
    }
    const target = subpath.segments[location.segment];
    if (!target) return subpath;
    const [a, b] = splitSegment(from, target, location.t);
    const segments = [...subpath.segments];
    segments.splice(location.segment, 1, a, b);
    return { ...subpath, segments };
  });
}
