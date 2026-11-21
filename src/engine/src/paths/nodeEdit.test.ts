import { describe, expect, it } from "vitest";
import type { Point } from "../geometry";
import { nearestOnPath, pointAt } from "./curves";
import type { PathData } from "./model";
import { insertNode, removeNodes, setNodeKind, setSegmentKind, summarizeNodes } from "./nodeEdit";
import { nodeKind, pathNodes } from "./nodes";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

const parse = (d: string) => parsePath(d).data;
const keys = (...list: string[]) => new Set(list);

/** Puntos repartidos por un trazado, incluidas las rectas de cierre. */
function samples(data: PathData, perSegment = 40): Point[] {
  const points: Point[] = [];
  for (const subpath of data) {
    let from = subpath.start;
    const segments = subpath.closed
      ? [...subpath.segments, { kind: "line" as const, to: subpath.start }]
      : subpath.segments;
    for (const segment of segments) {
      for (let k = 0; k <= perSegment; k++) points.push(pointAt(from, segment, k / perSegment));
      from = segment.to;
    }
  }
  return points;
}

/** Distancia máxima entre dos trazados (de Hausdorff, aproximada con puntos). */
function distance(a: PathData, b: PathData): number {
  const one = (from: PathData, to: PathData) =>
    Math.max(...samples(from).map((p) => nearestOnPath(to, p)?.distance ?? Infinity));
  return Math.max(one(a, b), one(b, a));
}

describe("añadir nodos", () => {
  it("parte el segmento sin cambiar lo que se ve y devuelve la clave del nodo nuevo", () => {
    const data = parse("M0 0C0 40 60 40 60 0L60 -30");
    const { data: added, selected } = insertNode(data, { subpath: 0, segment: 0, t: 0.3 });
    expect(pathNodes(added)).toHaveLength(4);
    expect(selected).toEqual(["0:1"]);
    expect(distance(data, added)).toBeLessThan(1e-6);
  });
});

describe("quitar nodos", () => {
  it("quitar el nodo que se acaba de añadir devuelve la curva original", () => {
    const data = parse("M0 0C0 40 60 40 60 0");
    for (const t of [0.2, 0.5, 0.8]) {
      const { data: added } = insertNode(data, { subpath: 0, segment: 0, t });
      const removed = removeNodes(added, keys("0:1"));
      expect(removed).not.toBeNull();
      if (!removed) return;
      expect(pathNodes(removed)).toHaveLength(2);
      expect(distance(data, removed)).toBeLessThan(0.05);
    }
  });

  it("conserva la forma entre curvas y deja suaves los nodos vecinos", () => {
    // Un cuarto de círculo en tres trozos: al quitar los dos del medio queda una sola cúbica.
    const data = parse("M100 0A100 100 0 0 1 0 100");
    const { data: pieces } = setSegmentKind(data, keys("0:0", "0:1"), "curve");
    const split = insertNode(insertNode(pieces, { subpath: 0, segment: 0, t: 0.3 }).data, {
      subpath: 0,
      segment: 1,
      t: 0.6,
    }).data;
    expect(pathNodes(split)).toHaveLength(4);
    const removed = removeNodes(split, keys("0:1", "0:2"));
    if (!removed) throw new Error("No queda nada");
    expect(removed[0]?.segments).toHaveLength(1);
    expect(distance(data, removed)).toBeLessThan(0.1);
  });

  it("entre rectas queda una recta; en los extremos, el trazado se acorta", () => {
    expect(serializePath(removeNodes(parse("M0 0L10 10L20 0L30 10"), keys("0:1")) ?? [])).toBe(
      "M0 0H20L30 10",
    );
    expect(serializePath(removeNodes(parse("M0 0L10 10L20 0L30 10"), keys("0:0")) ?? [])).toBe(
      "M10 10L20 0 30 10",
    );
    expect(serializePath(removeNodes(parse("M0 0L10 10L20 0L30 10"), keys("0:3")) ?? [])).toBe(
      "M0 0L10 10 20 0",
    );
  });

  it("en un subtrazado cerrado se puede quitar el primer nodo", () => {
    const removed = removeNodes(parse("M0 0L10 0L10 10L0 10Z"), keys("0:0"));
    expect(serializePath(removed ?? [])).toBe("M10 0V10H0Z");
  });

  it("un subtrazado con menos de dos nodos desaparece; si no queda nada, no se quita", () => {
    const data = parse("M0 0L10 0M20 0L30 0L40 0");
    expect(serializePath(removeNodes(data, keys("0:0")) ?? [])).toBe("M20 0H30 40");
    expect(removeNodes(data, keys("0:0", "1:0", "1:1"))).toBeNull();
  });

  it("no reescribe los subtrazados que no tienen nodos quitados", () => {
    const data = parse("M0 0L10 0L10 10Z M20 0L30 0L40 0");
    const removed = removeNodes(data, keys("1:1"));
    expect(removed?.[0]).toBe(data[0]);
  });
});

describe("tipo de nodo", () => {
  it("una esquina entre rectas pasa a ser suave o simétrica con curvas", () => {
    const data = parse("M0 0L50 50L100 0");
    const smooth = setNodeKind(data, keys("0:1"), "smooth");
    expect(nodeKind(smooth.data, { subpath: 0, index: 1 })).toBe("symmetric");
    expect(smooth.selected).toEqual(["0:1"]);
    // Los manejadores quedan horizontales (la bisectriz) y en el nodo.
    const [first, second] = smooth.data[0]?.segments ?? [];
    expect(first?.kind === "cubic" && first.c2.y).toBeCloseTo(50);
    expect(second?.kind === "cubic" && second.c1.y).toBeCloseTo(50);

    const uneven = parse("M0 0L50 50L250 50");
    const kept = setNodeKind(uneven, keys("0:1"), "smooth").data;
    expect(nodeKind(kept, { subpath: 0, index: 1 })).toBe("smooth");
    const symmetric = setNodeKind(uneven, keys("0:1"), "symmetric").data;
    expect(nodeKind(symmetric, { subpath: 0, index: 1 })).toBe("symmetric");
  });

  it("esquina recoge los manejadores sobre el nodo", () => {
    const data = parse("M0 0C0 20 40 20 50 0S100 -20 100 0");
    expect(nodeKind(data, { subpath: 0, index: 1 })).toBe("symmetric");
    const corner = setNodeKind(data, keys("0:1"), "corner").data;
    expect(nodeKind(corner, { subpath: 0, index: 1 })).toBe("corner");
    expect(serializePath(corner)).toBe("M0 0C0 20 50 0 50 0s50-20 50 0");
    // Y suave los vuelve a sacar, hacia los nodos vecinos.
    const back = setNodeKind(corner, keys("0:1"), "smooth").data;
    expect(nodeKind(back, { subpath: 0, index: 1 })).not.toBe("corner");
  });

  it("un arco vecino pasa a ser curvas y los nodos seleccionados conservan su clave", () => {
    // El arco de media vuelta se parte en dos cúbicas: aparece un nodo nuevo entre el 1 y el 2.
    const data = parse("M0 0L50 0A50 50 0 0 1 150 0L200 0");
    const result = setNodeKind(data, keys("0:1", "0:2"), "smooth");
    expect(pathNodes(result.data)).toHaveLength(5);
    expect(result.selected).toEqual(["0:1", "0:3"]);
    expect(nodeKind(result.data, { subpath: 0, index: 1 })).toBe("smooth");
    expect(nodeKind(result.data, { subpath: 0, index: 3 })).toBe("smooth");
  });

  it("en un subtrazado cerrado, el primer nodo también tiene dos lados", () => {
    const data = parse("M0 0L100 0L50 80Z");
    const result = setNodeKind(data, keys("0:0"), "symmetric");
    expect(nodeKind(result.data, { subpath: 0, index: 0 })).toBe("symmetric");
  });

  it("los extremos de un subtrazado abierto no pueden ser suaves", () => {
    const data = parse("M0 0L50 50L100 0");
    expect(setNodeKind(data, keys("0:0"), "smooth").data).toEqual(data);
  });
});

describe("segmentos rectos y curvos", () => {
  it("hace curvo un segmento sin cambiar lo que se ve y recto otra vez", () => {
    const data = parse("M0 0L100 0L100 100");
    const curved = setSegmentKind(data, keys("0:0", "0:1"), "curve").data;
    expect(curved[0]?.segments[0]?.kind).toBe("cubic");
    expect(curved[0]?.segments[1]?.kind).toBe("line");
    expect(distance(data, curved)).toBeLessThan(1e-6);
    expect(serializePath(setSegmentKind(curved, keys("0:0", "0:1"), "line").data)).toBe(
      "M0 0H100V100",
    );
  });

  it("solo cambia los segmentos con sus dos nodos seleccionados, también el de cierre", () => {
    const data = parse("M0 0L100 0L100 100Z");
    const curved = setSegmentKind(data, keys("0:2", "0:0"), "curve").data;
    expect(curved[0]?.segments.map((s) => s.kind)).toEqual(["line", "line", "cubic"]);
  });
});

describe("resumen de los nodos seleccionados", () => {
  it("da el tipo común y lo que se puede hacer", () => {
    const data = parse("M0 0L50 50C60 60 90 60 100 50L150 0");
    expect(summarizeNodes(data, keys())).toEqual({
      count: 0,
      kind: null,
      canSmooth: false,
      canMakeLine: false,
      canMakeCurve: false,
    });
    expect(summarizeNodes(data, keys("0:0"))).toMatchObject({
      count: 1,
      kind: null,
      canSmooth: false,
    });
    expect(summarizeNodes(data, keys("0:1", "0:2"))).toEqual({
      count: 2,
      kind: "corner",
      canSmooth: true,
      canMakeLine: true,
      canMakeCurve: false,
    });
    const mixed = setNodeKind(data, keys("0:1"), "smooth").data;
    expect(summarizeNodes(mixed, keys("0:1", "0:2", "0:3"))).toMatchObject({
      kind: "mixed",
      canMakeCurve: true,
    });
  });
});
