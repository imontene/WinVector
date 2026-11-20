import { describe, expect, it } from "vitest";
import { writePolygon } from "./polygons";
import { applyShape, readShape } from "./shapeProperties";

const SVG_NS = "http://www.w3.org/2000/svg";

function shape(markup: string): Element {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.innerHTML = markup;
  document.body.append(svg);
  const element = svg.firstElementChild;
  if (!element) throw new Error("Sin elemento");
  return element;
}

describe("propiedades de las formas", () => {
  it("lee las de cada tipo y nada de lo demás", () => {
    expect(readShape(shape('<rect x="1" y="2" width="30" height="20" rx="4"/>'))).toEqual({
      type: "rect",
      x: 1,
      y: 2,
      width: 30,
      height: 20,
      cornerRadius: 4,
    });
    expect(readShape(shape('<ellipse cx="5" cy="6" rx="7" ry="8"/>'))).toEqual({
      type: "ellipse",
      cx: 5,
      cy: 6,
      rx: 7,
      ry: 8,
    });
    expect(readShape(shape('<circle cx="5" cy="6" r="7"/>'))).toEqual({
      type: "circle",
      cx: 5,
      cy: 6,
      r: 7,
    });
    expect(readShape(shape('<line x1="1" y1="2" x2="3" y2="4"/>'))).toEqual({
      type: "line",
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
    });
    expect(readShape(shape('<path d="M0 0L10 10"/>'))).toBeNull();
    expect(readShape(shape('<polygon points="0,0 10,0 5,8"/>'))).toBeNull();
  });

  it("el radio de las esquinas es el de ry si no hay rx, y no pasa de la mitad del lado", () => {
    expect(readShape(shape('<rect width="30" height="20" ry="6"/>'))?.cornerRadius).toBe(6);
    expect(readShape(shape('<rect width="30" height="20" rx="50"/>'))?.cornerRadius).toBe(10);
  });

  it("cambia solo lo indicado e ignora lo que no vale", () => {
    const rect = shape('<rect x="1" y="2" width="30" height="20"/>');
    applyShape(rect, { width: 40, height: 0, cornerRadius: 5, r: 3 });
    expect(rect.getAttribute("width")).toBe("40");
    expect(rect.getAttribute("height")).toBe("20");
    expect([rect.getAttribute("rx"), rect.getAttribute("ry")]).toEqual(["5", "5"]);
    expect(rect.hasAttribute("r")).toBe(false);
    applyShape(rect, { cornerRadius: 0 });
    expect(rect.hasAttribute("rx")).toBe(false);
  });

  it("una estrella cambia sus puntas y, con redondeo, pasa a trazado", () => {
    const star = shape('<polygon id="s" fill="gold"/>');
    writePolygon(star, {
      kind: "star",
      sides: 5,
      inner: 0.5,
      cx: 50,
      cy: 50,
      r: 20,
      rotation: -90,
      rounding: 0,
    });
    expect(readShape(star)).toMatchObject({ type: "star", sides: 5, inner: 0.5 });
    expect(applyShape(star, { sides: 8 })).toBe(star);
    expect(star.getAttribute("points")?.split(" ")).toHaveLength(16);

    const rounded = applyShape(star, { rounding: 0.3 });
    expect(rounded.localName).toBe("path");
    expect(rounded.getAttribute("id")).toBe("s");
    expect(readShape(rounded)).toMatchObject({ type: "star", sides: 8, rounding: 0.3 });
  });
});
