import { afterEach, describe, expect, it } from "vitest";
import { DocumentManager, type OpenDocument } from "../document";
import { boundsInRoot, isContainer, pickAt, selectionBounds, Selection } from ".";

const containers: HTMLElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((container) => {
    container.remove();
  });
});

const SOURCE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 200 150">
  <title>Prueba</title>
  <defs><linearGradient id="lg"><stop offset="0"/></linearGradient><rect id="en-defs" width="5" height="5"/></defs>
  <g id="capa">
    <rect id="fondo" width="200" height="150" fill="#eee"/>
    <g id="grupo" transform="translate(10 20)">
      <circle id="sol" cx="30" cy="30" r="10"/>
      <text id="texto" x="0" y="60">Hola <tspan id="tspan">mundo</tspan></text>
    </g>
  </g>
  <rect id="suelto" x="150" y="100" width="20" height="10" transform="rotate(90 160 105)"/>
</svg>`;

function open(source = SOURCE): OpenDocument {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const manager = new DocumentManager(container);
  manager.load("d1", "Prueba", source);
  manager.activate("d1");
  return manager.open("d1");
}

const byId = (doc: OpenDocument, id: string): Element => {
  const element = doc.document.root.querySelector(`#${id}`);
  if (!element) throw new Error(`No existe #${id}`);
  return element;
};

const pickedId = (doc: OpenDocument, id: string, scope?: string, deep = false) =>
  pickAt(byId(doc, id), doc.document.root, {
    scope: scope ? byId(doc, scope) : doc.document.root,
    deep,
  })?.element.id ?? null;

describe("qué se selecciona con un clic", () => {
  it("en el nivel superior, el hijo de la raíz que contiene el punto", () => {
    const doc = open();
    expect(pickedId(doc, "sol")).toBe("capa");
    expect(pickedId(doc, "suelto")).toBe("suelto");
  });

  it("dentro de un grupo, el hijo del grupo", () => {
    const doc = open();
    expect(pickedId(doc, "sol", "capa")).toBe("grupo");
    expect(pickedId(doc, "sol", "grupo")).toBe("sol");
  });

  it("fuera del grupo actual, sube hasta el antepasado común", () => {
    const doc = open();
    const pick = pickAt(byId(doc, "fondo"), doc.document.root, { scope: byId(doc, "grupo") });
    expect(pick?.element.id).toBe("fondo");
    expect(pick?.scope.id).toBe("capa");
    expect(pickedId(doc, "suelto", "grupo")).toBe("suelto");
  });

  it("con Ctrl, el elemento más profundo; el texto se selecciona entero", () => {
    const doc = open();
    expect(pickedId(doc, "sol", undefined, true)).toBe("sol");
    expect(pickedId(doc, "tspan", undefined, true)).toBe("texto");
    expect(pickedId(doc, "tspan", "grupo")).toBe("texto");
  });

  it("entra en un svg anidado como en un grupo", () => {
    const doc = open(
      `<svg xmlns="http://www.w3.org/2000/svg"><svg id="anidado" width="10" height="10"><rect id="r" width="5" height="5"/></svg></svg>`,
    );
    expect(pickedId(doc, "r")).toBe("anidado");
    expect(pickedId(doc, "r", "anidado")).toBe("r");
  });

  it("nunca selecciona metadatos, definiciones, animaciones ni la raíz", () => {
    const doc = open();
    expect(pickedId(doc, "en-defs")).toBeNull();
    expect(pickAt(doc.document.root.querySelector("title"), doc.document.root)).toBeNull();
    expect(pickAt(doc.document.root, doc.document.root)).toBeNull();
    expect(pickAt(document.body, doc.document.root)).toBeNull();
  });
});

describe("estado de la selección", () => {
  it("ordena los elementos según el documento y avisa solo si cambia", () => {
    const doc = open();
    const changes: string[][] = [];
    const selection = new Selection(doc.document.root, (state) =>
      changes.push(state.items.map((item) => item.id)),
    );
    selection.set([byId(doc, "suelto"), byId(doc, "capa")]);
    selection.set([byId(doc, "capa"), byId(doc, "suelto")]);
    selection.toggle(byId(doc, "capa"));
    selection.toggle(byId(doc, "capa"));
    expect(changes).toEqual([["capa", "suelto"], ["suelto"], ["capa", "suelto"]]);
  });

  it("entra en grupos, selecciona todo dentro y sale con Esc", () => {
    const doc = open();
    const { selection } = doc;
    expect(selection.enter(byId(doc, "sol"))).toBe(false);
    expect(selection.enter(byId(doc, "capa"))).toBe(true);
    expect(selection.enter(byId(doc, "grupo"))).toBe(true);
    selection.selectAll();
    expect(selection.items.map((item) => item.id)).toEqual(["sol", "texto"]);

    expect(selection.escape()).toBe(true);
    expect(selection.state).toMatchObject({ items: [], scope: byId(doc, "grupo") });
    expect(selection.escape()).toBe(true);
    expect(selection.state).toEqual({ items: [byId(doc, "grupo")], scope: byId(doc, "capa") });
    selection.escape();
    selection.escape();
    expect(selection.state).toEqual({ items: [byId(doc, "capa")], scope: null });
    selection.escape();
    expect(selection.escape()).toBe(false);
  });

  it("en el nivel superior, seleccionar todo no incluye metadatos ni definiciones", () => {
    const doc = open();
    doc.selection.selectAll();
    expect(doc.selection.items.map((item) => item.id)).toEqual(["capa", "suelto"]);
  });

  it("al deshacer la creación de un elemento seleccionado, deja de estar seleccionado", () => {
    const doc = open();
    const { document: svg, selection } = doc;
    const created = svg.history.transact("create", () => {
      const rect = window.document.createElementNS("http://www.w3.org/2000/svg", "rect");
      svg.root.append(rect);
      return rect;
    });
    selection.enter(byId(doc, "capa"));
    selection.set([created], svg.root);
    selection.enter(byId(doc, "grupo"));
    selection.set([created, byId(doc, "sol")]);

    svg.history.undo();

    expect(selection.items.map((item) => item.id)).toEqual(["sol"]);
  });
});

describe("medidas", () => {
  it("da la caja en unidades del viewBox, con transformaciones", () => {
    const doc = open();
    const root = doc.document.root;
    const sun = boundsInRoot(byId(doc, "sol"), root);
    expect([sun?.x, sun?.y, sun?.width, sun?.height].map((v) => Math.round(v ?? NaN))).toEqual([
      30, 40, 20, 20,
    ]);
    const rotated = boundsInRoot(byId(doc, "suelto"), root);
    expect(rotated?.x).toBeCloseTo(155);
    expect(rotated?.y).toBeCloseTo(95);
    expect(rotated?.width).toBeCloseTo(10);
    expect(rotated?.height).toBeCloseTo(20);
    const all = selectionBounds([byId(doc, "sol"), byId(doc, "fondo")], root);
    expect(all?.x).toBeCloseTo(0);
    expect(all?.y).toBeCloseTo(0);
    expect(all?.width).toBeCloseTo(200);
    expect(all?.height).toBeCloseTo(150);
    expect(selectionBounds([], root)).toBeNull();
  });
});

describe("corpus: cualquier elemento se alcanza entrando en sus grupos", () => {
  const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it.each(Object.entries(files).map(([path, source]) => [path.replace(/^.*corpus\//, ""), source]))(
    "%s",
    (_name, source) => {
      const doc = open(source);
      const root = doc.document.root;
      const leaves = [...root.querySelectorAll("*")].filter(
        (element) =>
          !isContainer(element) && pickAt(element, root, { deep: true })?.element === element,
      );
      for (const leaf of leaves) {
        // Doble clic tras doble clic, como haría el usuario, hasta llegar al elemento.
        let scope: Element = root;
        for (let depth = 0; depth < 50; depth++) {
          const pick = pickAt(leaf, root, { scope });
          expect(pick).not.toBeNull();
          if (!pick || pick.element === leaf) break;
          expect(isContainer(pick.element)).toBe(true);
          scope = pick.element;
        }
        expect(pickAt(leaf, root, { scope })?.element).toBe(leaf);
      }
      // Seleccionar no cambia el documento: la capa de superposición está fuera de él.
      doc.selection.selectAll();
      expect(doc.document.serialize()).toBe(source);
    },
  );
});
