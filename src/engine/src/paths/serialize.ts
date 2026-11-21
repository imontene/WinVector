import type { Point } from "../geometry";
import type { PathData, Segment } from "./model";

/**
 * Escribe un trazado de forma compacta y legible (issue #74): en cada segmento elige entre la forma
 * absoluta y la relativa la más corta; usa `H`, `V`, `S` y `T` cuando valen; no repite la letra de
 * un comando seguido; y escribe los números sin ceros ni separadores de más (`M10-5.5.5`).
 *
 * Los puntos se redondean antes de calcular las coordenadas relativas, así que escribir y volver a
 * leer no acumula errores de redondeo a lo largo del trazado.
 */

export interface SerializeOptions {
  /** Decimales como máximo (3 por omisión). */
  readonly precision?: number;
}

const EPSILON = 1e-9;

/** Número sin ceros de más: `0.5` → `.5`, `-0.5` → `-.5`, `-0` → `0`, `2.000` → `2`. */
export function formatPathNumber(value: number, precision = 3): string {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  let text = String(rounded);
  if (text.includes("e")) text = rounded.toFixed(precision).replace(/\.?0+$/, "");
  return text.replace(/^(-?)0\./, "$1.");
}

/** Une números con el separador mínimo: ninguno antes de `-`, ni antes de `.` si el anterior ya tiene punto. */
function joinNumbers(numbers: readonly string[]): string {
  let out = "";
  for (const n of numbers) {
    if (out === "") out = n;
    else if (n.startsWith("-") || (n.startsWith(".") && /[.e]/.test(lastNumber(out)))) out += n;
    else out += ` ${n}`;
  }
  return out;
}

/** Último número de una lista ya unida (para saber si tiene punto decimal). */
const lastNumber = (text: string) => /[-+]?[\d.e]+$/.exec(text)?.[0] ?? "";

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;

interface Candidate {
  readonly letter: string;
  readonly numbers: readonly string[];
}

/** Escribe el trazado. */
export function serializePath(data: PathData, options: SerializeOptions = {}): string {
  const precision = options.precision ?? 3;
  const factor = 10 ** precision;
  const round = (p: Point): Point => ({
    x: Math.round(p.x * factor) / factor,
    y: Math.round(p.y * factor) / factor,
  });
  const num = (value: number) => formatPathNumber(value, precision);
  // Diferencia entre dos valores ya redondeados, sin restos de coma flotante.
  const delta = (a: number, b: number) => num(Math.round((a - b) * factor) / factor);

  let out = "";
  let lastLetter = "";
  const emit = ({ letter, numbers }: Candidate) => {
    const body = joinNumbers(numbers);
    if (
      letter === lastLetter &&
      letter !== "Z" &&
      letter !== "z" &&
      letter !== "M" &&
      letter !== "m"
    ) {
      // Repetición implícita: sin letra, con el separador que haga falta.
      out += body.startsWith("-") ? body : ` ${body}`;
    } else {
      out += letter + body;
    }
    lastLetter = letter;
  };
  const shortest = (a: Candidate, b: Candidate) => {
    const length = (c: Candidate) =>
      joinNumbers(c.numbers).length + (c.letter === lastLetter ? 0 : 1);
    return length(b) < length(a) ? b : a;
  };

  let current: Point = { x: 0, y: 0 };
  let first = true;
  for (const subpath of data) {
    const start = round(subpath.start);
    const move = first
      ? { letter: "M", numbers: [num(start.x), num(start.y)] }
      : shortest(
          { letter: "M", numbers: [num(start.x), num(start.y)] },
          { letter: "m", numbers: [delta(start.x, current.x), delta(start.y, current.y)] },
        );
    emit(move);
    first = false;
    current = start;
    let previous: Segment | null = null;
    for (const segment of subpath.segments) {
      emit(choose(segment, previous, current));
      current = round(segment.to);
      previous = segment;
    }
    if (subpath.closed) {
      emit({ letter: "Z", numbers: [] });
      current = start;
    }
  }
  return out;

  /** La forma más corta de escribir un segmento desde `from`. */
  function choose(segment: Segment, previous: Segment | null, from: Point): Candidate {
    const to = round(segment.to);
    const abs = (p: Point) => [num(round(p).x), num(round(p).y)];
    const rel = (p: Point) => [delta(round(p).x, from.x), delta(round(p).y, from.y)];
    const pair = (absolute: Candidate, relative: Candidate) => shortest(absolute, relative);
    switch (segment.kind) {
      case "line":
        if (Math.abs(to.y - from.y) < EPSILON && Math.abs(to.x - from.x) >= EPSILON) {
          return pair(
            { letter: "H", numbers: [num(to.x)] },
            { letter: "h", numbers: [delta(to.x, from.x)] },
          );
        }
        if (Math.abs(to.x - from.x) < EPSILON && Math.abs(to.y - from.y) >= EPSILON) {
          return pair(
            { letter: "V", numbers: [num(to.y)] },
            { letter: "v", numbers: [delta(to.y, from.y)] },
          );
        }
        return pair({ letter: "L", numbers: abs(to) }, { letter: "l", numbers: rel(to) });
      case "cubic": {
        const reflected =
          previous?.kind === "cubic"
            ? { x: 2 * from.x - round(previous.c2).x, y: 2 * from.y - round(previous.c2).y }
            : from;
        if (same(round(segment.c1), reflected)) {
          return pair(
            { letter: "S", numbers: [...abs(segment.c2), ...abs(to)] },
            { letter: "s", numbers: [...rel(segment.c2), ...rel(to)] },
          );
        }
        return pair(
          { letter: "C", numbers: [...abs(segment.c1), ...abs(segment.c2), ...abs(to)] },
          { letter: "c", numbers: [...rel(segment.c1), ...rel(segment.c2), ...rel(to)] },
        );
      }
      case "quad": {
        const reflected =
          previous?.kind === "quad"
            ? { x: 2 * from.x - round(previous.c).x, y: 2 * from.y - round(previous.c).y }
            : from;
        if (same(round(segment.c), reflected) && previous?.kind === "quad") {
          return pair({ letter: "T", numbers: abs(to) }, { letter: "t", numbers: rel(to) });
        }
        return pair(
          { letter: "Q", numbers: [...abs(segment.c), ...abs(to)] },
          { letter: "q", numbers: [...rel(segment.c), ...rel(to)] },
        );
      }
      case "arc": {
        const shape = [
          num(segment.rx),
          num(segment.ry),
          num(segment.rotation),
          segment.large ? "1" : "0",
          segment.sweep ? "1" : "0",
        ];
        return pair(
          { letter: "A", numbers: [...shape, ...abs(to)] },
          { letter: "a", numbers: [...shape, ...rel(to)] },
        );
      }
    }
  }
}
