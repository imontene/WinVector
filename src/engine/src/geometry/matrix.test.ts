import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  applyToPoint,
  invert,
  multiply,
  rotation,
  scaling,
  toSvgTransform,
  translation,
  type Point,
} from "./matrix";

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("matrix", () => {
  it("la identidad no cambia los puntos", () => {
    expect(applyToPoint(IDENTITY, { x: 12, y: -3 })).toEqual({ x: 12, y: -3 });
  });

  it("aplica primero la matriz de la derecha", () => {
    const m = multiply(translation(10, 0), scaling(2));
    expect(applyToPoint(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it("rota en el sentido de las agujas del reloj con el eje Y hacia abajo", () => {
    expectPointClose(applyToPoint(rotation(90), { x: 1, y: 0 }), { x: 0, y: 1 });
  });

  it("rota alrededor de un centro", () => {
    const m = rotation(180, { x: 5, y: 5 });
    expectPointClose(applyToPoint(m, { x: 10, y: 5 }), { x: 0, y: 5 });
  });

  it("la inversa deshace la transformación", () => {
    const m = multiply(translation(30, -8), multiply(rotation(33), scaling(2, 0.5)));
    const inverse = invert(m);
    if (!inverse) throw new Error("La matriz debería ser invertible");
    const p = { x: 7, y: 19 };
    expectPointClose(applyToPoint(inverse, applyToPoint(m, p)), p);
  });

  it("devuelve null para una matriz no invertible", () => {
    expect(invert(scaling(0, 1))).toBeNull();
  });

  it("genera un atributo transform sin restos de coma flotante", () => {
    expect(toSvgTransform(rotation(90))).toBe("matrix(0 1 -1 0 0 0)");
    expect(toSvgTransform(translation(10.5, -2))).toBe("matrix(1 0 0 1 10.5 -2)");
  });
});
