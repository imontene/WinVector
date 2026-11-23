import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document";
import { readStyle } from "../style";
import {
  type GradientStop,
  ownGradient,
  paintGradient,
  readGradient,
  writeGradient,
} from "./gradient";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

function load(source: string): SvgDocument {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return SvgDocument.load(source, host);
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200">${body}</svg>`;

function pick(doc: SvgDocument, selector: string): Element {
  const element = doc.root.querySelector(selector);
  if (!element) throw new Error(`No existe ${selector}`);
  return element;
}

function gradientOf(doc: SvgDocument, selector: string, property: "fill" | "stroke" = "fill") {
  const found = paintGradient(pick(doc, selector), property, doc.root);
  if (!found) throw new Error(`${selector} no pinta con un degradado`);
  return found;
}

const CHAIN = svg(`
  <defs>
    <linearGradient id="base">
      <stop offset="0" stop-color="#0a8"/>
      <stop offset="1" stop-color="#ffb547"/>
    </linearGradient>
    <linearGradient id="vertical" href="#base" x2="0" y2="1"/>
    <radialGradient id="antiguo" xlink:href="#base"/>
  </defs>
  <rect id="a" x="10" y="10" width="85" height="180" fill="url(#vertical)"/>
  <rect id="b" x="105" y="10" width="85" height="180" fill="url(#antiguo)"/>`);

describe("leer degradados", () => {
  it("sigue las cadenas href y xlink:href: hereda las paradas y lo que no tiene", () => {
    const doc = load(CHAIN);
    const vertical = readGradient(gradientOf(doc, "#a"), doc.root);
    expect(vertical).toMatchObject({
      kind: "linear",
      units: "objectBoundingBox",
      spread: "pad",
      transform: null,
      linear: { x1: 0, y1: 0, x2: 0, y2: 1 },
      stops: [
        { offset: 0, color: "#00aa88", opacity: 1 },
        { offset: 1, color: "#ffb547", opacity: 1 },
      ],
    });
    const radial = readGradient(gradientOf(doc, "#b"), doc.root);
    expect(radial).toMatchObject({
      kind: "radial",
      radial: { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5, fr: 0 },
      stops: vertical.stops,
    });
  });

  it("lee porcentajes, estilos de las paradas (Inkscape), opacidad y posiciones desordenadas", () => {
    const doc = load(
      svg(`<defs>
        <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10%" y2="20" spreadMethod="reflect" gradientTransform="rotate(45)">
          <stop offset="20%" style="stop-color:#bebec0;stop-opacity:0.5"/>
          <stop offset="0.1" stop-color="rgba(255, 0, 0, 0.5)" stop-opacity="0.5"/>
          <stop offset="2" stop-color="blue"/>
        </linearGradient></defs>
        <rect id="r" width="10" height="10" style="fill:url(#g)"/>`),
    );
    expect(readGradient(gradientOf(doc, "#r"), doc.root)).toMatchObject({
      units: "userSpaceOnUse",
      spread: "reflect",
      transform: "rotate(45)",
      linear: { x1: 0.1, y1: 0, x2: 1, y2: 20 },
      stops: [
        { offset: 0.2, color: "#bebec0", opacity: 0.5 },
        // Una parada no puede ir antes que la anterior; el alfa del color se multiplica.
        { offset: 0.2, color: "#ff0000", opacity: 0.25 },
        { offset: 1, color: "#0000ff", opacity: 1 },
      ],
    });
  });

  it("un ciclo de href no cuelga y un degradado sin paradas no tiene ninguna", () => {
    const doc = load(
      svg(`<defs>
        <linearGradient id="uno" href="#dos"/>
        <linearGradient id="dos" href="#uno"/></defs>
        <rect id="r" width="10" height="10" fill="url(#uno)"/>`),
    );
    expect(readGradient(gradientOf(doc, "#r"), doc.root).stops).toEqual([]);
  });

  it("el estilo de la selección describe el degradado común y cuántos lo usan", () => {
    const doc = load(
      svg(`<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
        <rect id="a" width="10" height="10" fill="url(#g)" stroke="url(#g)"/>
        <rect id="b" width="10" height="10" fill="url(#g)"/>
        <rect id="c" width="10" height="10" fill="#ff0000"/>`),
    );
    const both = readStyle([pick(doc, "#a"), pick(doc, "#b")]);
    expect(both.fill).toBe("url");
    expect(both.fillGradient).toEqual({
      id: "g",
      kind: "linear",
      spread: "pad",
      stops: [
        { offset: 0, color: "#000000", opacity: 1 },
        { offset: 1, color: "#ffffff", opacity: 1 },
      ],
      users: 3,
      stopsId: "g",
      stopsUsers: 3,
    });
    expect(both.strokeGradient).toBeUndefined();
    expect(readStyle([pick(doc, "#a"), pick(doc, "#c")]).fillGradient).toBeUndefined();
  });
});

const FIRST: GradientStop = { offset: 0, color: "#112233", opacity: 1 };
const LAST: GradientStop = { offset: 1, color: "#ffffff", opacity: 0.5 };
const STOPS: GradientStop[] = [FIRST, LAST];

describe("degradado propio de un objeto", () => {
  it("si solo lo usa el objeto, es el mismo", () => {
    const doc = load(
      svg(`<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
        <rect id="r" width="10" height="10" fill="url(#g)"/>`),
    );
    expect(ownGradient(pick(doc, "#r"), "fill", doc.root)?.id).toBe("g");
    expect(doc.root.querySelectorAll("linearGradient")).toHaveLength(1);
  });

  it.each([
    ["otro objeto lo usa", `<rect id="r" fill="url(#g)"/><rect id="otro" fill="url(#g)"/>`],
    [
      "el objeto lo usa en el relleno y en el trazo",
      `<rect id="r" fill="url(#g)" stroke="url(#g)"/>`,
    ],
    [
      "otro degradado lo hereda",
      `<linearGradient id="hijo" href="#g"/><rect id="r" fill="url(#g)"/>`,
    ],
    ["el objeto lo hereda de su grupo", `<g fill="url(#g)"><rect id="r"/></g>`],
    ["una clase de CSS lo aplica", `<style>.c { fill: url(#g) }</style><rect id="r" class="c"/>`],
  ])("si %s, se hace una copia solo para el objeto", (_, body) => {
    const doc = load(
      svg(`<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
        ${body.replace(/<rect /g, '<rect width="10" height="10" ')}`),
    );
    const target = pick(doc, "#r");
    const copy = ownGradient(target, "fill", doc.root);
    expect(copy?.id).toBe("g-2");
    // Justo detrás del original, con sus atributos y paradas.
    expect(pick(doc, "#g").nextElementSibling).toBe(copy);
    expect(copy?.getAttribute("y2")).toBe("1");
    expect(copy?.querySelectorAll("stop")).toHaveLength(2);
    expect(paintGradient(target, "fill", doc.root)).toBe(copy);

    if (copy) writeGradient(copy, doc.root, { stops: STOPS });
    // El original no cambia: lo demás que lo usaba se sigue viendo igual.
    expect(readGradient(pick(doc, "#g") as SVGGradientElement, doc.root).stops[0]?.color).toBe(
      "#000000",
    );
    expect(readGradient(gradientOf(doc, "#r"), doc.root).stops).toEqual(STOPS);
  });

  it("si una regla de CSS tapa el atributo, la copia se declara en el atributo style", () => {
    const doc = load(
      svg(`<style>#r { fill: url(#g) }</style><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
        <rect id="r" width="10" height="10"/>`),
    );
    ownGradient(pick(doc, "#r"), "fill", doc.root);
    expect(pick(doc, "#r").getAttribute("style")).toBe("fill:url(#g-2)");
  });
});

describe("escribir degradados", () => {
  it("cambia solo lo que cambia, en el atributo o en el estilo donde estaba", () => {
    const doc = load(
      svg(`<defs><linearGradient id="g" x2="0" y2="1">
          <stop id="s1" offset="0" style="stop-color:#112233"/>
          <stop id="s2" offset="1" stop-color="#ffffff"/>
        </linearGradient></defs>
        <rect id="r" width="10" height="10" fill="url(#g)"/>`),
    );
    const gradient = gradientOf(doc, "#r");
    const before = gradient.outerHTML;
    writeGradient(gradient, doc.root, {
      stops: [FIRST, { ...LAST, opacity: 1 }],
      linear: { y2: 1 },
    });
    expect(gradient.outerHTML).toBe(before);

    writeGradient(gradient, doc.root, { stops: STOPS, spread: "repeat", linear: { x2: 0.5 } });
    expect(pick(doc, "#s1").getAttribute("style")).toBe("stop-color:#112233");
    expect(pick(doc, "#s2").getAttribute("stop-opacity")).toBe("0.5");
    expect(gradient.getAttribute("spreadMethod")).toBe("repeat");
    expect(gradient.getAttribute("x2")).toBe("0.5");
    expect(readGradient(gradient, doc.root).stops).toEqual(STOPS);
  });

  it("añade paradas copiando la última y quita las que sobran", () => {
    const doc = load(
      svg(`<defs><linearGradient id="g"><stop offset="0" stop-color="#000" class="x"/><stop id="fin" offset="1" stop-color="#fff"/></linearGradient></defs>
        <rect id="r" width="10" height="10" fill="url(#g)"/>`),
    );
    const gradient = gradientOf(doc, "#r");
    const three: GradientStop[] = [
      { offset: 0, color: "#000000", opacity: 1 },
      { offset: 0.5, color: "#ff0000", opacity: 1 },
      { offset: 1, color: "#ffffff", opacity: 1 },
    ];
    writeGradient(gradient, doc.root, { stops: three });
    expect(readGradient(gradient, doc.root).stops).toEqual(three);
    expect(gradient.querySelectorAll("stop[id]")).toHaveLength(1);

    writeGradient(gradient, doc.root, { stops: three.slice(0, 1) });
    expect(gradient.querySelectorAll("stop")).toHaveLength(1);
  });

  it("las paradas heredadas pasan a ser propias antes de cambiarlas; el padre no cambia", () => {
    const doc = load(CHAIN);
    const vertical = gradientOf(doc, "#a");
    writeGradient(vertical, doc.root, { stops: STOPS });
    expect(vertical.querySelectorAll("stop")).toHaveLength(2);
    expect(readGradient(vertical, doc.root).stops).toEqual(STOPS);
    expect(readGradient(gradientOf(doc, "#b"), doc.root).stops[0]?.color).toBe("#00aa88");
  });

  it("quitar una transformación heredada la anula con la identidad", () => {
    const doc = load(
      svg(`<defs><linearGradient id="padre" gradientTransform="rotate(90)"/>
        <linearGradient id="g" href="#padre"/></defs>
        <rect id="r" width="10" height="10" fill="url(#g)"/>`),
    );
    const gradient = gradientOf(doc, "#r");
    writeGradient(gradient, doc.root, { transform: null, units: "userSpaceOnUse" });
    expect(gradient.getAttribute("gradientTransform")).toBe("matrix(1 0 0 1 0 0)");
    expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
  });
});

/** Degradados del corpus: se leen sin errores y leerlos no cambia el documento. */
const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("degradados del corpus", () => {
  const withGradients = Object.entries(files).filter(([, source]) => source.includes("Gradient"));

  it("hay archivos con degradados", () => {
    expect(withGradients.length).toBeGreaterThanOrEqual(5);
  });

  it.each(withGradients.map(([file, source]) => [file.replace(/^.*tests\/corpus\//, ""), source]))(
    "%s",
    (_, source) => {
      const doc = load(source.replace(/^\uFEFF/, ""));
      const before = doc.serialize();
      const gradients = [...doc.root.querySelectorAll("linearGradient, radialGradient")];
      for (const gradient of gradients) {
        const read = readGradient(gradient as SVGGradientElement, doc.root);
        for (const stop of read.stops) {
          expect(stop.color).toMatch(/^#[0-9a-f]{6}$/);
          expect(stop.offset).toBeGreaterThanOrEqual(0);
          expect(stop.offset).toBeLessThanOrEqual(1);
        }
      }
      for (const element of doc.root.querySelectorAll("*")) readStyle([element]);
      expect(doc.serialize()).toBe(before);
    },
  );
});
