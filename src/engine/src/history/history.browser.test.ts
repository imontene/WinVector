import { afterEach, describe, expect, it } from "vitest";
import { SVG_NS, SvgDocument } from "../document/svgDocument";
import type { HistoryState } from "./history";

/**
 * El historial trabaja sobre el DOM real del documento (MutationObserver), así que sus pruebas se
 * ejecutan en Chromium.
 */

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

interface Loaded {
  readonly doc: SvgDocument;
  readonly states: HistoryState[];
  readonly revisions: number[];
}

function load(source: string): Loaded {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const states: HistoryState[] = [];
  const revisions: number[] = [];
  const doc = SvgDocument.load(source, host, {
    onChange: (revision) => revisions.push(revision),
    onHistoryChange: (state) => states.push(state),
  });
  return { doc, states, revisions };
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`;

const SOURCE = svg(
  `\n  <g id="g">\n    <rect id="a"  x="1" y='2'   width="3"/>\n    <text id="t">hola &amp; adiós</text>\n  </g>\n  <use id="u" xlink:href="#a"/>\n`,
);

function byId(doc: SvgDocument, id: string): Element {
  const element = doc.root.querySelector(`#${id}`);
  if (!element) throw new Error(`No existe #${id}`);
  return element;
}

function undoAll(doc: SvgDocument): number {
  let steps = 0;
  while (doc.history.undo()) steps++;
  return steps;
}

describe("historial", () => {
  it("empieza vacío", () => {
    const { doc } = load(SOURCE);
    expect(doc.history.state).toEqual({
      canUndo: false,
      canRedo: false,
      undoAction: null,
      redoAction: null,
    });
    expect(doc.history.undo()).toBe(false);
    expect(doc.history.redo()).toBe(false);
  });

  it("deshace y rehace un cambio de atributo", () => {
    const { doc } = load(SOURCE);
    doc.history.transact("move", () => {
      byId(doc, "a").setAttribute("x", "10");
    });
    expect(doc.history.state).toMatchObject({ canUndo: true, undoAction: "move" });

    expect(doc.history.undo()).toBe(true);
    expect(byId(doc, "a").getAttribute("x")).toBe("1");
    expect(doc.history.state).toMatchObject({ canUndo: false, canRedo: true, redoAction: "move" });

    expect(doc.history.redo()).toBe(true);
    expect(byId(doc, "a").getAttribute("x")).toBe("10");
    expect(doc.history.state).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("agrupa en un paso todos los cambios de una transacción", () => {
    const { doc } = load(SOURCE);
    doc.history.begin("move");
    for (let x = 2; x <= 50; x++) byId(doc, "a").setAttribute("x", String(x));
    byId(doc, "a").setAttribute("y", "7");
    doc.history.commit();

    expect(doc.history.undo()).toBe(true);
    expect(doc.history.state.canUndo).toBe(false);
    expect(doc.serialize()).toBe(SOURCE);
  });

  it("anida transacciones: solo cuenta la exterior", () => {
    const { doc } = load(SOURCE);
    doc.history.transact("group", () => {
      doc.history.transact("move", () => {
        byId(doc, "a").setAttribute("x", "9");
      });
      byId(doc, "t").remove();
    });
    expect(doc.history.state.undoAction).toBe("group");
    doc.history.undo();
    expect(doc.history.state.canUndo).toBe(false);
    expect(doc.serialize()).toBe(SOURCE);
  });

  it("los cambios fuera de una transacción forman un paso por lote", async () => {
    const { doc } = load(SOURCE);
    byId(doc, "a").setAttribute("x", "5");
    byId(doc, "a").setAttribute("y", "6");
    await Promise.resolve();
    byId(doc, "a").setAttribute("width", "7");
    expect(doc.history.state.undoAction).toBe("edit");
    expect(undoAll(doc)).toBe(2);
    expect(doc.serialize()).toBe(SOURCE);
  });

  it("deshace la creación, el borrado y el movimiento de nodos", () => {
    const { doc } = load(SOURCE);
    const group = byId(doc, "g");
    doc.history.transact("create", () => {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "4");
      group.insertBefore(circle, byId(doc, "t"));
    });
    doc.history.transact("delete", () => {
      byId(doc, "u").remove();
    });
    doc.history.transact("reorder", () => {
      group.append(byId(doc, "a"));
    });
    doc.history.transact("ungroup", () => {
      group.replaceWith(...group.childNodes);
    });
    const edited = doc.serialize();

    expect(undoAll(doc)).toBe(4);
    expect(doc.serialize()).toBe(SOURCE);

    while (doc.history.redo());
    expect(doc.serialize()).toBe(edited);
  });

  it("deshace cambios de texto y de atributos con espacio de nombres", () => {
    const { doc } = load(SOURCE);
    doc.history.transact("text", () => {
      const text = byId(doc, "t").firstChild as Text;
      text.data = "adiós";
      text.appendData(" <mundo>");
      byId(doc, "u").setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#t");
      byId(doc, "a").removeAttribute("y");
      byId(doc, "a").setAttribute("fill", "red");
    });
    expect(doc.serialize()).toContain(`<text id="t">adiós &lt;mundo&gt;</text>`);

    doc.history.undo();
    expect(doc.serialize()).toBe(SOURCE);
    doc.history.redo();
    expect(byId(doc, "u").getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#t");
    expect(byId(doc, "u").getAttributeNode("xlink:href")?.prefix).toBe("xlink");
    expect(byId(doc, "a").hasAttribute("y")).toBe(false);
  });

  it("un cambio nuevo vacía la pila de rehacer", () => {
    const { doc } = load(SOURCE);
    doc.history.transact("a", () => {
      byId(doc, "a").setAttribute("x", "2");
    });
    doc.history.transact("b", () => {
      byId(doc, "a").setAttribute("x", "3");
    });
    doc.history.undo();
    expect(doc.history.state.canRedo).toBe(true);
    doc.history.transact("c", () => {
      byId(doc, "a").setAttribute("x", "4");
    });
    expect(doc.history.state).toMatchObject({ canRedo: false, undoAction: "c" });
    doc.history.undo();
    expect(byId(doc, "a").getAttribute("x")).toBe("2");
  });

  it("funde los pasos seguidos con la misma clave", () => {
    const { doc } = load(SOURCE);
    for (const width of ["30", "300", "3000"]) {
      doc.history.transact(
        "resize",
        () => {
          byId(doc, "a").setAttribute("width", width);
        },
        "width:a",
      );
    }
    doc.history.transact("move", () => {
      byId(doc, "a").setAttribute("x", "8");
    });
    doc.history.transact(
      "resize",
      () => {
        byId(doc, "a").setAttribute("width", "4");
      },
      "width:a",
    );

    expect(undoAll(doc)).toBe(3);
    expect(doc.serialize()).toBe(SOURCE);
  });

  it("no funde con un paso deshecho y rehecho", () => {
    const { doc } = load(SOURCE);
    doc.history.transact(
      "resize",
      () => {
        byId(doc, "a").setAttribute("width", "5");
      },
      "w",
    );
    doc.history.undo();
    doc.history.redo();
    doc.history.transact(
      "resize",
      () => {
        byId(doc, "a").setAttribute("width", "6");
      },
      "w",
    );
    expect(undoAll(doc)).toBe(2);
  });

  it("un paso que no cambia nada no se guarda", () => {
    const { doc, states } = load(SOURCE);
    doc.history.transact("move", () => {
      byId(doc, "a").setAttribute("x", "50");
      byId(doc, "a").setAttribute("x", "1");
    });
    doc.history.transact("noop", () => undefined);
    expect(doc.history.state.canUndo).toBe(false);
    expect(states).toEqual([]);
    expect(doc.revision).toBe(0);
  });

  it("al deshacer recupera la revisión de cada estado", () => {
    const { doc, revisions } = load(SOURCE);
    doc.history.transact("a", () => {
      byId(doc, "a").setAttribute("x", "2");
    });
    const saved = doc.revision;
    doc.history.transact("b", () => {
      byId(doc, "a").setAttribute("x", "3");
    });
    const edited = doc.revision;
    expect(new Set([0, saved, edited]).size).toBe(3);

    doc.history.undo();
    expect(doc.revision).toBe(saved);
    doc.history.undo();
    expect(doc.revision).toBe(0);
    doc.history.redo();
    doc.history.redo();
    expect(doc.revision).toBe(edited);
    expect(revisions.at(-1)).toBe(edited);

    // Una edición nueva tras deshacer nunca reutiliza una revisión anterior.
    doc.history.undo();
    doc.history.transact("c", () => {
      byId(doc, "a").setAttribute("x", "4");
    });
    expect([0, saved, edited]).not.toContain(doc.revision);
  });

  it("deshacer cierra una transacción abierta", () => {
    const { doc } = load(SOURCE);
    doc.history.begin("drag");
    byId(doc, "a").setAttribute("x", "9");
    expect(doc.history.undo()).toBe(true);
    expect(byId(doc, "a").getAttribute("x")).toBe("1");
    doc.history.commit();
    expect(doc.history.state).toMatchObject({ canUndo: false, canRedo: true });
  });

  it("anular una acción deshace sus cambios sin dejar ningún paso", () => {
    const { doc, states } = load(SOURCE);
    const before = doc.serialize();
    doc.history.begin("create-rectangle");
    const created = doc.root.ownerDocument.createElementNS(SVG_NS, "rect");
    created.setAttribute("width", "10");
    doc.root.append(created);
    created.setAttribute("width", "20");
    byId(doc, "a").setAttribute("x", "7");
    doc.history.rollback();

    expect(created.isConnected).toBe(false);
    expect(byId(doc, "a").getAttribute("x")).toBe("1");
    expect(doc.history.state.canUndo).toBe(false);
    expect(states).toEqual([]);
    expect(doc.revision).toBe(0);
    expect(doc.serialize()).toBe(before);
  });

  it("anular sin acción abierta no hace nada", () => {
    const { doc } = load(SOURCE);
    doc.history.transact("move", () => {
      byId(doc, "a").setAttribute("x", "5");
    });
    doc.history.rollback();
    expect(doc.history.state).toMatchObject({ canUndo: true, undoAction: "move" });
    expect(byId(doc, "a").getAttribute("x")).toBe("5");
  });

  it("avisa de cada cambio del historial", () => {
    const { doc, states } = load(SOURCE);
    doc.history.transact("move", () => {
      byId(doc, "a").setAttribute("x", "2");
    });
    doc.history.undo();
    doc.history.redo();
    expect(states.map((s) => [s.undoAction, s.redoAction])).toEqual([
      ["move", null],
      [null, "move"],
      ["move", null],
    ]);
  });

  it("tras muchas ediciones al azar, deshacer todo devuelve el texto original", () => {
    const { doc } = load(SOURCE);
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const snapshots: string[] = [doc.serialize()];
    for (let step = 0; step < 200; step++) {
      doc.history.transact(`step-${String(step)}`, () => {
        const elements = [...doc.root.querySelectorAll("*")];
        const target = elements[random(elements.length)] ?? doc.root;
        switch (random(6)) {
          case 0:
            target.setAttribute(`data-${String(random(3))}`, String(step));
            break;
          case 1:
            if (target.attributes[0]) target.removeAttribute(target.attributes[0].name);
            break;
          case 2: {
            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("width", String(step));
            (target.namespaceURI === SVG_NS ? target : doc.root).append(rect);
            break;
          }
          case 3:
            if (target !== doc.root && elements.length > 3) target.remove();
            break;
          case 4: {
            const other = elements[random(elements.length)];
            if (other && other !== target && !other.contains(target) && !target.contains(other))
              other.after(target);
            break;
          }
          default:
            target.append(document.createTextNode(` ${String(step)} `));
        }
      });
      // Un paso sin cambios netos no queda en el historial.
      if (doc.history.state.undoAction === `step-${String(step)}`) snapshots.push(doc.serialize());
    }
    expect(snapshots.length).toBeGreaterThan(150);

    for (let index = snapshots.length - 1; index > 0; index--) {
      expect(doc.serialize()).toBe(snapshots[index]);
      doc.history.undo();
    }
    expect(doc.serialize()).toBe(SOURCE);
    expect(doc.revision).toBe(0);
  });
});
