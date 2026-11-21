import { describe, expect, it } from "vitest";
import type { PathData, Segment, Subpath } from "./model";
import { parsePath } from "./parse";
import { formatPathNumber, serializePath } from "./serialize";

const roundTrip = (d: string) => serializePath(parsePath(d).data);

describe("serializador de d", () => {
  it("escribe los números sin ceros ni separadores de más", () => {
    expect(formatPathNumber(0.5)).toBe(".5");
    expect(formatPathNumber(-0.5)).toBe("-.5");
    expect(formatPathNumber(-0.0001)).toBe("0");
    expect(formatPathNumber(2)).toBe("2");
    expect(formatPathNumber(1 / 3)).toBe(".333");
    expect(formatPathNumber(1e-7, 3)).toBe("0");
    expect(formatPathNumber(123456789.123456)).toBe("123456789.123");
    expect(roundTrip("M 10 , -5 L 0.5 0.5")).toBe("M10-5L.5.5");
  });

  it("usa H y V, S y T, y no repite la letra de un comando seguido", () => {
    expect(roundTrip("M0 0 L10 0 L10 10 L20 20 L30 30")).toBe("M0 0H10V10L20 20 30 30");
    expect(roundTrip("M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0")).toBe(
      "M0 0C0 10 10 10 10 0S20-10 20 0",
    );
    expect(roundTrip("M0 0Q5 10 10 0Q15 -10 20 0")).toBe("M0 0Q5 10 10 0T20 0");
  });

  it("elige la forma relativa cuando es más corta", () => {
    expect(roundTrip("M1000 1000 L1001 1001")).toBe("M1000 1000l1 1");
    expect(roundTrip("M1000 1000 L0 0")).toBe("M1000 1000L0 0");
  });

  it("escribe arcos y subtrazados cerrados", () => {
    expect(roundTrip("M0 0A5 5 30 1 1 10 10Z M20 20 L30 30z")).toBe(
      "M0 0A5 5 30 1 1 10 10ZM20 20L30 30Z",
    );
  });

  it("el redondeo no se acumula a lo largo de un trazado relativo", () => {
    const steps = Array.from({ length: 200 }, () => "l0.0004 0.0004").join("");
    const written = serializePath(parsePath(`M0 0${steps}`).data);
    const end = parsePath(written).data[0]?.segments.at(-1)?.to;
    expect(end?.x).toBeCloseTo(0.08, 2);
  });

  it("leer, escribir y volver a leer da la misma geometría (trazados al azar)", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const coordinate = () => Math.round((random() * 2000 - 1000) * 1000) / 1000;
    const point = () => ({ x: coordinate(), y: coordinate() });
    for (let run = 0; run < 300; run++) {
      const data: Subpath[] = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
        start: point(),
        closed: random() < 0.5,
        segments: Array.from({ length: Math.floor(random() * 6) }, (): Segment => {
          const kind = Math.floor(random() * 4);
          if (kind === 0) return { kind: "line", to: point() };
          if (kind === 1) return { kind: "cubic", c1: point(), c2: point(), to: point() };
          if (kind === 2) return { kind: "quad", c: point(), to: point() };
          return {
            kind: "arc",
            rx: Math.abs(coordinate()),
            ry: Math.abs(coordinate()),
            rotation: Math.round(random() * 360),
            large: random() < 0.5,
            sweep: random() < 0.5,
            to: point(),
          };
        }),
      }));
      const written = serializePath(data);
      const reread = parsePath(written);
      expect(reread.error, written).toBeNull();
      expectSameGeometry(reread.data, data);
      // Escribir otra vez lo leído da el mismo texto.
      expect(serializePath(reread.data)).toBe(written);
    }
  });
});

function expectSameGeometry(actual: PathData, expected: PathData): void {
  expect(actual).toHaveLength(expected.length);
  const close = (a: unknown, b: unknown, path: string) => {
    if (typeof a === "number" && typeof b === "number") {
      expect(Math.abs(a - b), path).toBeLessThan(1e-6);
    } else if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of Object.keys(b))
        close(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
    } else {
      expect(a, path).toEqual(b);
    }
  };
  close(actual, expected, "trazado");
}
