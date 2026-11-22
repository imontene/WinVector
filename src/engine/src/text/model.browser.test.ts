import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_HEIGHT,
  LINE_HEIGHT_ATTRIBUTE,
  SVG_NS,
  lineHeight,
  readLines,
  textEditability,
  writeLines,
} from "./model";

const hosts: Element[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

/** Dibuja un SVG en la página y devuelve su raíz. */
function draw(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="${SVG_NS}" width="400" height="300" viewBox="0 0 400 300">${markup}</svg>`;
  document.body.append(host);
  hosts.push(host);
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("Sin svg");
  return svg;
}

const text = (markup: string) => {
  const found = draw(markup).querySelector("text");
  if (!found) throw new Error("Sin texto");
  return found;
};

/** Posición de inicio de cada carácter, para comparar lo que se ve. */
const positions = (element: SVGTextElement) =>
  Array.from({ length: element.getNumberOfChars() }, (_, i) => {
    const p = element.getStartPositionOfChar(i);
    return [p.x, p.y];
  });

describe("qué textos se editan en el lienzo", () => {
  it.each([
    ['<text x="10" y="20">Hola</text>', null],
    [
      '<text x="10" y="20"><tspan x="10" y="20">a</tspan><tspan x="10" y="40">b</tspan></text>',
      null,
    ],
    // Las líneas de Inkscape: tspan con x e y, a veces con dy, y sangría entre ellos.
    [
      '<text x="10" y="20">\n  <tspan x="10" y="20">a</tspan>\n  <tspan x="10" dy="1.2em">b</tspan>\n</text>',
      null,
    ],
    ['<path id="p" d="M0 0H100"/><text><textPath href="#p">curva</textPath></text>', "text-path"],
    ['<text x="10 20 30" y="20">abc</text>', "per-character"],
    ['<text x="10" y="20" rotate="10">abc</text>', "per-character"],
    ['<text x="10" y="20" dx="2">abc</text>', "relative-position"],
    ['<text x="10" y="20" textLength="100">abc</text>', "relative-position"],
    ['<text x="10" y="20">Hola <tspan font-weight="bold">mundo</tspan></text>', "styled-runs"],
    ['<text x="10" y="20"><tspan>a<tspan fill="red">b</tspan></tspan></text>', "styled-runs"],
    ['<text x="10" y="20"><a href="#">enlace</a></text>', "other-content"],
  ])("%s", (markup, reason) => {
    const result = textEditability(text(markup));
    expect(result).toEqual(reason === null ? { editable: true } : { editable: false, reason });
  });
});

describe("leer y escribir líneas", () => {
  it("una línea se queda sin tspan y con los espacios tal cual", () => {
    const element = text('<text x="10" y="20">Hola</text>');
    expect(readLines(element)).toEqual(["Hola"]);
    writeLines(element, ["  dos  espacios "]);
    expect(element.outerHTML).toBe(
      '<text x="10" y="20" xml:space="preserve">  dos  espacios </text>',
    );
    expect(element.getNumberOfChars()).toBe(16);
  });

  it("varias líneas son tspan con x e y absolutos, también las vacías", () => {
    const element = text('<text x="10" y="20" font-size="10">a</text>');
    writeLines(element, ["uno", "", "tres"]);
    expect(element.innerHTML).toBe(
      '<tspan x="10" y="20">uno</tspan><tspan x="10" y="32"></tspan><tspan x="10" y="44">tres</tspan>',
    );
    expect(readLines(element)).toEqual(["uno", "", "tres"]);
    expect(lineHeight(element)).toBe(DEFAULT_LINE_HEIGHT);
  });

  it("los tspan que había conservan sus atributos y los nuevos copian los del último", () => {
    const element = text(
      '<text x="10" y="20" font-size="10"><tspan id="l1" x="10" y="20" style="fill:red">a</tspan></text>',
    );
    writeLines(element, ["a", "b"]);
    const [first, second] = [...element.children];
    expect(first?.id).toBe("l1");
    expect(second?.id).toBe("");
    expect(second?.getAttribute("style")).toBe("fill:red");
    // Una sola línea en un texto que ya tenía tspan sigue en su tspan.
    writeLines(element, ["solo"]);
    expect(element.innerHTML).toBe('<tspan id="l1" x="10" y="20" style="fill:red">solo</tspan>');
  });

  it("las líneas que bajaban con dy quedan con su y absoluta y se ven igual", () => {
    const element = text(
      '<text x="10" y="20" font-size="10"><tspan x="10" y="20">a</tspan><tspan x="10" dy="15">b</tspan></text>',
    );
    expect(lineHeight(element)).toBe(1.5);
    const before = positions(element);
    writeLines(element, readLines(element));
    expect(element.innerHTML).toBe('<tspan x="10" y="20">a</tspan><tspan x="10" y="35">b</tspan>');
    expect(positions(element)).toEqual(before);
  });

  it("el interlineado de un texto de una línea se guarda para cuando tenga más", () => {
    const element = text('<text x="0" y="10" font-size="10">a</text>');
    writeLines(element, ["a"], 2);
    expect(element.getAttribute(LINE_HEIGHT_ATTRIBUTE)).toBe("2");
    expect(lineHeight(element)).toBe(2);
    writeLines(element, ["a", "b"]);
    expect(element.lastElementChild?.getAttribute("y")).toBe("30");
    expect(element.hasAttribute(LINE_HEIGHT_ATTRIBUTE)).toBe(false);
  });
});

const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("textos del corpus", () => {
  const texts = Object.entries(files).flatMap(([file, source]) => {
    const svg = draw(source.replace(/^\uFEFF/, "").replace(/<\?xml[^>]*>/, ""));
    return [...svg.querySelectorAll("text")].map((element, i) => ({
      name: `${file.replace(/^.*corpus\//, "")} #${String(i)}`,
      element,
    }));
  });

  it("se clasifican todos, y hay de los dos tipos", () => {
    const results = texts.map(({ element }) => textEditability(element));
    expect(texts.length).toBeGreaterThan(10);
    expect(results.some((r) => r.editable)).toBe(true);
    expect(results.some((r) => !r.editable)).toBe(true);
  });

  it("volver a escribir las líneas de los editables no cambia lo que se ve", () => {
    for (const { name, element } of texts) {
      if (!textEditability(element).editable) continue;
      const before = positions(element);
      writeLines(element, readLines(element));
      const after = positions(element);
      expect(after.length, name).toBe(before.length);
      after.forEach(([x, y], i) => {
        expect(
          Math.abs((x ?? 0) - (before[i]?.[0] ?? 0)),
          `${name}, x del carácter ${String(i)}`,
        ).toBeLessThan(0.05);
        expect(
          Math.abs((y ?? 0) - (before[i]?.[1] ?? 0)),
          `${name}, y del carácter ${String(i)}`,
        ).toBeLessThan(0.05);
      });
    }
  });
});
