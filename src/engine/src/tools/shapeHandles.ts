import type { Point } from "../geometry";
import { radiusHandles } from "./cornerRadius";
import { lineHandles } from "./lineEnds";

/**
 * Manejadores propios de una forma seleccionada, además de los de escalar y girar: el radio de las
 * esquinas de un rectángulo o los extremos de una línea. Los atiende la herramienta Selección.
 */

/** Radio de los manejadores en pantalla, en píxeles. */
export const SHAPE_HANDLE_SIZE = 4;
/** Margen alrededor de cada manejador para acertar con el puntero. */
const HIT_TOLERANCE = 4;

/** Un arrastre de un manejador. */
export interface HandleDrag {
  /** Lleva el manejador al punto de la pantalla; `shift` es la tecla Mayús. */
  update(pointer: Point, shift: boolean): void;
}

export interface ShapeHandles {
  /** Acción del historial de un arrastre ("corner-radius"). */
  readonly action: string;
  /** Cursor sobre los manejadores (valor de `data-handle`). */
  readonly cursor: string;
  /** True si sustituyen a los manejadores de escalar y girar (los extremos de una línea). */
  readonly replacesBox: boolean;
  /** Posición de cada manejador en pantalla. */
  points(): Point[];
  /** Empieza a arrastrar el manejador `index` desde el punto de la pantalla `pointer`. */
  start(index: number, pointer: Point): HandleDrag;
}

/** Manejadores propios de la selección: solo con una forma que los tenga. */
export function shapeHandles(items: readonly Element[]): ShapeHandles | null {
  const [only] = items;
  if (items.length !== 1 || !only) return null;
  if (only instanceof SVGRectElement) return radiusHandles(only);
  if (only instanceof SVGLineElement) return lineHandles(only);
  return null;
}

/** Índice del manejador bajo un punto de la pantalla, o -1. */
export function shapeHandleAt(handles: ShapeHandles, point: Point): number {
  const reach = SHAPE_HANDLE_SIZE + HIT_TOLERANCE;
  return handles
    .points()
    .findIndex((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= reach);
}
