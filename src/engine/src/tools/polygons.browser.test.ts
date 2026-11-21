import { describe, expect, it } from "vitest";
import {
  forgetPolygon,
  polygonVertices,
  readPolygon,
  roundedPath,
  updatePolygon,
  writePolygon,
  type PolygonParams,
} from "./polygons";

const SVG_NS = "http://www.w3.org/2000/svg";

const HEXAGON: PolygonParams = {
  kind: "polygon",
  sides: 6,
  inner: 0.5,
  cx: 50,
  cy: 50,
  r: 10,
  rotation: 0,
  rounding: 0,
};

function polygon(): SVGPolygonElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const element = document.createElementNS(SVG_NS, "polygon");
  element.setAttribute("id", "p");
  element.setAttribute("fill", "red");
  svg.append(element);
  return element;
}

describe("polígonos y estrellas", () => {
  it("un polígono tiene un vértice por lado, todos a la misma distancia del centro", () => {
    const vertices = polygonVertices(HEXAGON);
    expect(vertices).toHaveLength(6);
    for (const v of vertices) expect(Math.hypot(v.x - 50, v.y - 50)).toBeCloseTo(10);
    expect(vertices[0]?.x).toBeCloseTo(60);
    expect(vertices[0]?.y).toBeCloseTo(50);
  });

  it("una estrella alterna puntas y valles", () => {
    const vertices = polygonVertices({
      ...HEXAGON,
      kind: "star",
      sides: 5,
      inner: 0.4,
      rotation: -90,
    });
    expect(vertices).toHaveLength(10);
    const distances = vertices.map((v) => Math.hypot(v.x - 50, v.y - 50));
    distances.forEach((d, i) => {
      expect(d).toBeCloseTo(i % 2 === 0 ? 10 : 4);
    });
    // La primera punta, hacia arriba.
    expect(vertices[0]?.x).toBeCloseTo(50);
    expect(vertices[0]?.y).toBeCloseTo(40);
  });

  it("se guarda con sus parámetros y se vuelve a leer", () => {
    const element = polygon();
    const star = { ...HEXAGON, kind: "star" as const, sides: 5, inner: 0.38, rotation: -90 };
    writePolygon(element, star);
    expect(element.getAttribute("points")?.split(" ")).toHaveLength(10);
    expect(element.getAttribute("data-winvector-shape")).toBe("star");
    expect(readPolygon(element)).toEqual(star);
  });

  it("sin parámetros es un polígono normal", () => {
    const element = polygon();
    element.setAttribute("points", "0,0 10,0 5,8");
    expect(readPolygon(element)).toBeNull();
    writePolygon(element, HEXAGON);
    forgetPolygon(element);
    expect(readPolygon(element)).toBeNull();
    expect([...element.attributes].map((a) => a.name)).toEqual(["id", "fill", "points"]);
  });

  it("cambiar los lados rehace la forma", () => {
    const element = polygon();
    writePolygon(element, HEXAGON);
    expect(updatePolygon(element, { sides: 3 })).toBe(element);
    expect(element.getAttribute("points")?.split(" ")).toHaveLength(3);
    // Fuera de los límites, se ajusta.
    updatePolygon(element, { sides: 1 });
    expect(readPolygon(element)?.sides).toBe(3);
  });

  it("con redondeo pasa a ser un trazado con los mismos atributos, y vuelve a polígono", () => {
    const element = polygon();
    writePolygon(element, HEXAGON);
    const rounded = updatePolygon(element, { rounding: 0.5 });
    if (!rounded) throw new Error("Sin parámetros");
    expect(rounded.localName).toBe("path");
    expect(element.isConnected).toBe(false);
    expect(rounded.getAttribute("id")).toBe("p");
    expect(rounded.getAttribute("fill")).toBe("red");
    expect(rounded.getAttribute("points")).toBeNull();
    expect(rounded.getAttribute("d")).toMatch(/^M.*a.*Z$/);
    expect(readPolygon(rounded)?.rounding).toBe(0.5);

    const back = updatePolygon(rounded, { rounding: 0 });
    expect(back?.localName).toBe("polygon");
    expect(back?.getAttribute("d")).toBeNull();
  });

  it("el redondeo son arcos exactos que llegan como mucho hasta la mitad del lado", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(roundedPath(square, 1)).toBe(
      // Un cuadrado redondeado del todo es un círculo de cuatro arcos.
      "M5 0a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5Z",
    );
    expect(roundedPath(square, 0.2)).toBe(
      "M1 0H9a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H1A1 1 0 0 1 0 9V1A1 1 0 0 1 1 0Z",
    );
  });
});
