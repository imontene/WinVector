import { afterEach, describe, expect, it } from "vitest";
import { applyArtboard, parseViewBox, readArtboard, SvgDocument } from "../document";
import { baseSize, Viewport } from "./viewport";

const cleanup: HTMLElement[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((element) => {
    element.remove();
  });
});

function setup(source: string) {
  const workspace = document.createElement("div");
  workspace.style.cssText = "position:relative;width:1000px;height:600px;overflow:hidden";
  document.body.append(workspace);
  cleanup.push(workspace);
  const host = document.createElement("div");
  workspace.append(host);
  const doc = SvgDocument.load(source, host);
  const viewport = new Viewport(doc.artboard, doc.root, workspace);
  return { doc, viewport, workspace };
}

const svg = (attributes: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`;

describe("tamaño natural de la mesa de trabajo", () => {
  it.each([
    [`width="800" height="600" viewBox="0 0 400 300"`, 800, 600],
    [`viewBox="0 0 400 300"`, 400, 300],
    [`width="100%" height="100%" viewBox="0 0 40 30"`, 40, 30],
    [`width="1in" height="2in"`, 96, 192],
    [`width="200" viewBox="0 0 400 300"`, 200, 150],
    [``, 300, 150],
  ])("%s → %d × %d", (attributes, width, height) => {
    const { doc } = setup(svg(attributes));
    const size = baseSize(doc.root);
    expect(size.width).toBeCloseTo(width);
    expect(size.height).toBeCloseTo(height);
  });
});

describe("viewport", () => {
  it("se ajusta al lienzo, centrado", () => {
    const { viewport, doc, workspace } = setup(svg(`width="400" height="200"`));
    viewport.show();
    // (1000 - 48) / 400 = 2,38 y (600 - 48) / 200 = 2,76: manda el ancho.
    expect(viewport.zoom).toBeCloseTo(2.38);
    const box = doc.artboard.getBoundingClientRect();
    expect(box.width).toBeCloseTo(952);
    expect(box.left - workspace.getBoundingClientRect().left).toBeCloseTo(24, 0);
  });

  it("al hacer zoom mantiene fijo el punto bajo el puntero", () => {
    const { viewport } = setup(svg(`width="400" height="200" viewBox="0 0 400 200"`));
    viewport.show();
    const anchor = { x: 300, y: 200 };
    const before = viewport.screenToDocument(anchor);
    viewport.zoomBy(3.7, anchor);
    const after = viewport.screenToDocument(anchor);
    // El navegador coloca la mesa en fracciones de 1/64 de píxel.
    expect(after?.x).toBeCloseTo(before?.x ?? NaN, 1);
    expect(after?.y).toBeCloseTo(before?.y ?? NaN, 1);
  });

  it("acerca y aleja por niveles, dentro de los límites", () => {
    const { viewport } = setup(svg(`width="100" height="100"`));
    viewport.actualSize();
    viewport.zoomIn();
    expect(viewport.zoom).toBe(1.5);
    viewport.zoomOut();
    viewport.zoomOut();
    expect(viewport.zoom).toBe(0.6667);
    for (let i = 0; i < 50; i++) viewport.zoomIn();
    expect(viewport.zoom).toBe(64);
    viewport.zoomBy(1000);
    expect(viewport.zoom).toBe(64);
  });

  it("al cambiar de tamaño el lienzo, solo se reajusta si no se ha tocado el zoom", () => {
    const { viewport, workspace } = setup(svg(`width="100" height="100"`));
    viewport.show();
    workspace.style.height = "300px";
    viewport.resize();
    expect(viewport.zoom).toBeCloseTo(2.52);
    viewport.panBy(10, 0);
    workspace.style.height = "600px";
    viewport.resize();
    expect(viewport.zoom).toBeCloseTo(2.52);
  });

  it("el zoom y el desplazamiento no cambian el documento", () => {
    const source = svg(`width="100" height="100"`);
    const { viewport, doc } = setup(source);
    viewport.show();
    viewport.zoomBy(2);
    viewport.panBy(5, 5);
    expect(doc.serialize()).toBe(source);
    expect(doc.revision).toBe(0);
  });
});

describe("mesa de trabajo", () => {
  it("lee y valida el viewBox", () => {
    expect(parseViewBox("0 0 10 20")).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(parseViewBox(" -5,2  10 , 20 ")).toEqual({ x: -5, y: 2, width: 10, height: 20 });
    expect(parseViewBox("0 0 0 10")).toBeNull();
    expect(parseViewBox("0 0 10")).toBeNull();
    expect(parseViewBox(null)).toBeNull();
  });

  it("se cambia en un paso que se puede deshacer", () => {
    const source = svg(`width="100mm" viewBox="0 0 100 50"`);
    const { doc } = setup(source);
    applyArtboard(doc, {
      width: "210mm",
      height: "297mm",
      viewBox: { x: 0, y: 0, width: 210, height: 297 },
    });
    expect(readArtboard(doc.root)).toEqual({
      width: "210mm",
      height: "297mm",
      viewBox: { x: 0, y: 0, width: 210, height: 297 },
    });
    expect(doc.history.state.undoAction).toBe("artboard");
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });

  it("no toca los atributos que no cambian", () => {
    const source = svg(`width="100mm" viewBox="0, 0, 100, 50"`);
    const { doc } = setup(source);
    applyArtboard(doc, {
      width: "100mm",
      height: null,
      viewBox: { x: 0, y: 0, width: 100, height: 50 },
    });
    expect(doc.history.state.canUndo).toBe(false);
    expect(doc.serialize()).toBe(source);
  });
});
