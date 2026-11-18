/** Punto en coordenadas de usuario SVG. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Matriz de transformación afín 2D con la misma convención que SVG y `DOMMatrix`:
 *
 * ```
 * | a c e |
 * | b d f |
 * | 0 0 1 |
 * ```
 *
 * Es inmutable y no depende del DOM, para poder probarla y usarla fuera del navegador.
 */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** Devuelve `m1 × m2`: al aplicarla a un punto, se aplica primero `m2` y después `m1`. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function translation(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaling(sx: number, sy: number = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Rotación en grados, positiva en el sentido de las agujas del reloj (eje Y hacia abajo, como en SVG). */
export function rotation(degrees: number, center: Point = { x: 0, y: 0 }): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotate: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  if (center.x === 0 && center.y === 0) {
    return rotate;
  }
  return multiply(
    translation(center.x, center.y),
    multiply(rotate, translation(-center.x, -center.y)),
  );
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  };
}

export function determinant(m: Matrix): number {
  return m.a * m.d - m.b * m.c;
}

/** Devuelve la matriz inversa, o `null` si no es invertible (por ejemplo, una escala a cero). */
export function invert(m: Matrix): Matrix | null {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Representación para el atributo `transform` de SVG. */
export function toSvgTransform(m: Matrix): string {
  const values = [m.a, m.b, m.c, m.d, m.e, m.f].map(formatNumber);
  return `matrix(${values.join(" ")})`;
}

function formatNumber(value: number): string {
  // Redondea a 6 decimales para evitar restos como 6.123233995736766e-17 en el SVG guardado.
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
