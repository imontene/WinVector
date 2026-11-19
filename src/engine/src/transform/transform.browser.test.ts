import { afterEach, describe, expect, it } from "vitest";
import { applyToPoint, corners, multiply, type Matrix, type Point } from "../geometry";
import { SvgDocument } from "../document";
import { localBox, selectableChildren, selectionBounds } from "../selection";
import {
  applyTransform,
  elementToRoot,
  moveBy,
  rotateAround,
  rotationOf,
  scaleAround,
  setGeometry,
  TransformSession,
  type GeometryTarget,
} from ".";

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

function byId(doc: SvgDocument, id: string): Element {
  const element = doc.root.querySelector(`#${id}`);
  if (!element) throw new Error(`No existe #${id}`);
  return element;
}

/** Esquinas de la caja del elemento en unidades del documento, ordenadas para compararlas. */
function rootCorners(element: Element, root: SVGSVGElement): Point[] {
  const box = localBox(element);
  const m = elementToRoot(element, root);
  if (!box || !m) throw new Error("No se puede medir");
  return sortPoints(corners(box).map((p) => applyToPoint(m, p)));
}

const sortPoints = (points: Point[]) =>
  [...points].sort((p, q) => (Math.abs(p.x - q.x) > 1e-6 ? p.x - q.x : p.y - q.y));

function expectTransformed(doc: SvgDocument, element: Element, m: Matrix): void {
  const boxBefore = localBox(element);
  const isText = element.localName === "text";
  const [xBefore, yBefore] = [element.getAttribute("x"), element.getAttribute("y")];
  const matrixBefore = elementToRoot(element, doc.root);
  if (!boxBefore || !matrixBefore) throw new Error("No se puede medir");
  const before = rootCorners(element, doc.root).map((p) => applyToPoint(m, p));
  expect(applyTransform(element, m, doc.root)).toBe(true);
  const boxAfter = localBox(element);
  const rewroteText =
    isText && (element.getAttribute("x") !== xBefore || element.getAttribute("y") !== yBefore);
  const unchangedGeometry =
    (isText && !rewroteText) ||
    (boxAfter !== null &&
      (["x", "y", "width", "height"] as const).every(
        (key) => Math.abs(boxAfter[key] - boxBefore[key]) < 1e-6,
      ));
  if (unchangedGeometry) {
    // Solo ha cambiado transform: se comparan las matrices, exactas incluso con texto (cuya caja
    // medida no escala de forma lineal con el tamaño de letra).
    const expected = multiply(m, matrixBefore);
    const after = elementToRoot(element, doc.root);
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(after?.[key]).toBeCloseTo(expected[key], 4);
    }
    return;
  }
  if (rewroteText) {
    // La caja medida de un texto depende de las fuentes instaladas (y de los emojis): un texto
    // movido con sus atributos se comprueba en ellos. Solo se mueve así, sin escalar ni girar.
    expect(Number(element.getAttribute("x"))).toBeCloseTo(m.a * Number(xBefore ?? 0) + m.e, 4);
    expect(Number(element.getAttribute("y"))).toBeCloseTo(m.d * Number(yBefore ?? 0) + m.f, 4);
    return;
  }
  const after = rootCorners(element, doc.root);
  const expected = sortPoints(before);
  // El navegador ajusta los glifos de un texto a la rejilla de píxeles: su caja medida puede variar
  // hasta un cuarto de unidad al moverlo. Moverlo cambia x e y exactamente en el desplazamiento.
  const precision = element.localName === "text" || element.querySelector("text") ? 0 : 2;
  after.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]?.x ?? NaN, precision);
    expect(point.y).toBeCloseTo(expected[index]?.y ?? NaN, precision);
  });
}

describe("aplicar transformaciones", () => {
  it("mover un rect sin transform cambia x e y", () => {
    const doc = load(svg(`<rect id="r" x="10" y="20" width="30" height="40"/>`));
    const rect = byId(doc, "r");
    expectTransformed(doc, rect, moveBy(5.5, -3));
    expect(rect.getAttribute("x")).toBe("15.5");
    expect(rect.getAttribute("y")).toBe("17");
    expect(rect.hasAttribute("transform")).toBe(false);
  });

  it("escalar un rect sin girar cambia su posición y su tamaño, también rx y ry", () => {
    const doc = load(svg(`<rect id="r" x="10" y="20" width="30" height="40" rx="4"/>`));
    const rect = byId(doc, "r");
    expectTransformed(doc, rect, scaleAround(2, 0.5, { x: 10, y: 20 }));
    expect([...["x", "y", "width", "height", "rx", "ry"].map((n) => rect.getAttribute(n))]).toEqual(
      ["10", "20", "60", "20", "8", "2"],
    );
    expect(rect.hasAttribute("transform")).toBe(false);
  });

  it("girar o voltear escribe transform", () => {
    const doc = load(
      svg(`<rect id="r" x="10" y="20" width="30" height="40"/><rect id="f" width="5" height="5"/>`),
    );
    expectTransformed(doc, byId(doc, "r"), rotateAround(30, { x: 25, y: 40 }));
    expect(byId(doc, "r").getAttribute("transform")).toMatch(/^matrix\(/);
    expectTransformed(doc, byId(doc, "f"), scaleAround(-1, 1, { x: 2.5, y: 0 }));
    expect(byId(doc, "f").hasAttribute("transform")).toBe(true);
  });

  it("un círculo solo cambia r si la escala es igual en los dos ejes", () => {
    const doc = load(
      svg(`<circle id="c" cx="50" cy="50" r="10"/><circle id="d" cx="50" cy="50" r="10"/>`),
    );
    expectTransformed(doc, byId(doc, "c"), scaleAround(3, 3, { x: 40, y: 40 }));
    expect(byId(doc, "c").getAttribute("r")).toBe("30");
    expectTransformed(doc, byId(doc, "d"), scaleAround(3, 1, { x: 40, y: 40 }));
    expect(byId(doc, "d").getAttribute("r")).toBe("10");
    expect(byId(doc, "d").hasAttribute("transform")).toBe(true);
  });

  it("mover una línea cambia sus dos extremos", () => {
    const doc = load(svg(`<line id="l" x1="0" y1="0" x2="10" y2="5" stroke="black"/>`));
    const line = byId(doc, "l");
    applyTransform(line, moveBy(1, 2), doc.root);
    expect(["x1", "y1", "x2", "y2"].map((n) => line.getAttribute(n))).toEqual([
      "1",
      "2",
      "11",
      "7",
    ]);
  });

  it("un trazado, un grupo o un elemento con unidades usan transform", () => {
    const doc = load(
      svg(
        `<path id="p" d="M0 0 L10 10"/><g id="g"><rect width="5" height="5"/></g><rect id="u" x="1mm" width="5" height="5"/>`,
      ),
    );
    for (const id of ["p", "g", "u"]) {
      expectTransformed(doc, byId(doc, id), moveBy(4, 6));
      expect(byId(doc, id).getAttribute("transform")).toBe("translate(4 6)");
    }
    expect(byId(doc, "u").getAttribute("x")).toBe("1mm");
  });

  it("un texto con tspan colocados se mueve con transform; uno simple, con x e y", () => {
    const doc = load(
      svg(
        `<text id="a" x="5" y="10">Hola</text><text id="b" x="5" y="10">a<tspan x="20">b</tspan></text>`,
      ),
    );
    applyTransform(byId(doc, "a"), moveBy(1, 1), doc.root);
    applyTransform(byId(doc, "b"), moveBy(1, 1), doc.root);
    expect(byId(doc, "a").getAttribute("x")).toBe("6");
    expect(byId(doc, "b").getAttribute("transform")).toBe("translate(1 1)");
    const onPath = load(
      svg(
        `<defs><path id="c" d="M0 50 Q50 0 100 50"/></defs><text id="t"><textPath href="#c">Curva</textPath></text>`,
      ),
    );
    applyTransform(byId(onPath, "t"), moveBy(10, 0), onPath.root);
    expect(byId(onPath, "t").getAttribute("transform")).toBe("translate(10 0)");
  });

  it("con un transform previo, lo compone", () => {
    const doc = load(svg(`<rect id="r" width="20" height="10" transform="rotate(30 10 5)"/>`));
    expectTransformed(doc, byId(doc, "r"), moveBy(10, 0));
    expectTransformed(doc, byId(doc, "r"), scaleAround(2, 2, { x: 0, y: 0 }));
    expect(rotationOf(byId(doc, "r"), doc.root)).toBeCloseTo(30);
  });

  it("dentro de un grupo transformado, el cambio se ve en las coordenadas del documento", () => {
    const doc = load(
      svg(
        `<g transform="translate(50 50) scale(2) rotate(20)"><g transform="skewX(10)"><rect id="r" x="1" y="2" width="10" height="5"/></g></g>`,
      ),
    );
    expectTransformed(doc, byId(doc, "r"), moveBy(10, -5));
    expectTransformed(doc, byId(doc, "r"), scaleAround(1.5, 0.5, { x: 60, y: 60 }));
    expectTransformed(doc, byId(doc, "r"), rotateAround(45, { x: 60, y: 60 }));
  });

  it("da el giro de un elemento respecto al documento", () => {
    const doc = load(
      svg(
        `<g transform="rotate(10)"><rect id="r" width="1" height="1" transform="rotate(-40)"/></g>`,
      ),
    );
    expect(rotationOf(byId(doc, "r"), doc.root)).toBeCloseTo(-30);
  });
});

describe("transformación continua", () => {
  it("todo el gesto es un paso y deshacerlo devuelve el texto original", () => {
    const source = svg(
      `<rect id="r" x="10" y="20" width="30" height="40"/><circle id="c" cx="5" cy="5" r="2"/>`,
    );
    const doc = load(source);
    const items = [byId(doc, "r"), byId(doc, "c")];
    const session = new TransformSession(items, doc.root, doc.history, "move");
    for (let i = 1; i <= 20; i++) session.update(moveBy(i * 0.7, i));
    session.commit();
    expect(byId(doc, "r").getAttribute("x")).toBe("24");
    expect(doc.history.state.undoAction).toBe("move");
    doc.history.undo();
    expect(doc.history.state.canUndo).toBe(false);
    expect(doc.serialize()).toBe(source);
  });

  it("cancelar no deja ningún paso", () => {
    const source = svg(`<rect id="r" x="10" y="20" width="30" height="40"/>`);
    const doc = load(source);
    const session = new TransformSession([byId(doc, "r")], doc.root, doc.history, "rotate");
    session.update(rotateAround(45, { x: 0, y: 0 }));
    session.cancel();
    expect(doc.history.state.canUndo).toBe(false);
    expect(doc.serialize()).toBe(source);
  });

  it("no transforma dos veces un elemento dentro de un grupo seleccionado", () => {
    const doc = load(svg(`<g id="g"><rect id="r" x="0" y="0" width="5" height="5"/></g>`));
    const session = new TransformSession(
      [byId(doc, "g"), byId(doc, "r")],
      doc.root,
      doc.history,
      "move",
    );
    session.update(moveBy(3, 0));
    session.commit();
    expect(byId(doc, "g").getAttribute("transform")).toBe("translate(3 0)");
    expect(byId(doc, "r").getAttribute("x")).toBe("0");
  });
});

describe("corpus: mover, escalar y girar cada objeto da lo esperado y se deshace", () => {
  const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it.each(Object.entries(files).map(([path, source]) => [path.replace(/^.*corpus\//, ""), source]))(
    "%s",
    (_name, source) => {
      const doc = load(source);
      const items = selectableChildren(doc.root)
        .filter((item) => {
          const box = localBox(item);
          return box !== null && box.width > 0 && box.height > 0 && elementToRoot(item, doc.root);
        })
        .slice(0, 5);
      for (const item of items) {
        for (const m of [
          moveBy(7, -3),
          scaleAround(1.5, 0.75, { x: 10, y: 10 }),
          rotateAround(30, { x: 5, y: 5 }),
        ]) {
          doc.history.transact("prueba", () => {
            expectTransformed(doc, item, m);
          });
        }
      }
      while (doc.history.undo());
      expect(doc.serialize()).toBe(source);
    },
  );
});

describe("posición, tamaño y giro exactos", () => {
  const target = (values: Partial<GeometryTarget>): GeometryTarget => ({
    x: null,
    y: null,
    width: null,
    height: null,
    rotation: null,
    ...values,
  });

  it("mueve y redimensiona la caja de la selección", () => {
    const doc = load(
      svg(
        `<rect id="a" x="10" y="20" width="30" height="40"/><rect id="b" x="50" y="20" width="10" height="10"/>`,
      ),
    );
    const items = [byId(doc, "a"), byId(doc, "b")];
    expect(setGeometry(items, doc.root, doc.history, target({ x: 0, width: 100 }))).toBe(true);
    const bounds = selectionBounds(items, doc.root);
    expect(bounds?.x).toBeCloseTo(0);
    expect(bounds?.y).toBeCloseTo(20);
    expect(bounds?.width).toBeCloseTo(100);
    expect(bounds?.height).toBeCloseTo(40);
    expect(doc.history.state.undoAction).toBe("scale");
  });

  it("solo mover se llama mover, y un valor igual no cambia nada", () => {
    const source = svg(`<rect id="a" x="10" y="20" width="30" height="40"/>`);
    const doc = load(source);
    const items = [byId(doc, "a")];
    expect(setGeometry(items, doc.root, doc.history, target({ x: 10, width: 30 }))).toBe(false);
    setGeometry(items, doc.root, doc.history, target({ y: 0 }));
    expect(byId(doc, "a").getAttribute("y")).toBe("0");
    expect(doc.history.state.undoAction).toBe("move");
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });

  it("gira un único objeto alrededor de su centro hasta el ángulo pedido", () => {
    const doc = load(
      svg(`<rect id="a" x="10" y="20" width="30" height="40" transform="rotate(10 25 40)"/>`),
    );
    const rect = byId(doc, "a");
    setGeometry([rect], doc.root, doc.history, target({ rotation: -80 }));
    expect(rotationOf(rect, doc.root)).toBeCloseTo(-80);
    expect(doc.history.state.undoAction).toBe("rotate");
  });

  it("con varios objetos no gira", () => {
    const doc = load(
      svg(`<rect id="a" width="5" height="5"/><rect id="b" x="10" width="5" height="5"/>`),
    );
    expect(
      setGeometry(
        [byId(doc, "a"), byId(doc, "b")],
        doc.root,
        doc.history,
        target({ rotation: 45 }),
      ),
    ).toBe(false);
  });
});
