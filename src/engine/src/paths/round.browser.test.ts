import { describe, expect, it } from "vitest";
import { parsePath } from "./parse";
import { CORNER_RADII, UNROUNDED, forgetRounding, readRounding, writeRounding } from "./round";

const SVG_NS = "http://www.w3.org/2000/svg";

const path = (d: string) => {
  const element = document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", d);
  return element;
};

describe("atributos del redondeo", () => {
  it("guarda la forma sin redondear y los radios, y se leen igual", () => {
    const element = path("M0 0H10V10H0Z");
    const source = parsePath("M0 0H10V10H0Z").data;
    writeRounding(
      element,
      source,
      new Map([
        ["0:2", 4],
        ["0:1", 2.5],
      ]),
    );
    expect(element.getAttribute("d")).toBe("M0 0H7.5A2.5 2.5 0 0 1 10 2.5V6a4 4 0 0 1-4 4H0Z");
    expect(element.getAttribute(UNROUNDED)).toBe("M0 0H10V10H0Z");
    expect(element.getAttribute(CORNER_RADII)).toBe("0:1=2.5 0:2=4");

    const read = readRounding(element);
    expect(read?.radii).toEqual(
      new Map([
        ["0:1", 2.5],
        ["0:2", 4],
      ]),
    );
    expect(read?.source).toEqual(source);
  });

  it("sin radios quita el redondeo y deja la forma original", () => {
    const element = path("M0 0H10V10H0Z");
    const source = parsePath("M0 0H10V10H0Z").data;
    writeRounding(element, source, new Map([["0:1", 3]]));
    writeRounding(element, source, new Map([["0:1", 0]]));
    expect(element.getAttribute("d")).toBe("M0 0H10V10H0Z");
    expect(element.hasAttribute(UNROUNDED)).toBe(false);
    expect(element.hasAttribute(CORNER_RADII)).toBe(false);
  });

  it("un trazado sin los atributos no está redondeado; olvidar deja los arcos", () => {
    expect(readRounding(path("M0 0H10"))).toBeNull();
    const element = path("M0 0H10V10H0Z");
    writeRounding(element, parsePath("M0 0H10V10H0Z").data, new Map([["0:1", 3]]));
    const d = element.getAttribute("d");
    forgetRounding(element);
    expect(element.getAttribute("d")).toBe(d);
    expect(readRounding(element)).toBeNull();
  });

  it("ignora radios mal escritos", () => {
    const element = path("M0 0H7a3 3 0 0 1 3 3V10H0Z");
    element.setAttribute(UNROUNDED, "M0 0H10V10H0Z");
    element.setAttribute(CORNER_RADII, "0:1=3 x=2 0:2=-1 0:3=abc");
    expect(readRounding(element)?.radii).toEqual(new Map([["0:1", 3]]));
  });
});
