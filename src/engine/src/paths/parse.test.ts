import { describe, expect, it } from "vitest";
import type { PathData } from "./model";
import { parsePath } from "./parse";

const parse = (d: string) => {
  const { data, error } = parsePath(d);
  expect(error).toBeNull();
  return data;
};

describe("analizador de d", () => {
  it("lee rectas absolutas y relativas, H y V", () => {
    expect(parse("M10 20 L30 40 l5 5 H0 h3 V1 v-1 Z")).toEqual<PathData>([
      {
        start: { x: 10, y: 20 },
        closed: true,
        segments: [
          { kind: "line", to: { x: 30, y: 40 } },
          { kind: "line", to: { x: 35, y: 45 } },
          { kind: "line", to: { x: 0, y: 45 } },
          { kind: "line", to: { x: 3, y: 45 } },
          { kind: "line", to: { x: 3, y: 1 } },
          { kind: "line", to: { x: 3, y: 0 } },
        ],
      },
    ]);
  });

  it("los pares tras M son rectas, y tras m, rectas relativas", () => {
    expect(parse("M0 0 10 0 10 10")[0]?.segments).toHaveLength(2);
    expect(parse("m5 5 10 0 0 10")[0]).toEqual({
      start: { x: 5, y: 5 },
      closed: false,
      segments: [
        { kind: "line", to: { x: 15, y: 5 } },
        { kind: "line", to: { x: 15, y: 15 } },
      ],
    });
  });

  it("lee cúbicas y cuadráticas, y resuelve S y T reflejando el control anterior", () => {
    const [path] = parse("M0 0C0 10 10 10 10 0S20-10 20 0Q25 10 30 0T40 0s5 5 5 0");
    expect(path?.segments).toEqual([
      { kind: "cubic", c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
      { kind: "cubic", c1: { x: 10, y: -10 }, c2: { x: 20, y: -10 }, to: { x: 20, y: 0 } },
      { kind: "quad", c: { x: 25, y: 10 }, to: { x: 30, y: 0 } },
      { kind: "quad", c: { x: 35, y: -10 }, to: { x: 40, y: 0 } },
      // S tras una cuadrática: el primer control es el punto actual.
      { kind: "cubic", c1: { x: 40, y: 0 }, c2: { x: 45, y: 5 }, to: { x: 45, y: 0 } },
    ]);
  });

  it("lee arcos con banderas sin separador y radios negativos", () => {
    const [path] = parse("M0 0a5-5 30 1110 10A5,5,0,0,0,0,0");
    expect(path?.segments).toEqual([
      { kind: "arc", rx: 5, ry: 5, rotation: 30, large: true, sweep: true, to: { x: 10, y: 10 } },
      { kind: "arc", rx: 5, ry: 5, rotation: 0, large: false, sweep: false, to: { x: 0, y: 0 } },
    ]);
  });

  it("lee números pegados, con punto inicial, signo y exponente", () => {
    expect(parse("M.5.5-1e1+2E-1L1.5.25")[0]).toEqual({
      start: { x: 0.5, y: 0.5 },
      closed: false,
      segments: [
        { kind: "line", to: { x: -10, y: 0.2 } },
        { kind: "line", to: { x: 1.5, y: 0.25 } },
      ],
    });
  });

  it("tras Z, un comando de dibujo empieza otro subtrazado en el mismo punto inicial", () => {
    const data = parse("M10 10 h5 v5 z l5 0 M0 0 L1 1");
    expect(data.map((s) => [s.start, s.closed, s.segments.length])).toEqual([
      [{ x: 10, y: 10 }, true, 2],
      [{ x: 10, y: 10 }, false, 1],
      [{ x: 0, y: 0 }, false, 1],
    ]);
    // Tras z, las coordenadas relativas parten del punto inicial.
    expect(data[1]?.segments[0]?.to).toEqual({ x: 15, y: 10 });
  });

  it("acepta saltos de línea, tabuladores y comas entre números", () => {
    expect(parse("M 1,2\n\tL\r\n3 , 4")[0]?.segments[0]?.to).toEqual({ x: 3, y: 4 });
  });

  it("un m inicial es absoluto y un M sin más es un subtrazado vacío", () => {
    expect(parse("m10 10")).toEqual([{ start: { x: 10, y: 10 }, closed: false, segments: [] }]);
    expect(parse("")).toEqual([]);
  });

  it("ante un error se queda con lo leído hasta el último segmento completo", () => {
    const broken = parsePath("M0 0 L10 10 L20");
    expect(broken.data[0]?.segments).toHaveLength(1);
    expect(broken.error?.index).toBe(15);

    expect(parsePath("L10 10").data).toEqual([]);
    expect(parsePath("L10 10").error?.message).toMatch(/empezar con M/);
    expect(parsePath("M0 0 Z 5 5").error).not.toBeNull();
    expect(parsePath("M0 0 A5 5 0 2 0 10 10").error?.message).toMatch(/bandera/);
    expect(parsePath("M0 0 L1e 2").error?.message).toMatch(/Exponente/);
    expect(parsePath("M0 0 X1 1").data[0]?.segments).toHaveLength(0);
    expect(parsePath("M,0 0").error).not.toBeNull();
  });
});
