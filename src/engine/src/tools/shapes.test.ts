import { describe, expect, it } from "vitest";
import { coordinate, dragBox, type ShapeDrag } from "./shapes";

const drag = (end: { x: number; y: number }, options: Partial<ShapeDrag> = {}): ShapeDrag => ({
  start: { x: 10, y: 20 },
  end,
  proportional: false,
  fromCenter: false,
  ...options,
});

describe("caja de un arrastre", () => {
  it("va de la esquina inicial a la final en cualquier dirección", () => {
    expect(dragBox(drag({ x: 40, y: 30 }))).toEqual({ x: 10, y: 20, width: 30, height: 10 });
    expect(dragBox(drag({ x: 0, y: 5 }))).toEqual({ x: 0, y: 5, width: 10, height: 15 });
  });

  it("con Mayús es cuadrada, del lado mayor y hacia donde va el puntero", () => {
    expect(dragBox(drag({ x: 40, y: 30 }, { proportional: true }))).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 30,
    });
    expect(dragBox(drag({ x: 0, y: 60 }, { proportional: true }))).toEqual({
      x: -30,
      y: 20,
      width: 40,
      height: 40,
    });
  });

  it("con Alt, el punto inicial es el centro", () => {
    expect(dragBox(drag({ x: 40, y: 30 }, { fromCenter: true }))).toEqual({
      x: -20,
      y: 10,
      width: 60,
      height: 20,
    });
  });

  it("con Mayús y Alt, cuadrada y centrada", () => {
    expect(dragBox(drag({ x: 15, y: 40 }, { proportional: true, fromCenter: true }))).toEqual({
      x: -10,
      y: 0,
      width: 40,
      height: 40,
    });
  });

  it("sin moverse en un eje no tiene tamaño en ese eje", () => {
    expect(dragBox(drag({ x: 50, y: 20 })).height).toBe(0);
  });
});

describe("coordenadas", () => {
  it("se escriben con dos decimales como máximo y sin restos de coma flotante", () => {
    expect(coordinate(0.1 + 0.2)).toBe("0.3");
    expect(coordinate(12.3456)).toBe("12.35");
    expect(coordinate(-0.001)).toBe("0");
    expect(coordinate(40)).toBe("40");
  });
});
