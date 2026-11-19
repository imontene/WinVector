import { describe, expect, it } from "vitest";
import { multiplesBetween, niceStep, snapToGrid } from "./snap";

describe("niceStep", () => {
  it.each([
    [1, 50, 50],
    [1, 8, 10],
    [2, 50, 50],
    [10, 50, 5],
    [0.5, 50, 100],
    [100, 8, 0.1],
    [3, 50, 20],
    [0.01, 50, 5000],
  ])("a escala %d y %d px mínimos, paso %d", (scale, min, expected) => {
    expect(niceStep(scale, min)).toBeCloseTo(expected);
  });

  it("devuelve un paso válido con datos absurdos", () => {
    expect(niceStep(0, 50)).toBe(1);
    expect(niceStep(Number.NaN, 50)).toBe(1);
  });
});

describe("multiplesBetween", () => {
  it("enumera los múltiplos, incluidos los extremos", () => {
    expect(multiplesBetween(-10, 20, 10)).toEqual([-10, 0, 10, 20]);
    expect(multiplesBetween(0.05, 0.35, 0.1)).toEqual([0.1, 0.2, 0.3]);
    expect(multiplesBetween(5, 1, 1)).toEqual([]);
  });
});

describe("snapToGrid", () => {
  it("lleva el punto al nodo más cercano", () => {
    expect(snapToGrid({ x: 12, y: -7 }, 10)).toEqual({ x: 10, y: -10 });
    expect(snapToGrid({ x: 0.26, y: 0.34 }, 0.1)).toEqual({ x: 0.3, y: 0.3 });
    expect(snapToGrid({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });
});
