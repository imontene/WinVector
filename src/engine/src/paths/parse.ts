import type { Point } from "../geometry";
import type { PathData, Segment, Subpath } from "./model";

/**
 * Analizador de `d` según la gramática de SVG 2: comandos absolutos y relativos, repetición
 * implícita (pares tras `M` son rectas), números pegados (`1-2`, `.5.5`), exponentes y banderas de
 * arco sin separador (`a1 1 0 01 5 5`).
 *
 * Como los navegadores, si encuentra un error se queda con lo leído hasta el último segmento
 * completo y anota dónde estaba el error.
 */

export interface PathParseError {
  /** Posición del carácter donde empieza el error. */
  readonly index: number;
  readonly message: string;
}

export interface ParsedPath {
  readonly data: PathData;
  readonly error: PathParseError | null;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);
const COMMANDS = new Set("MmZzLlHhVvCcSsQqTtAa");
/** Números que lleva cada comando por cada repetición. */
const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

class ParseFailure extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(message);
  }
}

class Scanner {
  index = 0;
  constructor(readonly text: string) {}

  get done(): boolean {
    this.skipWhitespace();
    return this.index >= this.text.length;
  }

  skipWhitespace(): void {
    while (this.index < this.text.length && WHITESPACE.has(this.text[this.index] ?? ""))
      this.index++;
  }

  /** Salta espacios y, como mucho, una coma (entre números). */
  skipSeparator(): void {
    this.skipWhitespace();
    if (this.text[this.index] === ",") {
      this.index++;
      this.skipWhitespace();
    }
  }

  peek(): string {
    return this.text[this.index] ?? "";
  }

  /** True si lo siguiente empieza un número. */
  atNumber(): boolean {
    this.skipWhitespace();
    const c = this.peek();
    return (c >= "0" && c <= "9") || c === "." || c === "-" || c === "+";
  }

  number(): number {
    this.skipWhitespace();
    const start = this.index;
    const text = this.text;
    let i = this.index;
    if (text[i] === "+" || text[i] === "-") i++;
    let digits = 0;
    while (i < text.length && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "9") {
      i++;
      digits++;
    }
    if (text[i] === ".") {
      i++;
      while (i < text.length && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "9") {
        i++;
        digits++;
      }
    }
    if (digits === 0) throw new ParseFailure(start, "Se esperaba un número.");
    if (text[i] === "e" || text[i] === "E") {
      let j = i + 1;
      if (text[j] === "+" || text[j] === "-") j++;
      const exponentStart = j;
      while (j < text.length && (text[j] ?? "") >= "0" && (text[j] ?? "") <= "9") j++;
      if (j === exponentStart) throw new ParseFailure(i, "Exponente sin dígitos.");
      i = j;
    }
    this.index = i;
    return Number(text.slice(start, i));
  }

  /** Bandera de arco: un solo carácter 0 o 1, que puede ir pegado a lo siguiente. */
  flag(): boolean {
    this.skipWhitespace();
    const c = this.peek();
    if (c !== "0" && c !== "1")
      throw new ParseFailure(this.index, "Se esperaba una bandera de arco (0 o 1).");
    this.index++;
    return c === "1";
  }
}

const reflect = (point: Point, center: Point): Point => ({
  x: 2 * center.x - point.x,
  y: 2 * center.y - point.y,
});

/** Lee un `d`. Nunca lanza: los errores vienen en `error`. */
export function parsePath(d: string): ParsedPath {
  const scanner = new Scanner(d);
  const subpaths: Subpath[] = [];
  let start: Point = { x: 0, y: 0 };
  let current: Point = { x: 0, y: 0 };
  let segments: Segment[] | null = null;
  let previous: Segment | null = null;
  let command = "";
  let error: PathParseError | null = null;

  const finishSubpath = (closed: boolean) => {
    if (segments) subpaths.push({ start, segments, closed });
    segments = null;
  };
  /** Segmentos del subtrazado actual; tras `Z`, uno nuevo empieza donde empezaba el cerrado. */
  const open = (): Segment[] => {
    segments ??= [];
    return segments;
  };
  const add = (segment: Segment) => {
    open().push(segment);
    current = segment.to;
    previous = segment;
  };

  try {
    while (!scanner.done) {
      const c = scanner.peek();
      if (COMMANDS.has(c)) {
        command = c;
        scanner.index++;
      } else if (command === "" || command === "Z" || command === "z" || !scanner.atNumber()) {
        throw new ParseFailure(scanner.index, `Carácter inesperado «${c}».`);
      }
      if (subpaths.length === 0 && segments === null && command !== "M" && command !== "m") {
        throw new ParseFailure(scanner.index - 1, "Un trazado tiene que empezar con M.");
      }
      const upper = command.toUpperCase();
      const relative =
        command !== upper && (upper !== "M" || segments !== null || subpaths.length > 0);
      const base = relative ? current : { x: 0, y: 0 };
      const point = (x: number, y: number): Point => ({ x: base.x + x, y: base.y + y });
      // Los números de una repetición se leen enteros antes de añadir el segmento.
      const read = () => {
        const values: number[] = [];
        for (let k = 0; k < (ARITY[upper] ?? 0); k++) {
          if (k > 0) scanner.skipSeparator();
          if (upper === "A" && (k === 3 || k === 4)) values.push(scanner.flag() ? 1 : 0);
          else values.push(scanner.number());
        }
        return values;
      };

      if (upper === "Z") {
        finishSubpath(true);
        current = start;
        previous = null;
        continue;
      }
      const v = read();
      const [a = 0, b = 0, c2 = 0, d2 = 0, e = 0, f = 0, g = 0] = v;
      switch (upper) {
        case "M":
          finishSubpath(false);
          start = point(a, b);
          current = start;
          segments = [];
          previous = null;
          // Los pares que siguen a un M son rectas.
          command = command === "m" ? "l" : "L";
          break;
        case "L":
          add({ kind: "line", to: point(a, b) });
          break;
        case "H":
          add({ kind: "line", to: { x: relative ? current.x + a : a, y: current.y } });
          break;
        case "V":
          add({ kind: "line", to: { x: current.x, y: relative ? current.y + a : a } });
          break;
        case "C":
          add({ kind: "cubic", c1: point(a, b), c2: point(c2, d2), to: point(e, f) });
          break;
        case "S": {
          const last = previous as Segment | null;
          const c1 = last?.kind === "cubic" ? reflect(last.c2, current) : current;
          add({ kind: "cubic", c1, c2: point(a, b), to: point(c2, d2) });
          break;
        }
        case "Q":
          add({ kind: "quad", c: point(a, b), to: point(c2, d2) });
          break;
        case "T": {
          const last = previous as Segment | null;
          const control = last?.kind === "quad" ? reflect(last.c, current) : current;
          add({ kind: "quad", c: control, to: point(a, b) });
          break;
        }
        case "A":
          add({
            kind: "arc",
            rx: Math.abs(a),
            ry: Math.abs(b),
            rotation: c2,
            large: d2 === 1,
            sweep: e === 1,
            to: point(f, g),
          });
          break;
      }
      scanner.skipSeparator();
    }
  } catch (failure) {
    if (!(failure instanceof ParseFailure)) throw failure;
    error = { index: failure.index, message: failure.message };
  }
  finishSubpath(false);
  return { data: subpaths, error };
}
