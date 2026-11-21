import { describe, expect, it } from "vitest";
import type { Point } from "../geometry";
import {
  arcCenter,
  arcToCubics,
  nearestOnPath,
  nearestOnSegment,
  pathBounds,
  pointAt,
  segmentBounds,
  splitPathAt,
  splitSegment,
} from "./curves";
import type { ArcSegment, Segment } from "./model";
import { parsePath } from "./parse";

const O: Point = { x: 0, y: 0 };
const near = (a: Point, b: Point, tolerance = 1e-6) => {
  expect(Math.abs(a.x - b.x), `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`).toBeLessThan(
    tolerance,
  );
  expect(Math.abs(a.y - b.y), `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`).toBeLessThan(
    tolerance,
  );
};
const arc = (
  rx: number,
  ry: number,
  to: Point,
  large = false,
  sweep = true,
  rotation = 0,
): ArcSegment => ({
  kind: "arc",
  rx,
  ry,
  rotation,
  large,
  sweep,
  to,
});

let seed = 11;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const randomPoint = () => ({ x: random() * 200 - 100, y: random() * 200 - 100 });
const randomSegment = (): Segment => {
  const kind = Math.floor(random() * 4);
  if (kind === 0) return { kind: "line", to: randomPoint() };
  if (kind === 1) return { kind: "quad", c: randomPoint(), to: randomPoint() };
  if (kind === 2) return { kind: "cubic", c1: randomPoint(), c2: randomPoint(), to: randomPoint() };
  return arc(
    5 + random() * 80,
    5 + random() * 80,
    randomPoint(),
    random() < 0.5,
    random() < 0.5,
    random() * 90,
  );
};

describe("arcos", () => {
  it("calcula el centro y el barrido de un semicírculo", () => {
    const c = arcCenter(O, arc(5, 5, { x: 10, y: 0 }));
    expect(c?.cx).toBeCloseTo(5);
    expect(c?.cy).toBeCloseTo(0);
    expect(Math.abs(c?.delta ?? 0)).toBeCloseTo(Math.PI);
  });

  it("agranda los radios que no llegan y no tiene centro si se dibuja como recta", () => {
    const c = arcCenter(O, arc(1, 1, { x: 10, y: 0 }));
    expect(c?.rx).toBeCloseTo(5);
    expect(arcCenter(O, arc(0, 5, { x: 10, y: 0 }))).toBeNull();
    expect(arcCenter(O, arc(5, 5, O))).toBeNull();
  });

  it("las cúbicas de un arco se separan del círculo menos de un 0,03 % del radio", () => {
    const radius = 50;
    const from = { x: radius, y: 0 };
    const cubics = arcToCubics(from, arc(radius, radius, { x: -radius, y: 0.001 }, true));
    expect(cubics.length).toBeGreaterThanOrEqual(2);
    let start = from;
    for (const cubic of cubics) {
      for (let i = 0; i <= 20; i++) {
        const p = pointAt(start, cubic, i / 20);
        expect(Math.abs(Math.hypot(p.x, p.y) - radius)).toBeLessThan(radius * 3e-4);
      }
      start = cubic.to;
    }
    near(start, { x: -radius, y: 0.001 });
    expect(arcToCubics(O, arc(0, 5, { x: 3, y: 4 }))).toEqual([
      { kind: "line", to: { x: 3, y: 4 } },
    ]);
  });
});

describe("partir segmentos", () => {
  it("cada mitad recorre la parte que le toca del segmento original", () => {
    for (let run = 0; run < 400; run++) {
      const from = randomPoint();
      const segment = randomSegment();
      const t = 0.05 + random() * 0.9;
      const [a, b] = splitSegment(from, segment, t);
      near(a.to, pointAt(from, segment, t), 1e-6);
      near(b.to, segment.to, 1e-9);
      for (const u of [0.25, 0.5, 0.75]) {
        near(pointAt(from, a, u), pointAt(from, segment, u * t), 1e-6);
        near(pointAt(a.to, b, u), pointAt(from, segment, t + u * (1 - t)), 1e-6);
      }
    }
  });

  it("partir la recta de cierre añade una recta al final", () => {
    const { data } = parsePath("M0 0H10V10Z");
    const location = nearestOnPath(data, { x: 4, y: 5 });
    expect(location).toMatchObject({ subpath: 0, segment: 2 });
    const split = splitPathAt(data, { subpath: 0, segment: 2, t: 0.5 });
    expect(split[0]?.segments.at(-1)).toEqual({ kind: "line", to: { x: 5, y: 5 } });
  });
});

describe("caja exacta", () => {
  it("usa los extremos de la curva, no los puntos de control", () => {
    expect(
      segmentBounds(O, {
        kind: "cubic",
        c1: { x: 0, y: 10 },
        c2: { x: 10, y: 10 },
        to: { x: 10, y: 0 },
      }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 7.5,
    });
    expect(segmentBounds(O, { kind: "quad", c: { x: 5, y: 10 }, to: { x: 10, y: 0 } })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 5,
    });
  });

  it("incluye los extremos de los arcos, también girados", () => {
    const up = segmentBounds(O, arc(5, 5, { x: 10, y: 0 }, false, true));
    expect(up.y).toBeCloseTo(-5);
    expect(up.height).toBeCloseTo(5);
    const tilted = segmentBounds({ x: -10, y: 0 }, arc(10, 5, { x: 10, y: 0 }, false, false, 30));
    expect(tilted.height).toBeGreaterThan(5);
    expect(pathBounds(parsePath("M0 0").data)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(pathBounds([])).toBeNull();
  });
});

describe("punto más cercano", () => {
  it("en una recta es la proyección", () => {
    expect(nearestOnSegment(O, { kind: "line", to: { x: 10, y: 0 } }, { x: 3, y: 4 })).toEqual({
      t: 0.3,
      point: { x: 3, y: 0 },
      distance: 4,
    });
  });

  it("en curvas y arcos encuentra el punto de la curva", () => {
    const semicircle = arc(5, 5, { x: 10, y: 0 }, false, true);
    const found = nearestOnSegment(O, semicircle, { x: 5, y: -20 });
    near(found.point, { x: 5, y: -5 }, 1e-6);
    expect(found.distance).toBeCloseTo(15);
    for (let run = 0; run < 100; run++) {
      const from = randomPoint();
      const segment = randomSegment();
      const t = random();
      const on = pointAt(from, segment, t);
      expect(nearestOnSegment(from, segment, on).distance).toBeLessThan(1e-4);
    }
  });
});
