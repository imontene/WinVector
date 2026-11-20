import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document";
import { selectableChildren } from "../selection";
import { applyStyle, paintOf, paintTargets, readStyle, type StyleChange } from ".";

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
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

function pick(doc: SvgDocument, selector: string): Element {
  const element = doc.root.querySelector(selector);
  if (!element) throw new Error(`No existe ${selector}`);
  return element;
}

const change = (values: Partial<StyleChange>): StyleChange => ({
  fill: null,
  stroke: null,
  strokeWidth: null,
  opacity: null,
  ...values,
});

describe("pinturas", () => {
  it.each([
    ["rgb(255, 181, 71)", "#ffb547"],
    ["rgba(0, 0, 0, 0)", "none"],
    ["rgba(10, 20, 30, 0.5)", "#0a141e"],
    ["none", "none"],
    ['url("#g")', "url"],
  ])("%s → %s", (computed, paint) => {
    expect(paintOf(computed)).toBe(paint);
  });
});

describe("leer el estilo", () => {
  it("lee el estilo aunque venga de CSS o de un grupo", () => {
    const doc = load(
      svg(
        `<style>.c { fill: rgb(0, 128, 0) }</style><rect id="a" class="c"/><g fill="#ff0000" stroke="blue" stroke-width="3" opacity="0.5"><rect id="b"/></g>`,
      ),
    );
    expect(readStyle([pick(doc, "#a")])).toMatchObject({
      fill: "#008000",
      stroke: "none",
      strokeWidth: 1,
      opacity: 1,
    });
    expect(readStyle([pick(doc, "g")])).toEqual({
      fill: "#ff0000",
      stroke: "#0000ff",
      strokeWidth: 3,
      opacity: 0.5,
    });
  });

  it("con valores distintos da null", () => {
    const doc = load(svg(`<rect id="a" fill="red"/><rect id="b" fill="blue"/>`));
    expect(readStyle([pick(doc, "#a"), pick(doc, "#b")])).toMatchObject({
      fill: null,
      stroke: "none",
    });
  });

  it("un degradado se lee como url", () => {
    const doc = load(svg(`<defs><linearGradient id="g"/></defs><rect id="a" fill="url(#g)"/>`));
    expect(readStyle([pick(doc, "#a")]).fill).toBe("url");
  });

  it("en un grupo, las formas y textos que contiene", () => {
    const doc = load(
      svg(`<g id="g"><rect id="r"/><text id="t">a<tspan>b</tspan></text><defs><rect/></defs></g>`),
    );
    expect(paintTargets(pick(doc, "#g")).map((element) => element.id)).toEqual(["r", "t"]);
  });
});

describe("aplicar el estilo", () => {
  it("cambia el atributo de presentación si lo hay", () => {
    const source = svg(`<rect id="a" x="1" fill="red" stroke="black"/>`);
    const doc = load(source);
    applyStyle([pick(doc, "#a")], change({ fill: "#00FF00" }), doc.history);
    expect(doc.serialize()).toBe(source.replace('fill="red"', 'fill="#00ff00"'));
  });

  it("cambia solo esa declaración del atributo style", () => {
    const source = svg(`<rect id="a" style="stroke: #000 ;fill:red; opacity:1"/>`);
    const doc = load(source);
    applyStyle([pick(doc, "#a")], change({ fill: "none" }), doc.history);
    expect(doc.serialize()).toBe(source.replace("fill:red", "fill:none"));
  });

  it("si una regla de CSS tapa el atributo, lo declara en style", () => {
    const doc = load(svg(`<style>.c { fill: green }</style><rect id="a" class="c"/>`));
    applyStyle([pick(doc, "#a")], change({ fill: "#0000ff" }), doc.history);
    expect(pick(doc, "#a").getAttribute("style")).toBe("fill:#0000ff");
    expect(pick(doc, "#a").hasAttribute("fill")).toBe(false);
    expect(readStyle([pick(doc, "#a")]).fill).toBe("#0000ff");
  });

  it("en un grupo, recolorea las formas y pone la opacidad al grupo", () => {
    const doc = load(svg(`<g id="g"><rect id="r" fill="red"/><circle id="c"/></g>`));
    applyStyle(
      [pick(doc, "#g")],
      change({ fill: "#123456", strokeWidth: 2, opacity: 0.25 }),
      doc.history,
    );
    expect(pick(doc, "#r").getAttribute("fill")).toBe("#123456");
    expect(pick(doc, "#c").getAttribute("fill")).toBe("#123456");
    expect(pick(doc, "#c").getAttribute("stroke-width")).toBe("2");
    expect(pick(doc, "#g").getAttribute("opacity")).toBe("0.25");
    expect(pick(doc, "#r").hasAttribute("opacity")).toBe(false);
  });

  it("los cambios seguidos de la misma propiedad son un solo paso", () => {
    const source = svg(`<rect id="a" fill="red"/>`);
    const doc = load(source);
    for (const color of ["#111111", "#222222", "#333333"]) {
      applyStyle([pick(doc, "#a")], change({ fill: color }), doc.history);
    }
    applyStyle([pick(doc, "#a")], change({ opacity: 0.5 }), doc.history);
    doc.history.undo();
    expect(pick(doc, "#a").getAttribute("fill")).toBe("#333333");
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });

  it("no acepta colores no válidos", () => {
    const doc = load(svg(`<rect id="a"/>`));
    expect(applyStyle([pick(doc, "#a")], change({ fill: "url(javascript:1)" }), doc.history)).toBe(
      false,
    );
    expect(applyStyle([pick(doc, "#a")], change({ fill: "rojo" }), doc.history)).toBe(false);
  });
});

describe("corpus: cambiar el relleno de un objeto solo cambia ese relleno en el archivo", () => {
  const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it.each(Object.entries(files).map(([path, source]) => [path.replace(/^.*corpus\//, ""), source]))(
    "%s",
    (_name, source) => {
      const doc = load(source);
      const target = selectableChildren(doc.root)
        .flatMap(paintTargets)
        .find((element) => readStyle([element]).fill !== "#123456");
      if (!target) return;
      applyStyle([target], change({ fill: "#123456" }), doc.history);
      expect(readStyle([target]).fill).toBe("#123456");

      // Lo único que cambia del texto es la etiqueta de apertura de ese elemento, y en ella solo el
      // relleno (como atributo o dentro de style).
      const output = doc.serialize();
      let start = 0;
      while (start < source.length && source[start] === output[start]) start++;
      let end = 0;
      while (
        end < source.length - start &&
        end < output.length - start &&
        source[source.length - 1 - end] === output[output.length - 1 - end]
      ) {
        end++;
      }
      const tagAt = (text: string, from: number, to: number) => {
        const open = text.lastIndexOf("<", from);
        const close = text.indexOf(">", Math.max(open, to - 1));
        return text.slice(open, close + 1);
      };
      const before = tagAt(source, start, source.length - end);
      const after = tagAt(output, start, output.length - end);
      expect(before.indexOf("<", 1)).toBe(-1);
      expect(after.indexOf("<", 1)).toBe(-1);
      const attributes = (tag: string) => {
        // Las entidades del DTD (fill="&color;") no se pueden resolver fuera del documento.
        const plain = tag.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)[\w.-]+;/g, "entidad");
        const closed = plain.endsWith("/>") ? plain : `${plain.slice(0, -1)}/>`;
        const parsed = new DOMParser().parseFromString(
          closed.replace(
            /^<([^\s/>]+)/,
            '<x xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="i" xmlns:sodipodi="s" xmlns:xml="http://www.w3.org/XML/1998/namespace"',
          ),
          "application/xml",
        ).documentElement;
        return new Map(
          [...parsed.attributes].map((attribute) => [attribute.name, attribute.value]),
        );
      };
      const old = attributes(before);
      const next = attributes(after);
      const changed = [...new Set([...old.keys(), ...next.keys()])].filter(
        (name) => old.get(name) !== next.get(name),
      );
      expect(changed.every((name) => name === "fill" || name === "style")).toBe(true);
      if (changed.includes("style")) {
        expect((next.get("style") ?? "").replace(/fill\s*:\s*#123456/, "")).toBe(
          (old.get("style") ?? "").replace(/fill\s*:[^;]*/, ""),
        );
      }

      doc.history.undo();
      expect(doc.serialize()).toBe(source);
    },
  );
});
