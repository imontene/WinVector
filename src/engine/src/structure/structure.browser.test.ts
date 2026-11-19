import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document";
import { isContainer, selectableChildren } from "../selection";
import { elementToRoot } from "../transform";
import { arrange, computedInherited, group, ungroup, ungroupBlocker } from ".";

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
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">${body}</svg>`;

function pick(root: SVGSVGElement, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`No existe ${selector}`);
  return element;
}

const ids = (elements: Iterable<Element>) =>
  [...elements].map((element) => element.id || element.localName);

/** Lo que determina cómo se ve cada elemento que no es un grupo: su matriz y sus estilos. */
function appearance(root: SVGSVGElement): Map<Element, string> {
  const result = new Map<Element, string>();
  for (const element of root.querySelectorAll("*")) {
    if (isContainer(element) || !(element instanceof SVGGraphicsElement)) continue;
    if (element.closest("defs, clipPath, mask, pattern, marker, symbol")) continue;
    const m = elementToRoot(element, root);
    if (!m) continue;
    const matrix = [m.a, m.b, m.c, m.d, m.e, m.f]
      .map((v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3))
      .join(" ");
    const style = [...computedInherited(element)].map(([k, v]) => `${k}:${v}`).join(";");
    result.set(element, `${matrix}|${style}`);
  }
  return result;
}

function expectSameAppearance(before: Map<Element, string>, root: SVGSVGElement): void {
  const after = appearance(root);
  for (const [element, value] of before) {
    expect(after.get(element), element.outerHTML.slice(0, 80)).toBe(value);
  }
}

describe("orden de apilado", () => {
  const source = svg(
    `<title>t</title><defs/><rect id="a"/><rect id="b"/><rect id="c"/><rect id="d"/><metadata/>`,
  );
  const order = (doc: SvgDocument) => ids(selectableChildren(doc.root));
  const byIds = (doc: SvgDocument, ...names: string[]) =>
    names.map((name) => pick(doc.root, `#${name}`));

  it.each([
    ["front", ["b"], ["a", "c", "d", "b"]],
    ["front", ["a", "c"], ["b", "d", "a", "c"]],
    ["back", ["c"], ["c", "a", "b", "d"]],
    ["back", ["b", "d"], ["b", "d", "a", "c"]],
    ["forward", ["b"], ["a", "c", "b", "d"]],
    ["forward", ["a", "b"], ["c", "a", "b", "d"]],
    ["forward", ["d"], ["a", "b", "c", "d"]],
    ["backward", ["c"], ["a", "c", "b", "d"]],
    ["backward", ["a", "c"], ["a", "c", "b", "d"]],
  ] as const)("%s con %j da %j", (action, selected, expected) => {
    const doc = load(source);
    const changed = arrange(byIds(doc, ...selected), action);
    expect(order(doc)).toEqual(expected);
    expect(changed).toBe(expected.join() !== "a,b,c,d");
  });

  it("al fondo deja los metadatos y las definiciones en su sitio", () => {
    const doc = load(source);
    arrange(byIds(doc, "d"), "back");
    expect(ids(doc.root.children)).toEqual(["title", "defs", "d", "a", "b", "c", "metadata"]);
  });
});

describe("agrupar y desagrupar", () => {
  it("agrupa en el lugar del elemento de más arriba y se deshace en un paso", () => {
    const source = svg(`<rect id="a"/><circle id="b"/><path id="c"/>`);
    const doc = load(source);
    const g = doc.history.transact("group", () =>
      group([pick(doc.root, "#c"), pick(doc.root, "#a")], doc.root),
    );
    expect(ids(doc.root.children)).toEqual(["b", "g"]);
    expect(ids(g?.children ?? [])).toEqual(["a", "c"]);
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });

  it("desagrupar pasa la transformación y los estilos del grupo a los hijos", () => {
    const doc = load(
      svg(
        `<g id="g" transform="translate(10 20) rotate(30)" fill="red" font-size="20" stroke-width="3"><rect id="r" width="10" height="10"/><text id="t" fill="blue">Hola</text><g id="h" transform="scale(2)"><circle id="c" r="5"/></g></g>`,
      ),
    );
    const before = appearance(doc.root);
    const released = ungroup([pick(doc.root, "#g")], doc.root);
    expect(ids(released)).toEqual(["r", "t", "h"]);
    expect(doc.root.querySelector("#g")).toBeNull();
    expectSameAppearance(before, doc.root);
    expect(doc.root.querySelector("#t")?.getAttribute("fill")).toBe("blue");
  });

  it("los estilos que venían de una hoja de estilos para el grupo se conservan", () => {
    const doc = load(
      svg(
        `<style>.capa { fill: rgb(0, 128, 0); font-family: serif }</style><g id="g" class="capa"><rect id="r" width="10" height="10"/></g>`,
      ),
    );
    const before = appearance(doc.root);
    ungroup([pick(doc.root, "#g")], doc.root);
    expectSameAppearance(before, doc.root);
  });

  it("agrupar elementos de padres distintos conserva su aspecto", () => {
    const doc = load(
      svg(
        `<g transform="translate(50 0) scale(1.5)" stroke="green"><rect id="a" width="10" height="10"/></g><g transform="rotate(20)" fill="orange"><circle id="b" r="4"/></g>`,
      ),
    );
    const before = appearance(doc.root);
    const g = group([pick(doc.root, "#a"), pick(doc.root, "#b")], doc.root);
    expect(g?.parentElement?.getAttribute("transform")).toBe("rotate(20)");
    expectSameAppearance(before, doc.root);
  });

  it("no desagrupa lo que cambiaría de aspecto", () => {
    const doc = load(
      svg(
        `<defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><g id="o" opacity="0.5"><rect/></g><g id="c" clip-path="url(#clip)"><rect/></g><g id="u"><rect/></g><use href="#u"/><rect id="r"/>`,
      ),
    );
    const byId = (id: string) => pick(doc.root, `#${id}`);
    expect(ungroupBlocker(byId("o"), doc.root)).toBe("effects");
    expect(ungroupBlocker(byId("c"), doc.root)).toBe("effects");
    expect(ungroupBlocker(byId("u"), doc.root)).toBe("referenced");
    expect(ungroupBlocker(byId("r"), doc.root)).toBe("not-a-group");
    expect(ungroup([byId("o"), byId("c"), byId("u")], doc.root)).toEqual([]);
  });
});

describe("corpus: agrupar y desagrupar no cambian el aspecto y se deshacen", () => {
  const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it.each(Object.entries(files).map(([path, source]) => [path.replace(/^.*corpus\//, ""), source]))(
    "%s",
    (_name, source) => {
      const doc = load(source);
      const before = appearance(doc.root);
      const children = selectableChildren(doc.root);
      if (children.length >= 2) {
        doc.history.transact("group", () => group(children, doc.root));
        expectSameAppearance(before, doc.root);
      }
      const groups = [...doc.root.querySelectorAll("g")];
      doc.history.transact("ungroup", () => ungroup(groups, doc.root));
      expectSameAppearance(before, doc.root);
      while (doc.history.undo());
      expect(doc.serialize()).toBe(source);
    },
  );
});
