import type { Point } from "../geometry";

/**
 * Modelo de un trazado (`d`) para editarlo (issue #74): subtrazados con segmentos en coordenadas
 * absolutas. Las abreviaturas de SVG (`H`, `V`, `S`, `T`, comandos relativos) se resuelven al leer
 * y se vuelven a usar al escribir cuando acortan el texto.
 */

/** Recta hasta `to`. */
export interface LineSegment {
  readonly kind: "line";
  readonly to: Point;
}

/** Curva de Bézier cúbica con sus dos puntos de control. */
export interface CubicSegment {
  readonly kind: "cubic";
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

/** Curva de Bézier cuadrática con su punto de control. */
export interface QuadSegment {
  readonly kind: "quad";
  readonly c: Point;
  readonly to: Point;
}

/**
 * Arco de elipse, como en SVG: radios, giro de la elipse en grados y las dos banderas que eligen
 * cuál de los cuatro arcos posibles. Con un radio 0 se dibuja como una recta.
 */
export interface ArcSegment {
  readonly kind: "arc";
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
  readonly large: boolean;
  readonly sweep: boolean;
  readonly to: Point;
}

export type Segment = LineSegment | CubicSegment | QuadSegment | ArcSegment;

/** Un subtrazado: empieza en `start` (un `M`) y, si está cerrado, termina con `Z`. */
export interface Subpath {
  readonly start: Point;
  readonly segments: readonly Segment[];
  readonly closed: boolean;
}

/** Un trazado: sus subtrazados en orden. */
export type PathData = readonly Subpath[];

/** Último punto de un subtrazado (al que vuelve si está cerrado). */
export function subpathEnd(subpath: Subpath): Point {
  return subpath.closed ? subpath.start : (subpath.segments.at(-1)?.to ?? subpath.start);
}
