import { afterEach, describe, expect, it } from "vitest";
import { DocumentManager, UnknownDocumentError } from "./documentManager";
import { SvgParseError } from "./svgDocument";

const containers: HTMLElement[] = [];
afterEach(() => {
  containers.splice(0).forEach((container) => {
    container.remove();
  });
});

const svg = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg"><rect id="${id}"/></svg>`;

function create(onChanged?: (id: string, revision: number) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  return { container, manager: new DocumentManager(container, onChanged ? { onChanged } : {}) };
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Falta ${what}`);
  return value;
}

const hosts = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>(".winvector-document"),
];

describe("DocumentManager", () => {
  it("carga cada documento en su propio contenedor, oculto hasta activarlo", () => {
    const { container, manager } = create();
    manager.load("d1", "uno.svg", svg("a"));
    manager.load("d2", "dos.svg", svg("b"));
    expect(hosts(container).map((h) => h.hidden)).toEqual([true, true]);
    expect(manager.active).toBeNull();

    manager.activate("d2");
    expect(hosts(container).map((h) => h.hidden)).toEqual([true, false]);
    expect(manager.active?.id).toBe("d2");
    expect(getComputedStyle(required(hosts(container)[0], "el primer contenedor")).display).toBe(
      "none",
    );
  });

  it("devuelve el texto original de un documento sin cambios", () => {
    const { manager } = create();
    const source = `<?xml version="1.0"?>\n<!-- hola -->\n${svg("a")}\n`;
    manager.load("d1", "uno.svg", source);
    expect(manager.get("d1").serialize()).toBe(source);
  });

  it("avisa de los cambios con el identificador del documento", async () => {
    const changes: [string, number][] = [];
    const { manager } = create((id, revision) => changes.push([id, revision]));
    manager.load("d1", "uno.svg", svg("a"));
    manager.get("d1").root.querySelector("#a")?.setAttribute("x", "1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changes).toEqual([["d1", 1]]);
  });

  it("cerrar quita el documento y su contenedor", () => {
    const { container, manager } = create();
    manager.load("d1", "uno.svg", svg("a"));
    manager.activate("d1");
    manager.close("d1");
    expect(hosts(container)).toHaveLength(0);
    expect(manager.active).toBeNull();
    expect(() => manager.get("d1")).toThrow(UnknownDocumentError);
  });

  it("un SVG no válido no deja nada abierto", () => {
    const { container, manager } = create();
    expect(() => manager.load("d1", "roto.svg", "<svg")).toThrow(SvgParseError);
    expect(hosts(container)).toHaveLength(0);
    expect(manager.ids).toEqual([]);
  });

  it("cargar con un identificador existente sustituye el documento y conserva si estaba activo", () => {
    const { container, manager } = create();
    manager.load("d1", "uno.svg", svg("a"));
    manager.activate("d1");
    manager.load("d1", "uno.svg", svg("b"));
    expect(hosts(container)).toHaveLength(1);
    expect(manager.active?.document.root.querySelector("#b")).not.toBeNull();
  });

  it("los documentos no comparten estilos", () => {
    const { manager } = create();
    manager.load(
      "d1",
      "uno.svg",
      `<svg xmlns="http://www.w3.org/2000/svg"><style>rect { fill: rgb(255, 0, 0) }</style><rect id="a"/></svg>`,
    );
    manager.load("d2", "dos.svg", svg("b"));
    manager.activate("d2");
    const rect = required(manager.get("d2").root.querySelector("#b"), "#b");
    expect(getComputedStyle(rect).fill).not.toBe("rgb(255, 0, 0)");
  });
});
