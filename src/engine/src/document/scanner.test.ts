import { describe, expect, it } from "vitest";
import { scanXml, type SourceElement } from "./scanner";

const slice = (source: string, node: { start: number; end: number }) =>
  source.slice(node.start, node.end);

function elementAt(parent: SourceElement, index: number): SourceElement {
  const node = parent.children[index];
  if (node?.kind !== "element") throw new Error(`El hijo ${String(index)} no es un elemento`);
  return node;
}

describe("scanXml", () => {
  it("localiza el elemento raíz sin incluir el prólogo", () => {
    const source = `<?xml version="1.0"?>\n<!-- c -->\n<svg a="1"><g/></svg>\n`;
    const { root } = scanXml(source);
    expect(slice(source, root)).toBe(`<svg a="1"><g/></svg>`);
    expect(source.slice(root.start, root.startTagEnd)).toBe(`<svg a="1">`);
  });

  it("registra los hijos en orden, con texto, comentarios, CDATA e instrucciones", () => {
    const source = `<svg> a <!--b--><![CDATA[c]]><?pi d?><g></g></svg>`;
    const { root } = scanXml(source);
    expect(root.children.map((c) => c.kind)).toEqual(["text", "comment", "cdata", "pi", "element"]);
    expect(root.children.map((c) => slice(source, c))).toEqual([
      " a ",
      "<!--b-->",
      "<![CDATA[c]]>",
      "<?pi d?>",
      "<g></g>",
    ]);
  });

  it("distingue elementos vacíos con y sin etiqueta de cierre", () => {
    const source = `<svg><a /><b></b></svg>`;
    const { root } = scanXml(source);
    const b = elementAt(root, 1);
    expect(elementAt(root, 0)).toMatchObject({ name: "a", selfClosing: true, endTagStart: null });
    expect(b).toMatchObject({ name: "b", selfClosing: false });
    expect(source.slice(b.endTagStart ?? 0, b.end)).toBe("</b>");
  });

  it("lee atributos con comillas simples, espacios y > dentro del valor", () => {
    const source = `<svg  xmlns:x = 'u'\n  d="a > b" x:y="1"/>`;
    const { root } = scanXml(source);
    expect(root.attributes.map((a) => [a.name, slice(source, a)])).toEqual([
      ["xmlns:x", "xmlns:x = 'u'"],
      ["d", 'd="a > b"'],
      ["x:y", 'x:y="1"'],
    ]);
    expect(root.selfClosing).toBe(true);
  });

  it("salta un DOCTYPE con subconjunto interno", () => {
    const source = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [\n<!ENTITY ns "http://a>b">\n<!-- ] -->\n]><svg/>`;
    expect(scanXml(source).root.name).toBe("svg");
  });

  it("anida correctamente los elementos", () => {
    const source = `<svg><g id="a"><rect/></g><g id="b"/></svg>`;
    const { root } = scanXml(source);
    expect(elementAt(root, 0).children).toHaveLength(1);
    expect(slice(source, elementAt(root, 0))).toBe(`<g id="a"><rect/></g>`);
    expect(slice(source, elementAt(root, 1))).toBe(`<g id="b"/>`);
  });
});
