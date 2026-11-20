import { describe, expect, it } from "vitest";
import {
  displayVertices,
  insertVertex,
  readVertices,
  removeVertices,
  segmentAt,
  toEditablePolygon,
  vertexEditKind,
  writeVertices,
} from "./vertices";

const SVG_NS = "http://www.w3.org/2000/svg";

function shape(markup: string): Element {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.innerHTML = markup;
  document.body.append(svg);
  const element = svg.firstElementChild;
  if (!element) throw new Error("Sin elemento");
  return element;
}

describe("vértices", () => {
  it("sabe qué formas se editan por vértices", () => {
    expect(vertexEditKind(shape('<polygon points="0,0 1,0 0,1"/>'))).toBe("direct");
    expect(vertexEditKind(shape('<polyline points="0,0 1,0"/>'))).toBe("direct");
    expect(vertexEditKind(shape('<line x2="1"/>'))).toBe("direct");
    expect(vertexEditKind(shape('<rect width="1" height="1"/>'))).toBe("rect");
    expect(
      vertexEditKind(
        shape(
          '<polygon points="0,0 1,0 0,1" data-winvector-shape="star" data-winvector-sides="5" data-winvector-cx="0" data-winvector-cy="0" data-winvector-r="1"/>',
        ),
      ),
    ).toBe("star");
    expect(vertexEditKind(shape('<circle r="1"/>'))).toBeNull();
    expect(vertexEditKind(shape('<path d="M0 0L1 1"/>'))).toBeNull();
  });

  it("lee y escribe los de polígonos, polilíneas y líneas", () => {
    const polygon = shape('<polygon points="0,0 10,0 5,8"/>');
    expect(readVertices(polygon)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
      ],
      closed: true,
      minimum: 3,
      resizable: true,
    });
    writeVertices(polygon, [
      { x: 1.234, y: 0 },
      { x: 10, y: 0.5 },
      { x: 5, y: 8 },
    ]);
    expect(polygon.getAttribute("points")).toBe("1.23,0 10,0.5 5,8");
    const line = shape('<line x1="1" y1="2" x2="3" y2="4"/>');
    expect(readVertices(line)).toMatchObject({ closed: false, minimum: 2, resizable: false });
    writeVertices(line, [
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ]);
    expect([...line.attributes].map((a) => `${a.name}=${a.value}`)).toEqual([
      "x1=5",
      "y1=6",
      "x2=7",
      "y2=8",
    ]);
  });

  it("un rectángulo pasa a polígono con sus esquinas y sus atributos", () => {
    const rect = shape(
      '<rect id="r" x="1" y="2" width="10" height="5" rx="2" fill="red"><title>T</title></rect>',
    );
    expect(displayVertices(rect)?.points).toHaveLength(4);
    const polygon = toEditablePolygon(rect);
    expect(polygon?.localName).toBe("polygon");
    expect([...(polygon?.attributes ?? [])].map((a) => a.name)).toEqual(["id", "points", "fill"]);
    expect(polygon?.getAttribute("points")).toBe("1,2 11,2 11,7 1,7");
    expect(polygon?.querySelector("title")).not.toBeNull();
  });

  it("una estrella pierde sus parámetros", () => {
    const star = shape(
      '<polygon points="0,0 1,0 0,1" data-winvector-shape="star" data-winvector-sides="5" data-winvector-cx="0" data-winvector-cy="0" data-winvector-r="1"/>',
    );
    expect(toEditablePolygon(star)).toBe(star);
    expect(star.hasAttribute("data-winvector-shape")).toBe(false);
  });

  it("encuentra el segmento cercano, inserta y quita sin bajar del mínimo", () => {
    const vertices = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: true,
      minimum: 3,
      resizable: true,
    };
    expect(segmentAt(vertices, { x: 5, y: 1 }, 2)).toEqual({ index: 0, point: { x: 5, y: 0 } });
    // El segmento de cierre, del último al primero.
    expect(segmentAt(vertices, { x: 4, y: 5 }, 2)?.index).toBe(2);
    expect(segmentAt(vertices, { x: 7, y: 3 }, 1)).toBeNull();
    expect(insertVertex(vertices.points, 0, { x: 5, y: 0 })).toHaveLength(4);
    expect(removeVertices(vertices, new Set([0]))).toBeNull();
    expect(
      removeVertices({ ...vertices, points: [...vertices.points, { x: 0, y: 10 }] }, new Set([1])),
    ).toHaveLength(3);
  });
});
