import { describe, expect, it } from "vitest";
import { parsePath, serializePath } from "../paths";
import {
  anchorsToSubpath,
  hasCurves,
  polylineSubpath,
  reverseAnchors,
  subpathToAnchors,
  type Anchor,
} from "./penPath";

const corner = (x: number, y: number): Anchor => ({ p: { x, y }, in: null, out: null });
const smooth = (x: number, y: number, dx: number, dy: number): Anchor => ({
  p: { x, y },
  in: { x: x - dx, y: y - dy },
  out: { x: x + dx, y: y + dy },
});
const d = (anchors: Anchor[], closed: boolean) =>
  serializePath([anchorsToSubpath(anchors, closed)]);

describe("nodos de la pluma", () => {
  it("sin manejadores, rectas; un cierre recto lo hace la Z", () => {
    const anchors = [corner(0, 0), corner(10, 0), corner(10, 10)];
    expect(hasCurves(anchors, true)).toBe(false);
    expect(d(anchors, false)).toBe("M0 0H10V10");
    expect(d(anchors, true)).toBe("M0 0H10V10Z");
  });

  it("un manejador basta para que el segmento sea curvo", () => {
    const anchors = [corner(0, 0), smooth(50, 0, 10, 10), corner(100, 0)];
    expect(hasCurves(anchors, false)).toBe(true);
    expect(d(anchors, false)).toBe("M0 0S40-10 50 0s50 0 50 0");
  });

  it("los manejadores de los extremos solo cuentan si el trazado se cierra", () => {
    const anchors = [smooth(0, 0, 10, 0), corner(50, 0), smooth(50, 50, 0, 10)];
    // El que llega al primero y el que sale del último no dibujan nada abierto.
    const open: Anchor[] = [
      { p: { x: 0, y: 0 }, in: { x: -10, y: 0 }, out: null },
      corner(50, 0),
      { p: { x: 50, y: 50 }, in: null, out: { x: 50, y: 60 } },
    ];
    expect(hasCurves(open, false)).toBe(false);
    expect(hasCurves(open, true)).toBe(true);
    // Cerrado con un cierre curvo: una cúbica de vuelta al inicio y la Z.
    expect(d(anchors, true)).toBe("M0 0C10 0 50 0 50 0s0 40 0 50S-10 0 0 0Z");
  });

  it("lee los nodos de un subtrazado, con cuadráticas y arcos como cúbicas", () => {
    const [subpath] = parsePath("M0 0L10 0C20 0 30 10 30 20Q30 40 10 40").data;
    if (!subpath) throw new Error("Sin subtrazado");
    const anchors = subpathToAnchors(subpath);
    expect(anchors.map((a) => a.p)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 30, y: 20 },
      { x: 10, y: 40 },
    ]);
    expect(anchors[1]?.out).toEqual({ x: 20, y: 0 });
    expect(anchors[2]?.in).toEqual({ x: 30, y: 10 });
    // Leer y volver a escribir dibuja lo mismo.
    expect(d(anchors, false)).toBe("M0 0H10C20 0 30 10 30 20c0 13.333-6.667 20-20 20");

    const [arc] = parsePath("M0 0A10 10 0 0 1 20 0").data;
    if (!arc) throw new Error("Sin arco");
    expect(subpathToAnchors(arc)).toHaveLength(3);
  });

  it("al revés, los manejadores que llegaban salen", () => {
    const anchors = [corner(0, 0), smooth(50, 0, 10, 10), corner(100, 0)];
    const reversed = reverseAnchors(anchors);
    expect(reversed.map((a) => a.p.x)).toEqual([100, 50, 0]);
    expect(reversed[1]?.out).toEqual({ x: 40, y: -10 });
    expect(reverseAnchors(reversed)).toEqual(anchors);
  });

  it("una polilínea es un subtrazado de rectas", () => {
    expect(
      serializePath(
        polylineSubpath([
          { x: 0, y: 0 },
          { x: 10, y: 5 },
        ]),
      ),
    ).toBe("M0 0L10 5");
    expect(polylineSubpath([])).toEqual([]);
  });
});
