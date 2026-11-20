import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document";
import { selectionBounds } from "../selection";
import { copySelection, duplicate, pasteSvg, remove } from ".";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

function load(source: string): SvgDocument {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;width:800px;height:600px";
  document.body.append(host);
  hosts.push(host);
  const doc = SvgDocument.load(source, host);
  doc.artboard.style.setProperty("--artboard-width", "800px");
  doc.artboard.style.setProperty("--artboard-height", "600px");
  return doc;
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="300" viewBox="0 0 400 300">${body}</svg>`;

function pick(doc: SvgDocument, selector: string): Element {
  const element = doc.root.querySelector(selector);
  if (!element) throw new Error(`No existe ${selector}`);
  return element;
}

const GRADIENT = `<linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>`;

const copy = (doc: SvgDocument, ...selectors: string[]) => {
  const text = copySelection(
    selectors.map((selector) => pick(doc, selector)),
    doc.root,
  );
  if (!text) throw new Error("No se copió nada");
  return text;
};

const paste = (
  doc: SvgDocument,
  text: string,
  at: { x: number; y: number } | null = null,
  scope?: Element,
) => pasteSvg(text, doc, scope ?? doc.root, { at, offset: 10 });

describe("copiar", () => {
  it("da un SVG independiente con la caja de la selección como viewBox", () => {
    const doc = load(svg(`<rect id="r" x="10" y="20" width="30" height="40"/>`));
    const text = copy(doc, "#r");
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    expect(parsed.getAttribute("viewBox")).toBe("10 20 30 40");
    expect(parsed.getAttribute("width")).toBe("30");
    expect(parsed.querySelector("rect")?.getAttribute("x")).toBe("10");
  });

  it("lleva las definiciones que usa, también las encadenadas y los símbolos", () => {
    const doc = load(
      svg(
        `<defs>${GRADIENT}<linearGradient id="h" href="#g"/><symbol id="s"><circle r="3"/></symbol><linearGradient id="nada"/></defs><rect id="r" fill="url(#h)"/><use id="u" href="#s"/>`,
      ),
    );
    const text = copy(doc, "#r", "#u");
    expect(text).toContain('id="h"');
    expect(text).toContain('id="g"');
    expect(text).toContain('id="s"');
    expect(text).not.toContain('id="nada"');
  });

  it("lleva la posición y los estilos que el objeto heredaba de su grupo", () => {
    const doc = load(
      svg(
        `<g fill="rgb(255, 0, 0)" transform="translate(50 60)"><rect id="r" width="5" height="5"/></g>`,
      ),
    );
    const text = copy(doc, "#r");
    const rect = new DOMParser().parseFromString(text, "image/svg+xml").querySelector("rect");
    expect(rect?.getAttribute("transform")).toBe("translate(50 60)");
    expect(rect?.getAttribute("fill")).toBe("rgb(255, 0, 0)");
  });
});

describe("pegar", () => {
  it("copiar un objeto con degradado de un documento y pegarlo en otro conserva el degradado", () => {
    const from = load(
      svg(`<defs>${GRADIENT}</defs><rect id="r" width="50" height="50" fill="url(#g)"/>`),
    );
    const to = load(svg(`<circle id="c" r="5"/>`));
    const [pasted] = paste(to, copy(from, "#r"));
    expect(pasted?.getAttribute("fill")).toBe("url(#g)");
    expect(to.root.querySelector("defs > linearGradient#g")?.children).toHaveLength(2);
    if (!pasted) throw new Error("No se pegó nada");
    expect(getComputedStyle(pasted).fill).toContain("#g");
  });

  it("si el id ya se usa para otra cosa, renombra la definición pegada y sus referencias", () => {
    const from = load(
      svg(`<defs>${GRADIENT}</defs><rect id="r" width="50" height="50" fill="url(#g)"/>`),
    );
    const to = load(svg(`<defs><radialGradient id="g"/></defs><rect id="r"/>`));
    const [pasted] = paste(to, copy(from, "#r"));
    expect(pasted?.id).toBe("r-2");
    expect(pasted?.getAttribute("fill")).toBe("url(#g-2)");
    expect(to.root.querySelector("#g")?.localName).toBe("radialGradient");
    expect(to.root.querySelector("#g-2")?.localName).toBe("linearGradient");
  });

  it("en el mismo documento reutiliza la definición y desplaza la copia", () => {
    const doc = load(
      svg(
        `<defs>${GRADIENT}</defs><rect id="r" x="10" y="10" width="50" height="50" fill="url(#g)"/>`,
      ),
    );
    const [pasted] = paste(doc, copy(doc, "#r"));
    expect(doc.root.querySelectorAll("linearGradient")).toHaveLength(1);
    expect(pasted?.getAttribute("fill")).toBe("url(#g)");
    expect(pasted?.getAttribute("x")).toBe("20");
    expect(pasted?.getAttribute("y")).toBe("20");
  });

  it("convierte las hojas de estilos en atributos y no las añade al documento", () => {
    const doc = load(svg(`<rect id="propio" class="st0" width="5" height="5"/>`));
    const illustrator = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.st0{fill:#00ff00;stroke:navy}</style><rect class="st0" width="10" height="10"/></svg>`;
    const [pasted] = paste(doc, illustrator);
    expect(pasted?.hasAttribute("class")).toBe(false);
    expect(pasted?.getAttribute("fill")).toBe("rgb(0, 255, 0)");
    expect(pasted?.getAttribute("stroke")).toBe("rgb(0, 0, 128)");
    expect(doc.root.querySelector("style")).toBeNull();
  });

  it("quita scripts, manejadores de eventos y enlaces javascript:", () => {
    const doc = load(svg(""));
    const text = `<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pegado = true</script><a href="javascript:alert(1)"><rect width="5" height="5" onclick="window.__pegado = true"/></a></svg>`;
    paste(doc, text);
    const html = new XMLSerializer().serializeToString(doc.root);
    expect(html).not.toMatch(/script|onclick|javascript/);
    expect((window as unknown as { __pegado?: boolean }).__pegado).toBeUndefined();
  });

  it("centra lo pegado en el puntero", () => {
    const doc = load(svg(`<rect id="r" x="0" y="0" width="20" height="10"/>`));
    const pasted = paste(doc, copy(doc, "#r"), { x: 200, y: 150 });
    expect(selectionBounds(pasted, doc.root)).toMatchObject({
      x: 190,
      y: 145,
      width: 20,
      height: 10,
    });
  });

  it("dentro de un grupo transformado se ve donde estaba el original (más el desplazamiento)", () => {
    const doc = load(
      svg(
        `<rect id="r" x="30" y="40" width="20" height="10"/><g id="g" transform="translate(100 0) scale(2)"/>`,
      ),
    );
    const pasted = paste(doc, copy(doc, "#r"), null, pick(doc, "#g"));
    expect(pasted[0]?.parentElement?.id).toBe("g");
    const bounds = selectionBounds(pasted, doc.root);
    expect(bounds?.x).toBeCloseTo(40);
    expect(bounds?.y).toBeCloseTo(50);
    expect(bounds?.width).toBeCloseTo(20);
  });

  it("no pega lo que no es un SVG", () => {
    const doc = load(svg(""));
    expect(paste(doc, "hola")).toEqual([]);
    expect(paste(doc, "<html/>")).toEqual([]);
  });

  it("todo el pegado es un paso que se deshace", () => {
    const source = svg(
      `<defs>${GRADIENT}</defs><rect id="r" width="5" height="5" fill="url(#g)"/>`,
    );
    const other = load(svg(`<defs><linearGradient id="g"/></defs>`));
    const original = other.serialize();
    other.history.transact("paste", () => paste(other, copy(load(source), "#r")));
    other.history.undo();
    expect(other.serialize()).toBe(original);
  });
});

describe("duplicar y eliminar", () => {
  it("duplica encima del original, desplazado y con ids nuevos también por dentro", () => {
    const doc = load(
      svg(
        `<g id="g"><clipPath id="c"><rect width="5" height="5"/></clipPath><rect id="r" clip-path="url(#c)" width="9" height="9"/></g><circle id="otro"/>`,
      ),
    );
    const [copy] = duplicate([pick(doc, "#g")], doc);
    expect([...doc.root.children].map((child) => child.id)).toEqual(["g", "g-2", "otro"]);
    expect(copy?.querySelector("clipPath")?.id).toBe("c-2");
    expect(copy?.querySelector("rect[clip-path]")?.getAttribute("clip-path")).toBe("url(#c-2)");
    expect(copy?.getAttribute("transform")).toBe("translate(10 10)");
  });

  it("elimina y se deshace", () => {
    const source = svg(`<rect id="a"/><rect id="b"/>`);
    const doc = load(source);
    expect(doc.history.transact("delete", () => remove([pick(doc, "#a"), pick(doc, "#b")]))).toBe(
      2,
    );
    expect(doc.root.children).toHaveLength(0);
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });
});
