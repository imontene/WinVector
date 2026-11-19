import type { Point } from "./matrix";

/**
 * Paso "redondo" (1, 2 o 5 por una potencia de 10) más pequeño que, a la escala dada, ocupa al menos
 * `minPixels` en pantalla. Lo usan las reglas y la cuadrícula para que sus marcas no se amontonen
 * ni se separen demasiado con el zoom.
 *
 * @param scale Píxeles de pantalla por unidad del documento.
 */
export function niceStep(scale: number, minPixels: number): number {
  if (!(scale > 0) || !(minPixels > 0)) return 1;
  const raw = minPixels / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * power;
    // Pequeña tolerancia para que los errores de coma flotante no salten al paso siguiente.
    if (step >= raw * (1 - 1e-9)) return step;
  }
  return 10 * power;
}

/** Múltiplos de `step` entre `from` y `to` (incluidos). */
export function multiplesBetween(from: number, to: number, step: number): number[] {
  if (!(step > 0) || to < from) return [];
  const values: number[] = [];
  const first = Math.ceil(from / step - 1e-9);
  for (let n = first; n * step <= to + step * 1e-9; n++) {
    // Se redondea para que 0.1 * 3 se escriba 0.3 en las reglas.
    values.push(Number((n * step).toPrecision(12)));
  }
  return values;
}

/** Ajusta un punto al nodo más cercano de una cuadrícula con origen en (0, 0). */
export function snapToGrid(point: Point, spacing: number): Point {
  if (!(spacing > 0)) return point;
  const snap = (value: number) => Number((Math.round(value / spacing) * spacing).toPrecision(12));
  return { x: snap(point.x), y: snap(point.y) };
}
