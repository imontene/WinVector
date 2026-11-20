import { describe, expect, it } from "vitest";
import { convertToPath, shapePathData } from "./convert";

const SVG_NS = "http://www.w3.org/2000/svg";

function shape(markup: string): Element {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.innerHTML = markup;
  document.body.append(svg);
  const element = svg.firstElementChild;
  if (!element) throw new Error("Sin elemento");
  return element;
}

describe("convertir en trazado", () => {
  it("da el d de cada forma", () => {
    expect(shapePathData(shape('<rect x="1" y="2" width="10" height="5"/>'))).toBe("M1 2H11V7H1Z");
    expect(shapePathData(shape('<rect width="10" height="6" rx="2"/>'))).toBe(
      "M2 0H8A2 2 0 0 1 10 2V4A2 2 0 0 1 8 6H2A2 2 0 0 1 0 4V2A2 2 0 0 1 2 0Z",
    );
    expect(shapePathData(shape('<circle cx="5" cy="5" r="3"/>'))).toBe(
      "M2 5A3 3 0 1 0 8 5A3 3 0 1 0 2 5Z",
    );
    expect(shapePathData(shape('<ellipse cx="5" cy="5" rx="4" ry="2"/>'))).toBe(
      "M1 5A4 2 0 1 0 9 5A4 2 0 1 0 1 5Z",
    );
    expect(shapePathData(shape('<line x1="0" y1="1" x2="3" y2="4"/>'))).toBe("M0 1L3 4");
    expect(shapePathData(shape('<polygon points="0,0 4,0 2,3"/>'))).toBe("M0 0L4 0L2 3Z");
    expect(shapePathData(shape('<polyline points="0,0 4,0 2,3"/>'))).toBe("M0 0L4 0L2 3");
    expect(shapePathData(shape('<rect width="0" height="5"/>'))).toBeNull();
    expect(shapePathData(shape("<g/>"))).toBeNull();
  });

  it("con rx solo, el radio vertical es el mismo, y no pasa de la mitad del lado", () => {
    expect(shapePathData(shape('<rect width="10" height="4" rx="5"/>'))).toBe(
      "M5 0H5A5 2 0 0 1 10 2V2A5 2 0 0 1 5 4H5A5 2 0 0 1 0 2V2A5 2 0 0 1 5 0Z",
    );
  });

  it("conserva los demás atributos, en su orden, y los hijos", () => {
    const rect = shape(
      '<rect id="r" class="a" x="1" y="2" width="10" height="5" fill="red" transform="rotate(5)" data-x="1"><title>Caja</title></rect>',
    );
    const parent = rect.parentNode;
    const path = convertToPath(rect);
    expect(path?.parentNode).toBe(parent);
    expect(rect.isConnected).toBe(false);
    expect([...(path?.attributes ?? [])].map((a) => a.name)).toEqual([
      "id",
      "class",
      "d",
      "fill",
      "transform",
      "data-x",
    ]);
    expect(path?.querySelector("title")?.textContent).toBe("Caja");
  });

  it("quita los parámetros de los polígonos de WinVector", () => {
    const star = shape(
      '<polygon points="0,0 4,0 2,3" data-winvector-shape="star" data-winvector-sides="5" fill="gold"/>',
    );
    const path = convertToPath(star);
    expect(path?.getAttribute("data-winvector-shape")).toBeNull();
    expect(path?.getAttribute("fill")).toBe("gold");
    // Un trazado redondeado de WinVector solo pierde los parámetros.
    const rounded = shape('<path d="M0 0Z" data-winvector-shape="star" data-winvector-sides="5"/>');
    expect(convertToPath(rounded)).toBe(rounded);
    expect(rounded.hasAttribute("data-winvector-sides")).toBe(false);
    expect(convertToPath(shape('<path d="M0 0Z"/>'))).toBeNull();
  });
});
