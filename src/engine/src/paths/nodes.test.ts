import { describe, expect, it } from "vitest";
import { moveHandle, moveNodes, nodeKey, nodeKind, oppositeHandle, pathNodes } from "./nodes";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

const parse = (d: string) => parsePath(d).data;

describe("nodos de un trazado", () => {
  it("son el inicio y el final de cada segmento, con sus manejadores", () => {
    const nodes = pathNodes(parse("M0 0C0 10 10 10 10 0L20 0Q25 10 30 0"));
    expect(
      nodes.map((n) => [n.index, n.point, n.handles.map((h) => `${String(h.segment)}${h.kind}`)]),
    ).toEqual([
      [0, { x: 0, y: 0 }, ["0c1"]],
      [1, { x: 10, y: 0 }, ["0c2"]],
      [2, { x: 20, y: 0 }, ["2c"]],
      [3, { x: 30, y: 0 }, []],
    ]);
  });

  it("en un subtrazado cerrado que vuelve al inicio, el último final es el primer nodo", () => {
    const nodes = pathNodes(parse("M0 0C5 -5 15 -5 20 0C15 5 5 5 0 0Z"));
    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.handles.map((h) => `${String(h.segment)}${h.kind}`)).toEqual(["1c2", "0c1"]);
    // Sin volver al inicio, la recta de cierre es aparte y el último final es otro nodo.
    expect(pathNodes(parse("M0 0L10 0L10 10Z"))).toHaveLength(3);
  });
});

describe("mover nodos", () => {
  it("mueve el nodo con sus manejadores", () => {
    const data = parse("M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0");
    const moved = moveNodes(data, new Set([nodeKey({ subpath: 0, index: 1 })]), 5, 5);
    expect(serializePath(moved)).toBe("M0 0C0 10 15 15 15 5s5-15 5-5");
  });

  it("mover el inicio de un subtrazado cerrado fundido mueve también el final del último segmento", () => {
    const moved = moveNodes(parse("M0 0C5 -5 15 -5 20 0C15 5 5 5 0 0Z"), new Set(["0:0"]), 1, 0);
    expect(serializePath(moved)).toBe("M1 0C6-5 15-5 20 0 15 5 6 5 1 0Z");
  });
});

describe("mover manejadores", () => {
  const smooth = "M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0";

  it("sabe si un nodo es esquina, suave o simétrico", () => {
    expect(nodeKind(parse(smooth), { subpath: 0, index: 1 })).toBe("symmetric");
    expect(
      nodeKind(parse("M0 0C0 10 10 10 10 0C10 -20 20 -10 20 0"), { subpath: 0, index: 1 }),
    ).toBe("smooth");
    expect(nodeKind(parse("M0 0C0 10 10 10 10 0C20 0 20 -10 20 0"), { subpath: 0, index: 1 })).toBe(
      "corner",
    );
    expect(nodeKind(parse(smooth), { subpath: 0, index: 0 })).toBe("corner");
  });

  it("en un nodo de esquina solo se mueve ese manejador", () => {
    const data = parse(smooth);
    const handle = { subpath: 0, segment: 0, kind: "c2" as const };
    expect(serializePath(moveHandle(data, handle, { x: 5, y: 5 }, "corner"))).toBe(
      "M0 0C0 10 5 5 10 0 10-10 20-10 20 0",
    );
  });

  it("en un nodo simétrico, el otro queda como su reflejo; en uno suave, alineado con su longitud", () => {
    const data = parse(smooth);
    const handle = { subpath: 0, segment: 0, kind: "c2" as const };
    expect(oppositeHandle(data, handle)).toEqual({ subpath: 0, segment: 1, kind: "c1" });
    expect(serializePath(moveHandle(data, handle, { x: 0, y: 0 }, "symmetric"))).toBe(
      "M0 0C0 10 0 0 10 0S20-10 20 0",
    );
    const smoothData = parse("M0 0C0 10 10 10 10 0C10 -20 20 -10 20 0");
    const moved = moveHandle(smoothData, handle, { x: 10, y: 5 }, "smooth");
    // El opuesto conserva su longitud (20) y queda en la misma recta, al otro lado.
    expect(serializePath(moved)).toBe("M0 0C0 10 10 5 10 0 10-20 20-10 20 0");
  });
});
