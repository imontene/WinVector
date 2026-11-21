import { afterEach, describe, expect, it } from "vitest";
import { combinePaths, separatePath } from "./combine";

const SVG_NS = "http://www.w3.org/2000/svg";

let svg: SVGSVGElement | null = null;

function draw(markup: string): SVGSVGElement {
  const container = document.createElement("div");
  container.innerHTML = `<svg xmlns="${SVG_NS}" width="200" height="200" viewBox="0 0 200 200">${markup}</svg>`;
  document.body.append(container);
  const root = container.querySelector("svg");
  if (!root) throw new Error("Sin svg");
  svg = root;
  return root;
}

afterEach(() => {
  svg?.parentElement?.remove();
  svg = null;
});

const inFill = (element: Element, x: number, y: number) => {
  const point = new DOMPoint(x, y);
  return (element as SVGGeometryElement).isPointInFill(point);
};

describe("combinar y separar trazados", () => {
  it("dos formas combinadas con evenodd hacen un agujero; separarlas las devuelve", () => {
    const root = draw(`
      <circle id="fuera" cx="100" cy="100" r="80" fill="#3a7bd5"/>
      <rect id="dentro" x="80" y="80" width="40" height="40" fill="red"/>
    `);
    const items = [...root.children];
    const combined = combinePaths(items, root);
    if (!combined) throw new Error("No se combinaron");
    expect(root.children).toHaveLength(1);
    expect(combined).toMatchObject({ localName: "path", id: "fuera" });
    expect(combined.getAttribute("fill")).toBe("#3a7bd5");
    // Con evenodd, el cuadrado de dentro es un agujero sea cual sea la dirección de cada forma.
    combined.setAttribute("fill-rule", "evenodd");
    expect(inFill(combined, 100, 100)).toBe(false);
    expect(inFill(combined, 40, 100)).toBe(true);

    const pieces = separatePath(combined);
    expect(pieces).toHaveLength(2);
    expect(root.children).toHaveLength(2);
    expect(pieces?.map((p) => p.id)).toEqual(["fuera", ""]);
    expect(pieces?.every((p) => p.getAttribute("fill-rule") === "evenodd")).toBe(true);
    const [, inner] = pieces ?? [];
    if (!inner) throw new Error("Sin el de dentro");
    expect(inFill(inner, 100, 100)).toBe(true);
    expect(inFill(inner, 40, 100)).toBe(false);
  });

  it("cada forma se combina en su sitio aunque tenga otra transformación", () => {
    const root = draw(`
      <path d="M0 0H50V50H0Z" transform="translate(10 10)"/>
      <g transform="translate(100 0) scale(2)"><rect x="0" y="0" width="20" height="20"/></g>
    `);
    const path = root.querySelector("path");
    const rect = root.querySelector("rect");
    if (!path || !rect) throw new Error("Faltan formas");
    const combined = combinePaths([rect, path], root);
    if (!combined) throw new Error("No se combinaron");
    // El resultado está en las coordenadas del trazado (translate(10 10)).
    expect(combined.getAttribute("transform")).toBe("translate(10 10)");
    const box = (combined as SVGGraphicsElement).getBBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([0, -10, 130, 60]);
    expect(root.querySelector("rect")).toBeNull();
  });

  it("sin dos formas no se combina nada; un solo subtrazado no se separa", () => {
    const root = draw(`<path d="M0 0H10V10Z"/><text>hola</text>`);
    expect(combinePaths([...root.children], root)).toBeNull();
    const path = root.querySelector("path");
    if (!path) throw new Error("Sin trazado");
    expect(separatePath(path)).toBeNull();
  });
});
