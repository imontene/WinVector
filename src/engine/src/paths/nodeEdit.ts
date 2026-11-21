import type { Point } from "../geometry";
import { arcToCubics, pointAt, splitPathAt } from "./curves";
import type { CubicSegment, PathData, Segment, Subpath } from "./model";
import { nodeKey, nodeKind, pathNodes, type NodeKind } from "./nodes";

/**
 * Editar los nodos de un trazado (issue #77): cambiar su tipo, añadir y quitar nodos, y hacer un
 * segmento recto o curvo.
 *
 * Las operaciones reciben los nodos seleccionados por su `nodeKey` y devuelven el trazado nuevo con
 * las claves que tienen ahora esos mismos nodos: convertir un arco en curvas añade nodos y cambia la
 * numeración de los que van después.
 */

export interface NodeEditResult {
  readonly data: PathData;
  /** Claves de los nodos que estaban seleccionados, con su numeración nueva. */
  readonly selected: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Cadenas: un subtrazado como nodos y segmentos entre ellos.
// ---------------------------------------------------------------------------------------------

/**
 * Subtrazado como lista de nodos. En uno abierto, el segmento `i` va del nodo `i` al `i + 1`; en uno
 * cerrado hay un segmento más, explícito, que vuelve del último nodo al primero. La numeración de
 * los nodos es la de `pathNodes`.
 */
interface Chain {
  nodes: Point[];
  segments: Segment[];
  readonly closed: boolean;
  /** Etiqueta de cada nodo (su clave original si estaba seleccionado), para numerarlos después. */
  tags: (string | null)[];
}

const EPSILON = 1e-9;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function toChain(subpath: Subpath, s: number, keys: ReadonlySet<string>): Chain {
  const segments = [...subpath.segments];
  const last = segments.at(-1);
  // Un subtrazado cerrado vuelve al inicio con una recta implícita: aquí se escribe.
  if (subpath.closed && !(last && same(last.to, subpath.start))) {
    segments.push({ kind: "line", to: subpath.start });
  }
  const nodes = [subpath.start, ...segments.map((segment) => segment.to)];
  if (subpath.closed) nodes.pop();
  const tags = nodes.map((_, i) => {
    const key = nodeKey({ subpath: s, index: i });
    return keys.has(key) ? key : null;
  });
  return { nodes, segments, closed: subpath.closed, tags };
}

function fromChain(chain: Chain): Subpath {
  const start = chain.nodes[0] ?? { x: 0, y: 0 };
  const segments = [...chain.segments];
  // La recta que vuelve al inicio la dibuja la `Z`.
  const last = segments.at(-1);
  if (chain.closed && segments.length > 1 && last?.kind === "line" && same(last.to, start)) {
    segments.pop();
  }
  return { start, segments, closed: chain.closed };
}

/** Nodo de inicio de un segmento de la cadena. */
const segmentStart = (chain: Chain, index: number): Point =>
  chain.nodes[index] ?? chain.nodes[0] ?? { x: 0, y: 0 };

/** Índices de los segmentos que llegan al nodo `i` y salen de él (`-1` si no hay). */
function sides(chain: Chain, i: number): [number, number] {
  const n = chain.segments.length;
  if (chain.closed) return [(i - 1 + n) % n, i];
  return [i > 0 ? i - 1 : -1, i < n ? i : -1];
}

/** Sustituye el segmento `index` por varios y añade sus nodos intermedios (sin etiqueta). */
function replaceSegment(chain: Chain, index: number, pieces: readonly Segment[]): void {
  chain.segments.splice(index, 1, ...pieces);
  const inner = pieces.slice(0, -1).map((piece) => piece.to);
  chain.nodes.splice(index + 1, 0, ...inner);
  chain.tags.splice(index + 1, 0, ...inner.map(() => null));
}

/** Cúbica que dibuja lo mismo que una recta o una cuadrática. */
function toCubic(from: Point, segment: Segment): CubicSegment | null {
  switch (segment.kind) {
    case "cubic":
      return segment;
    case "line":
      return {
        kind: "cubic",
        c1: lerp(from, segment.to, 1 / 3),
        c2: lerp(from, segment.to, 2 / 3),
        to: segment.to,
      };
    case "quad":
      return {
        kind: "cubic",
        c1: lerp(from, segment.c, 2 / 3),
        c2: lerp(segment.to, segment.c, 2 / 3),
        to: segment.to,
      };
    case "arc":
      return null;
  }
}

/**
 * Convierte el segmento `index` en cúbicas sin cambiar lo que se ve (un arco puede dar varias). Si
 * el segmento se parte, `index` sigue siendo el primer trozo; devuelve el índice del último.
 */
function curveSegment(chain: Chain, index: number): number {
  const segment = chain.segments[index];
  if (!segment) return index;
  const from = segmentStart(chain, index);
  if (segment.kind === "arc") {
    const pieces = arcToCubics(from, segment).map((piece) => toCubic(from, piece) ?? piece);
    replaceSegment(chain, index, pieces);
    return index + pieces.length - 1;
  }
  const cubic = toCubic(from, segment);
  if (cubic) chain.segments[index] = cubic;
  return index;
}

function edit(
  data: PathData,
  keys: ReadonlySet<string>,
  change: (chain: Chain) => Chain | null,
): NodeEditResult {
  const selected: string[] = [];
  const result: Subpath[] = [];
  data.forEach((subpath, s) => {
    const original = toChain(subpath, s, keys);
    // Un subtrazado sin nodos seleccionados no se toca (ni se reescribe).
    if (original.tags.every((tag) => tag === null)) {
      result.push(subpath);
      return;
    }
    const chain = change(original);
    if (!chain) return;
    const index = result.length;
    chain.tags.forEach((tag, i) => {
      if (tag !== null) selected.push(nodeKey({ subpath: index, index: i }));
    });
    result.push(fromChain(chain));
  });
  return { data: result, selected };
}

// ---------------------------------------------------------------------------------------------
// Tipo de nodo.
// ---------------------------------------------------------------------------------------------

const length = (p: Point) => Math.hypot(p.x, p.y);
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (p: Point): Point => {
  const l = length(p);
  return l < EPSILON ? { x: 0, y: 0 } : { x: p.x / l, y: p.y / l };
};

/**
 * Cambia el tipo de los nodos:
 * - **Esquina:** recoge sus manejadores sobre el nodo. Las dos curvas quedan independientes.
 * - **Suave:** alinea los dos manejadores, cada uno con su longitud. Las rectas, cuadráticas y arcos
 *   que llegan al nodo pasan a ser cúbicas (los arcos, con sus nodos intermedios).
 * - **Simétrico:** además, los dos manejadores miden lo mismo (la media).
 *
 * Los extremos de un subtrazado abierto solo tienen un lado: no se pueden hacer suaves.
 */
export function setNodeKind(
  data: PathData,
  keys: ReadonlySet<string>,
  kind: NodeKind,
): NodeEditResult {
  return edit(data, keys, (chain) => {
    // De atrás adelante: los nodos que se añaden al convertir un arco no mueven los que faltan.
    for (let i = chain.nodes.length - 1; i >= 0; i--) {
      if (chain.tags[i] === null) continue;
      if (kind === "corner") retract(chain, i);
      else alignHandles(chain, i, kind === "symmetric");
    }
    return chain;
  });
}

function retract(chain: Chain, i: number): void {
  const node = chain.nodes[i];
  if (!node) return;
  const [incoming, outgoing] = sides(chain, i);
  const before = chain.segments[incoming];
  if (before && before.kind !== "line" && before.kind !== "arc") {
    const cubic = toCubic(segmentStart(chain, incoming), before);
    if (cubic) chain.segments[incoming] = { ...cubic, c2: node };
  }
  const after = chain.segments[outgoing];
  if (after && after.kind !== "line" && after.kind !== "arc") {
    const cubic = toCubic(node, after);
    if (cubic) chain.segments[outgoing] = { ...cubic, c1: node };
  }
}

function alignHandles(chain: Chain, i: number, symmetric: boolean): void {
  const tag = chain.tags[i] ?? null;
  // Convertir un arco en curvas añade nodos: después, el nodo se busca por su etiqueta.
  const at = () => {
    const index = tag === null ? -1 : chain.tags.indexOf(tag);
    return { index, sides: sides(chain, index) };
  };
  let [incoming, outgoing] = sides(chain, i);
  if (incoming === -1 || outgoing === -1 || incoming === outgoing) return;
  curveSegment(chain, outgoing);
  curveSegment(chain, at().sides[0]);
  const found = at();
  [incoming, outgoing] = found.sides;
  const node = chain.nodes[found.index];
  const before = chain.segments[incoming];
  const after = chain.segments[outgoing];
  if (!node || before?.kind !== "cubic" || after?.kind !== "cubic") return;

  // Un manejador recogido sobre el nodo apunta hacia el nodo vecino, a un tercio de distancia.
  const previous = segmentStart(chain, incoming);
  let a = minus(before.c2, node);
  if (length(a) < 1e-6) a = { x: (previous.x - node.x) / 3, y: (previous.y - node.y) / 3 };
  let b = minus(after.c1, node);
  if (length(b) < 1e-6) b = { x: (after.to.x - node.x) / 3, y: (after.to.y - node.y) / 3 };
  const la = length(a);
  const lb = length(b);
  if (la < EPSILON || lb < EPSILON) return;

  // La dirección es la bisectriz: el menor giro posible de los dos manejadores.
  let direction = unit(minus(unit(b), unit(a)));
  if (length(direction) < EPSILON) direction = unit({ x: -a.y, y: a.x });
  const inLength = symmetric ? (la + lb) / 2 : la;
  const outLength = symmetric ? (la + lb) / 2 : lb;
  chain.segments[incoming] = {
    ...before,
    c2: { x: node.x - direction.x * inLength, y: node.y - direction.y * inLength },
  };
  chain.segments[outgoing] = {
    ...after,
    c1: { x: node.x + direction.x * outLength, y: node.y + direction.y * outLength },
  };
}

// ---------------------------------------------------------------------------------------------
// Segmentos rectos y curvos.
// ---------------------------------------------------------------------------------------------

/** Segmentos de la cadena con sus dos nodos seleccionados. */
function selectedSegments(chain: Chain): number[] {
  const n = chain.nodes.length;
  return chain.segments
    .map((_, j) => j)
    .filter(
      (j) => chain.tags[j] !== null && chain.tags[chain.closed ? (j + 1) % n : j + 1] !== null,
    );
}

/**
 * Hace rectos o curvos los segmentos que tienen sus dos nodos seleccionados. Un segmento recto que
 * pasa a curvo se ve igual: es una cúbica con los manejadores sobre la recta, listos para tirar.
 */
export function setSegmentKind(
  data: PathData,
  keys: ReadonlySet<string>,
  kind: "line" | "curve",
): NodeEditResult {
  return edit(data, keys, (chain) => {
    for (const j of selectedSegments(chain).reverse()) {
      const segment = chain.segments[j];
      if (!segment) continue;
      if (kind === "line") chain.segments[j] = { kind: "line", to: segment.to };
      else curveSegment(chain, j);
    }
    return chain;
  });
}

// ---------------------------------------------------------------------------------------------
// Añadir y quitar nodos.
// ---------------------------------------------------------------------------------------------

/** Añade un nodo en un punto de un segmento sin cambiar lo que se ve. Devuelve la clave del nodo. */
export function insertNode(
  data: PathData,
  location: { subpath: number; segment: number; t: number },
): NodeEditResult {
  return {
    data: splitPathAt(data, location),
    selected: [nodeKey({ subpath: location.subpath, index: location.segment + 1 })],
  };
}

/**
 * Quita los nodos indicados intentando conservar la forma: los segmentos que unían cada tramo de
 * nodos quitados se sustituyen por una sola cúbica ajustada a ellos, con las mismas tangentes en sus
 * extremos (así los nodos que quedan no pierden su suavidad). Entre rectas queda una recta.
 *
 * Un subtrazado que se queda con menos de dos nodos desaparece. Si no queda ninguno, devuelve
 * `null`: quitar todos los nodos no es lo mismo que borrar el trazado.
 */
export function removeNodes(data: PathData, keys: ReadonlySet<string>): PathData | null {
  const { data: result } = edit(data, keys, (chain) => {
    const kept = chain.nodes.map((_, i) => i).filter((i) => chain.tags[i] === null);
    if (kept.length === chain.nodes.length) return chain;
    if (kept.length < 2) return null;
    const pairs: [number, number][] = [];
    for (let k = 0; k + 1 < kept.length; k++) pairs.push([kept[k] ?? 0, kept[k + 1] ?? 0]);
    if (chain.closed) pairs.push([kept.at(-1) ?? 0, kept[0] ?? 0]);
    const segments = pairs.map(([from, to]) => {
      const run: Segment[] = [];
      const n = chain.segments.length;
      for (let j = from; j !== to; j = (j + 1) % (chain.closed ? n : n + 1)) {
        const segment = chain.segments[j];
        if (segment) run.push(segment);
      }
      return run.length === 1 && run[0] ? run[0] : fitRun(chain.nodes[from] ?? { x: 0, y: 0 }, run);
    });
    return {
      nodes: kept.map((i) => chain.nodes[i] ?? { x: 0, y: 0 }),
      segments,
      closed: chain.closed,
      tags: kept.map(() => null),
    };
  });
  return result.length > 0 ? result : null;
}

/** Tangente (sin normalizar) al principio o al final de un segmento. */
function tangent(from: Point, segment: Segment, atEnd: boolean): Point {
  const cubic = segment.kind === "arc" ? arcToCubics(from, segment) : [segment];
  const piece = atEnd ? cubic.at(-1) : cubic[0];
  const start = atEnd && cubic.length > 1 ? (cubic.at(-2)?.to ?? from) : from;
  if (!piece) return minus(segment.to, from);
  const asCubic = toCubic(start, piece);
  if (!asCubic) return minus(piece.to, start);
  const candidates = atEnd
    ? [minus(asCubic.to, asCubic.c2), minus(asCubic.to, asCubic.c1), minus(asCubic.to, start)]
    : [minus(asCubic.c1, start), minus(asCubic.c2, start), minus(asCubic.to, start)];
  return candidates.find((c) => length(c) > 1e-9) ?? { x: 0, y: 0 };
}

const SAMPLES_PER_SEGMENT = 24;

/** Una cúbica (o una recta, si todo eran rectas) que se ajusta a una serie de segmentos seguidos. */
function fitRun(from: Point, run: readonly Segment[]): Segment {
  const last = run.at(-1);
  if (!last) return { kind: "line", to: from };
  const end = last.to;
  if (run.every((segment) => segment.kind === "line")) return { kind: "line", to: end };

  // Puntos de los segmentos y su parámetro por longitud de cuerda.
  const points: Point[] = [from];
  let start = from;
  for (const segment of run) {
    for (let k = 1; k <= SAMPLES_PER_SEGMENT; k++) {
      points.push(pointAt(start, segment, k / SAMPLES_PER_SEGMENT));
    }
    start = segment.to;
  }
  const lengths = [0];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1] ?? from;
    const b = points[k] ?? from;
    lengths.push((lengths[k - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths.at(-1) ?? 0;
  if (total < EPSILON) return { kind: "line", to: end };
  let u = lengths.map((l) => l / total);

  const firstFrom = from;
  const lastFrom = run.length > 1 ? (run.at(-2)?.to ?? from) : from;
  const t1 = unit(tangent(firstFrom, run[0] ?? last, false));
  const t2 = unit(minus({ x: 0, y: 0 }, tangent(lastFrom, last, true)));

  let curve = solveAlphas(from, end, t1, t2, points, u);
  // Unas vueltas de Newton para que cada punto tenga el parámetro de su punto más cercano.
  for (let iteration = 0; iteration < 6; iteration++) {
    u = u.map((value, k) => reparameterize(from, curve, points[k] ?? from, value));
    curve = solveAlphas(from, end, t1, t2, points, u);
  }
  return curve;
}

/** Longitudes de los manejadores por mínimos cuadrados con las tangentes fijas (Schneider). */
function solveAlphas(
  p0: Point,
  p3: Point,
  t1: Point,
  t2: Point,
  points: readonly Point[],
  u: readonly number[],
): CubicSegment {
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  points.forEach((q, k) => {
    const t = u[k] ?? 0;
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * t * s * s;
    const b2 = 3 * t * t * s;
    const b3 = t * t * t;
    const a1 = { x: t1.x * b1, y: t1.y * b1 };
    const a2 = { x: t2.x * b2, y: t2.y * b2 };
    c00 += a1.x * a1.x + a1.y * a1.y;
    c01 += a1.x * a2.x + a1.y * a2.y;
    c11 += a2.x * a2.x + a2.y * a2.y;
    const rest = {
      x: q.x - (p0.x * (b0 + b1) + p3.x * (b2 + b3)),
      y: q.y - (p0.y * (b0 + b1) + p3.y * (b2 + b3)),
    };
    x0 += a1.x * rest.x + a1.y * rest.y;
    x1 += a2.x * rest.x + a2.y * rest.y;
  });
  const det = c00 * c11 - c01 * c01;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  if (alpha1 < chord * 1e-6 || alpha2 < chord * 1e-6) {
    alpha1 = chord / 3;
    alpha2 = chord / 3;
  }
  return {
    kind: "cubic",
    c1: { x: p0.x + t1.x * alpha1, y: p0.y + t1.y * alpha1 },
    c2: { x: p3.x + t2.x * alpha2, y: p3.y + t2.y * alpha2 },
    to: p3,
  };
}

function reparameterize(p0: Point, curve: CubicSegment, point: Point, u: number): number {
  const { c1, c2, to: p3 } = curve;
  const s = 1 - u;
  const q = {
    x: s * s * s * p0.x + 3 * s * s * u * c1.x + 3 * s * u * u * c2.x + u * u * u * p3.x,
    y: s * s * s * p0.y + 3 * s * s * u * c1.y + 3 * s * u * u * c2.y + u * u * u * p3.y,
  };
  const d1 = {
    x: 3 * (s * s * (c1.x - p0.x) + 2 * s * u * (c2.x - c1.x) + u * u * (p3.x - c2.x)),
    y: 3 * (s * s * (c1.y - p0.y) + 2 * s * u * (c2.y - c1.y) + u * u * (p3.y - c2.y)),
  };
  const d2 = {
    x: 6 * (s * (c2.x - 2 * c1.x + p0.x) + u * (p3.x - 2 * c2.x + c1.x)),
    y: 6 * (s * (c2.y - 2 * c1.y + p0.y) + u * (p3.y - 2 * c2.y + c1.y)),
  };
  const diff = { x: q.x - point.x, y: q.y - point.y };
  const numerator = diff.x * d1.x + diff.y * d1.y;
  const denominator = d1.x * d1.x + d1.y * d1.y + diff.x * d2.x + diff.y * d2.y;
  if (Math.abs(denominator) < 1e-12) return u;
  return Math.min(1, Math.max(0, u - numerator / denominator));
}

// ---------------------------------------------------------------------------------------------
// Resumen para la interfaz.
// ---------------------------------------------------------------------------------------------

/** Lo que la interfaz necesita saber de los nodos seleccionados de un trazado. */
export interface NodeSummary {
  readonly count: number;
  /** Tipo común de los nodos con dos lados, `mixed` si son distintos o `null` si no hay ninguno. */
  readonly kind: NodeKind | "mixed" | null;
  /** Algún nodo seleccionado tiene dos lados (puede ser suave o simétrico). */
  readonly canSmooth: boolean;
  /** Algún segmento con sus dos nodos seleccionados no es recto / no es una curva cúbica. */
  readonly canMakeLine: boolean;
  readonly canMakeCurve: boolean;
}

export function summarizeNodes(data: PathData, keys: ReadonlySet<string>): NodeSummary {
  const nodes = pathNodes(data).filter((node) => keys.has(nodeKey(node)));
  const kinds = new Set<NodeKind>();
  let canSmooth = false;
  let canMakeLine = false;
  let canMakeCurve = false;
  data.forEach((subpath, s) => {
    const chain = toChain(subpath, s, keys);
    chain.nodes.forEach((_, i) => {
      if (chain.tags[i] === null) return;
      const [incoming, outgoing] = sides(chain, i);
      if (incoming === -1 || outgoing === -1 || incoming === outgoing) return;
      canSmooth = true;
      kinds.add(nodeKind(data, { subpath: s, index: i }));
    });
    for (const j of selectedSegments(chain)) {
      const kind = chain.segments[j]?.kind;
      if (kind !== "line") canMakeLine = true;
      if (kind !== "cubic") canMakeCurve = true;
    }
  });
  const [only] = kinds;
  return {
    count: nodes.length,
    kind: kinds.size === 0 ? null : kinds.size === 1 && only ? only : "mixed",
    canSmooth,
    canMakeLine,
    canMakeCurve,
  };
}
