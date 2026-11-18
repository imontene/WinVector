import { afterEach, describe, expect, it } from "vitest";
import { SVG_NS, SvgDocument, SvgParseError } from "./svgDocument";

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

const svg = (body: string, attributes = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>${body}</svg>`;

function byId(doc: SvgDocument, id: string): Element {
  const element = doc.root.querySelector(`#${id}`);
  if (!element) throw new Error(`No existe #${id}`);
  return element;
}

describe("ida y vuelta sin cambios", () => {
  it.each([
    [
      "declaración XML y BOM",
      `\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${svg("<g/>")}\n`,
    ],
    [
      "comentarios fuera y dentro",
      `<!-- autor -->\n${svg("<!-- capa --><rect width='1'/>")}<!-- fin -->`,
    ],
    [
      "DOCTYPE con entidades (estilo Illustrator)",
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg xmlns="&ns_svg;"><rect width="1"/></svg>`,
    ],
    [
      "espacios de nombres ajenos (Inkscape)",
      svg(
        `<sodipodi:namedview id="nv" inkscape:zoom="1.2"/><g inkscape:label="Capa 1" inkscape:groupmode="layer"/>`,
        ` xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"`,
      ),
    ],
    ["CDATA en style", svg(`<style><![CDATA[ rect { fill: red } ]]></style>`)],
    [
      "instrucciones de procesamiento",
      `<?xml-stylesheet href="a.css"?>\n${svg("<?editor dato?><g/>")}`,
    ],
    [
      "finales de línea CRLF y tabuladores",
      svg(`\r\n\t<g >\r\n\t\t<rect  width = "1" />\r\n\t</g>\r\n`),
    ],
    ["comillas simples y entidades en texto", svg(`<text x='1'>a &amp; b &lt; c &#233;</text>`)],
    [
      "elementos y atributos desconocidos",
      svg(`<foo:bar xmlns:foo="urn:x" foo:a="1"><foo:baz/></foo:bar>`),
    ],
  ])("%s", (_, source) => {
    expect(load(source).serialize()).toBe(source);
  });
});

describe("ediciones parciales", () => {
  const source = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"\n     viewBox="0 0 10 10">\n  <!-- fondo -->\n  <rect id="a" fill='red'   width="1"/>\n  <g id="g">\n    <circle id="b" r="2" />\n  </g>\n</svg>\n`;

  it("un atributo cambiado solo regenera esa etiqueta, en el mismo orden", () => {
    const doc = load(source);
    byId(doc, "a").setAttribute("fill", "blue");
    expect(doc.serialize()).toBe(
      source.replace(
        `<rect id="a" fill='red'   width="1"/>`,
        `<rect id="a" fill="blue" width="1"/>`,
      ),
    );
  });

  it("un atributo nuevo se añade al final y uno eliminado desaparece", () => {
    const doc = load(source);
    const rect = byId(doc, "a");
    rect.setAttribute("opacity", "0.5");
    rect.removeAttribute("width");
    expect(doc.serialize()).toContain(`<rect id="a" fill='red' opacity="0.5"/>`);
  });

  it("los hermanos y el resto del documento quedan exactamente igual", () => {
    const doc = load(source);
    byId(doc, "b").setAttribute("r", "3");
    const out = doc.serialize();
    expect(out).toContain(`<rect id="a" fill='red'   width="1"/>`);
    expect(out).toContain(`<!-- fondo -->`);
    expect(out).toContain(`viewBox="0 0 10 10">`);
    expect(out).toContain(`<circle id="b" r="3"/>`);
  });

  it("un elemento nuevo se escribe completo y los demás no cambian", () => {
    const doc = load(source);
    const ellipse = document.createElementNS(SVG_NS, "ellipse");
    ellipse.setAttribute("rx", "1");
    ellipse.setAttribute("data-nota", `a "b" & <c>`);
    byId(doc, "g").append(ellipse);
    expect(doc.serialize()).toBe(
      source.replace(`</g>`, `<ellipse rx="1" data-nota="a &quot;b&quot; &amp; &lt;c>"/></g>`),
    );
  });

  it("un elemento eliminado desaparece sin tocar los demás", () => {
    const doc = load(source);
    byId(doc, "a").remove();
    expect(doc.serialize()).toBe(source.replace(`<rect id="a" fill='red'   width="1"/>`, ""));
  });

  it("un elemento vacío <x/> que recibe hijos se abre y se cierra", () => {
    const doc = load(svg(`<g id="v" class="c" />`));
    byId(doc, "v").append(document.createElementNS(SVG_NS, "rect"));
    expect(doc.serialize()).toBe(svg(`<g id="v" class="c"><rect/></g>`));
  });

  it("el texto cambiado se escapa", () => {
    const doc = load(svg(`<text id="t">hola</text>`));
    const text = byId(doc, "t").firstChild as Text;
    text.data = "a < b & c";
    expect(doc.serialize()).toBe(svg(`<text id="t">a &lt; b &amp; c</text>`));
  });

  it("una entidad en un atributo sin cambios se conserva", () => {
    const source = `<!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg">]><svg xmlns="&ns;"><rect id="r" x="1"/></svg>`;
    const doc = load(source);
    byId(doc, "r").setAttribute("x", "2");
    expect(doc.serialize()).toBe(source.replace(`x="1"`, `x="2"`));
  });

  it("cuenta las revisiones", () => {
    const doc = load(source);
    expect(doc.revision).toBe(0);
    byId(doc, "a").setAttribute("fill", "blue");
    expect(doc.revision).toBe(1);
  });
});

describe("contenido activo", () => {
  const source = svg(
    `<script>window.__winvectorScript = true;</script><rect id="r" width="10" height="10" onclick="window.__winvectorClick = true"/>`,
  );

  it("no ejecuta los scripts y los guarda intactos", async () => {
    const doc = load(source);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((window as unknown as Record<string, unknown>).__winvectorScript).toBeUndefined();
    expect(doc.root.querySelector("script")).toBeNull();
    byId(doc, "r").setAttribute("width", "20");
    expect(doc.serialize()).toContain(`<script>window.__winvectorScript = true;</script>`);
  });

  it("conserva los atributos on* en el archivo", () => {
    expect(load(source).serialize()).toContain(`onclick="window.__winvectorClick = true"`);
  });
});

describe("aislamiento", () => {
  it("los estilos del documento no afectan a la página", () => {
    const before = getComputedStyle(document.body).backgroundColor;
    load(
      svg(
        `<style>body { background: rgb(255, 0, 0) } rect { fill: blue }</style><rect id="r" width="1" height="1"/>`,
      ),
    );
    expect(getComputedStyle(document.body).backgroundColor).toBe(before);
  });

  it("los estilos del documento sí se aplican al documento", () => {
    const doc = load(
      svg(`<style>rect { fill: rgb(0, 0, 255) }</style><rect id="r" width="1" height="1"/>`),
    );
    expect(getComputedStyle(byId(doc, "r")).fill).toBe("rgb(0, 0, 255)");
  });

  it("los id del documento no se mezclan con los de la página", () => {
    document.body.insertAdjacentHTML("beforeend", `<div id="pagina"></div>`);
    load(svg(`<rect id="pagina"/>`));
    expect(document.querySelectorAll("#pagina")).toHaveLength(1);
    document.getElementById("pagina")?.remove();
  });
});

describe("identificadores y definiciones", () => {
  it("crea identificadores únicos y legibles", () => {
    const doc = load(svg(`<rect id="degradado"/><rect id="degradado-2"/>`));
    expect(doc.createId("degradado")).toBe("degradado-3");
    expect(doc.createId("degradado")).toBe("degradado-4");
    expect(doc.createId("2 sol!")).toBe("sol-");
    expect(doc.createId("círculo")).toBe("c-rculo");
  });

  it("crea defs después de title y reutiliza el existente", () => {
    const doc = load(svg(`<title>T</title><rect/>`));
    const defs = doc.getOrCreateDefs();
    expect(defs.previousElementSibling?.localName).toBe("title");
    expect(doc.getOrCreateDefs()).toBe(defs);
  });

  it("detecta las definiciones sin uso", () => {
    const doc = load(
      svg(`<defs><linearGradient id="usado"/><linearGradient id="base"/><radialGradient id="hereda" href="#base"/><clipPath id="huerfano"/><symbol id="estilo"/></defs>
        <style>.x { fill: url(#estilo) }</style><rect fill="url(#usado)"/><rect fill="url('#hereda')"/>`),
    );
    expect(doc.findUnusedDefinitions().map((d) => d.id)).toEqual(["huerfano"]);
  });
});

describe("errores", () => {
  it("indica la línea y la columna de un XML no válido", () => {
    try {
      load(`<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n</svg>`);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SvgParseError);
      const parseError = error as SvgParseError;
      expect(parseError.line).toBe(3);
      expect(parseError.column).toBeGreaterThan(0);
      expect(parseError.message).toMatch(/línea 3, columna/);
    }
  });

  it("rechaza un XML que no es SVG", () => {
    expect(() => load(`<html xmlns="http://www.w3.org/1999/xhtml"/>`)).toThrow(/no es un SVG/);
  });

  it("si el texto no cuadra con el DOM, guarda sin perder contenido", () => {
    const source = `<!DOCTYPE svg [<!ENTITY g "<g id='e'/>">]><svg xmlns="http://www.w3.org/2000/svg">&g;<rect id="r"/></svg>`;
    const doc = load(source);
    expect(doc.hasExactMapping).toBe(false);
    byId(doc, "r").setAttribute("x", "1");
    const out = doc.serialize();
    expect(out).toContain(`<g id="e"/>`);
    expect(out).toContain(`<rect id="r" x="1"/>`);
  });
});

describe("marca BOM", () => {
  it("se conserva al guardar un documento modificado", () => {
    const doc = load(`\uFEFF${svg(`<rect id="r"/>`)}`);
    byId(doc, "r").setAttribute("x", "1");
    expect(doc.serialize()).toBe(`\uFEFF${svg(`<rect id="r" x="1"/>`)}`);
  });
});
