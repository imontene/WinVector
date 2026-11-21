import { describe, expect, it } from "vitest";
import { pointAt } from "./curves";
import { insertNode } from "./nodeEdit";
import { parsePath } from "./parse";
import { effectiveRadii, remapRadii, roundCorners, roundPolygon } from "./round";
import { serializePath } from "./serialize";

const parse = (d: string) => parsePath(d).data;
const radii = (entries: Record<string, number>) => new Map(Object.entries(entries));
const round = (d: string, entries: Record<string, number>) =>
  serializePath(roundCorners(parse(d), radii(entries)));

describe("redondear esquinas", () => {
  it("una esquina de un cuadrado es un arco tangente del radio pedido", () => {
    expect(round("M0 0H10V10H0Z", { "0:1": 3 })).toBe("M0 0H7a3 3 0 0 1 3 3v7H0Z");
    // Todos los puntos del arco están a 3 de su centro, (7, 3).
    const arc = roundCorners(parse("M0 0H10V10H0Z"), radii({ "0:1": 3 }))[0]?.segments[1];
    expect(arc?.kind).toBe("arc");
    if (!arc) return;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = pointAt({ x: 7, y: 0 }, arc, t);
      expect(Math.hypot(p.x - 7, p.y - 3)).toBeCloseTo(3, 9);
    }
  });

  it("cada vértice tiene su propio radio; el primero de uno cerrado también", () => {
    expect(round("M0 0H10V10H0Z", { "0:0": 2, "0:2": 4 })).toBe(
      "M2 0h8V6a4 4 0 0 1-4 4H0V2A2 2 0 0 1 2 0Z",
    );
  });

  it("si no cabe, el radio se reduce; dos arcos en un lado se reducen igual", () => {
    const data = parse("M0 0H10V10H0Z");
    expect(effectiveRadii(data, radii({ "0:1": 30 })).get("0:1")).toBeCloseTo(10);
    const both = effectiveRadii(data, radii({ "0:1": 8, "0:2": 8 }));
    expect(both.get("0:1")).toBeCloseTo(5);
    expect(both.get("0:2")).toBeCloseTo(5);
  });

  it("una esquina hacia dentro gira al revés", () => {
    // Una L: la esquina de (10,10) gira en sentido contrario a las demás.
    const rounded = roundCorners(parse("M0 0H20V10H10V20H0Z"), radii({ "0:1": 2, "0:3": 2 }));
    const sweeps = rounded[0]?.segments.flatMap((s) => (s.kind === "arc" ? [s.sweep] : []));
    expect(sweeps).toEqual([true, false]);
  });

  it("solo redondea esquinas entre dos rectas, y no los extremos de un trazado abierto", () => {
    expect(round("M0 0H10V10", { "0:0": 3, "0:2": 3 })).toBe("M0 0H10V10");
    expect(round("M0 0H10C10 5 5 10 0 10", { "0:1": 3 })).toBe("M0 0H10C10 5 5 10 0 10");
    expect(round("M0 0H10V10", { "0:1": 3 })).toBe("M0 0H7a3 3 0 0 1 3 3v7");
  });

  it("un polígono redondeado en proporción tiene arcos en todas sus esquinas", () => {
    const [subpath] = roundPolygon(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
      ],
      0.5,
    );
    expect(subpath?.segments.filter((s) => s.kind === "arc")).toHaveLength(3);
    expect(subpath?.closed).toBe(true);
  });

  it("los radios siguen a sus nodos cuando cambia su numeración", () => {
    const before = parse("M0 0H10V10H0Z");
    const { data: after } = insertNode(before, { subpath: 0, segment: 0, t: 0.5 });
    expect([...remapRadii(before, after, radii({ "0:1": 3, "0:3": 1 }))]).toEqual([
      ["0:2", 3],
      ["0:4", 1],
    ]);
  });
});
