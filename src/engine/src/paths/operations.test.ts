import { describe, expect, it } from "vitest";
import { applyToPoint, rotation, scaling, multiply, translation, type Point } from "../geometry";
import { nearestOnPath, pointAt } from "./curves";
import type { PathData } from "./model";
import { closePath, openPath, reversePath, transformPath } from "./operations";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

const parse = (d: string) => parsePath(d).data;
const write = (data: PathData) => serializePath(data);

/** Puntos repartidos por un trazado, con las rectas de cierre. */
function samples(data: PathData): Point[] {
  const points: Point[] = [];
  for (const subpath of data) {
    let from = subpath.start;
    const segments = subpath.closed
      ? [...subpath.segments, { kind: "line" as const, to: subpath.start }]
      : subpath.segments;
    for (const segment of segments) {
      for (let k = 0; k <= 32; k++) points.push(pointAt(from, segment, k / 32));
      from = segment.to;
    }
  }
  return points;
}

/** Distancia máxima de los puntos de `a` a `b` y al revés. */
const distance = (a: PathData, b: PathData) =>
  Math.max(
    ...samples(a).map((p) => nearestOnPath(b, p)?.distance ?? Infinity),
    ...samples(b).map((p) => nearestOnPath(a, p)?.distance ?? Infinity),
  );

describe("invertir la dirección", () => {
  it("un trazado abierto empieza por su final", () => {
    expect(write(reversePath(parse("M0 0L10 0C20 0 30 10 30 20")))).toBe(
      "M30 20C30 10 20 0 10 0H0",
    );
  });

  it("un trazado cerrado sigue empezando en el mismo punto y se recorre al revés", () => {
    expect(write(reversePath(parse("M0 0H10V10Z")))).toBe("M0 0L10 10V0Z");
  });

  it("los arcos cambian el sentido de giro; invertir dos veces deja lo mismo", () => {
    const data = parse("M0 0A10 10 0 0 1 20 0Q30 10 40 0M50 50L60 60");
    const reversed = reversePath(data);
    expect(write(reversed)).toBe("M40 0Q30 10 20 0A10 10 0 0 0 0 0M60 60L50 50");
    expect(write(reversePath(reversed))).toBe(write(data));
    expect(distance(data, reversed)).toBeLessThan(1e-6);
  });
});

describe("abrir y cerrar", () => {
  it("cerrar añade la Z a los subtrazados abiertos", () => {
    expect(write(closePath(parse("M0 0H10V10M20 20H30")))).toBe("M0 0H10V10ZM20 20H30Z");
    const closed = parse("M0 0H10V10Z");
    expect(closePath(closed)).toBe(closed);
  });

  it("abrir por un nodo empieza y termina en él, y se ve igual", () => {
    const data = parse("M0 0H10V10H0Z");
    expect(write(openPath(data))).toBe("M0 0H10V10H0V0");
    const atNode = openPath(data, { subpath: 0, index: 2 });
    expect(write(atNode)).toBe("M10 10H0V0H10V10");
    expect(distance(data, atNode)).toBeLessThan(1e-9);
    const open = parse("M0 0H10");
    expect(openPath(open)).toBe(open);
  });
});

describe("transformar", () => {
  it("con un giro y una escala uniforme, los arcos siguen siendo arcos", () => {
    const data = parse("M0 0A20 10 30 0 1 40 0");
    const m = multiply(translation(5, 7), multiply(rotation(40), scaling(2)));
    const moved = transformPath(data, m);
    const arc = moved[0]?.segments[0];
    expect(arc?.kind).toBe("arc");
    if (arc?.kind !== "arc") return;
    expect(arc.rx).toBeCloseTo(40);
    expect(arc.ry).toBeCloseTo(20);
    // Cada punto del arco transformado es un punto del arco original transformado.
    const expected = samples(data).map((p) => applyToPoint(m, p));
    for (const p of expected) expect(nearestOnPath(moved, p)?.distance).toBeLessThan(1e-6);
  });

  it("con una simetría, el arco cambia de sentido de giro", () => {
    const data = parse("M0 0A20 10 30 0 1 40 0");
    const m = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const mirrored = transformPath(data, m);
    expect(mirrored[0]?.segments[0]).toMatchObject({ kind: "arc", sweep: false });
    for (const p of samples(data).map((q) => applyToPoint(m, q))) {
      expect(nearestOnPath(mirrored, p)?.distance).toBeLessThan(1e-6);
    }
  });

  it("con escalas distintas en cada eje, los arcos pasan a ser curvas", () => {
    const data = parse("M0 0A10 10 0 0 1 20 0");
    const m = scaling(2, 1);
    const stretched = transformPath(data, m);
    expect(stretched[0]?.segments.every((s) => s.kind === "cubic")).toBe(true);
    for (const p of samples(data).map((q) => applyToPoint(m, q))) {
      expect(nearestOnPath(stretched, p)?.distance).toBeLessThan(0.01);
    }
  });

  it("la identidad no cambia nada", () => {
    const data = parse("M0 0L10 10");
    expect(transformPath(data, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(data);
  });
});
