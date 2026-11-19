import { describe, expect, it } from "vitest";
import { rotation, scaling, translation } from "./matrix";
import {
  boundsOfPoints,
  containsRect,
  corners,
  rectFromCorners,
  transformRect,
  union,
} from "./rect";

describe("rectángulos", () => {
  it("se crean desde dos esquinas en cualquier orden", () => {
    expect(rectFromCorners({ x: 10, y: 5 }, { x: 2, y: 9 })).toEqual({
      x: 2,
      y: 5,
      width: 8,
      height: 4,
    });
  });

  it("enumeran sus esquinas", () => {
    expect(corners({ x: 1, y: 2, width: 3, height: 4 })).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 6 },
      { x: 1, y: 6 },
    ]);
  });

  it("rodean un conjunto de puntos", () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([{ x: 3, y: -1 }])).toEqual({ x: 3, y: -1, width: 0, height: 0 });
  });

  it("se transforman en su caja alineada con los ejes", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(transformRect(translation(5, 1), rect)).toEqual({ x: 5, y: 1, width: 10, height: 10 });
    expect(transformRect(scaling(2, -1), rect)).toEqual({ x: 0, y: -10, width: 20, height: 10 });
    const rotated = transformRect(rotation(45), rect);
    expect(rotated.width).toBeCloseTo(Math.SQRT2 * 10);
    expect(rotated.x).toBeCloseTo(-Math.SQRT1_2 * 10);
  });

  it("se unen", () => {
    expect(union([])).toBeNull();
    expect(
      union([
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 5, y: -2, width: 1, height: 1 },
      ]),
    ).toEqual({ x: 0, y: -2, width: 6, height: 3 });
  });

  it("saben si contienen a otro", () => {
    const outer = { x: 0, y: 0, width: 10, height: 10 };
    expect(containsRect(outer, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(containsRect(outer, { x: 2, y: 2, width: 9, height: 1 })).toBe(false);
  });
});
