import { applyToPoint, corners, union, type Point, type Rect } from "../geometry";
import { HANDLE_SIZE, handlePositions, localBox, screenBounds, screenMatrix } from "../selection";
import type { GradientScene } from "../tools/gradientTool";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lo que dibuja la capa de superposición, en coordenadas de pantalla. */
export interface OverlayScene {
  /** Elementos seleccionados: se dibuja el contorno de cada uno y, si hay varios, la caja común. */
  readonly items: readonly Element[];
  /** Grupo en el que ha entrado el usuario, o `null`. Se marca con un contorno discontinuo. */
  readonly scope: Element | null;
  /** Marco de selección mientras se arrastra, o `null`. */
  readonly marquee: Rect | null;
  /** Caja de la selección en pantalla con sus manejadores, o `null` para no dibujarlos. */
  readonly handles?: Rect | null;
  /** Manejadores propios de la forma seleccionada (radio, extremos de línea), en pantalla. */
  readonly shapeHandles?: readonly Point[];
  /** Radio de esos manejadores, en píxeles. */
  readonly shapeHandleSize?: number;
  /** Vértices de la forma que se edita con la herramienta Vértices, en pantalla, o `null`. */
  readonly vertices?: {
    readonly points: readonly Point[];
    readonly selected: readonly boolean[];
    /** Manejadores de las curvas de los nodos seleccionados de un trazado. */
    readonly handles?: readonly { readonly from: Point; readonly to: Point }[];
    /** Controles de radio de las esquinas seleccionadas (issue #80). */
    readonly radii?: readonly Point[];
  } | null;
  /** Cursor y selección del texto que se edita (issue #93), en pantalla. */
  readonly text?: {
    readonly caret: readonly [Point, Point] | null;
    readonly selection: readonly (readonly Point[])[];
  } | null;
  /** Degradados del objeto seleccionado con la herramienta Degradado (issue #110), en pantalla. */
  readonly gradient?: GradientScene | null;
  /** Primer nodo de la forma que se dibuja con la pluma, si un clic la cerraría y sus manejadores. */
  readonly pen?: {
    readonly start: Point;
    readonly closing: boolean;
    readonly handles?: readonly { readonly from: Point; readonly to: Point }[];
  } | null;
}

export const EMPTY_SCENE: OverlayScene = { items: [], scope: null, marquee: null, handles: null };

/**
 * Capa SVG por encima del lienzo para la selección, y más adelante manejadores y guías.
 *
 * Está fuera del documento (no en su shadow root), así que nunca se guarda con él, y no recibe el
 * puntero: los clics la atraviesan hasta el documento.
 */
export class Overlay {
  readonly element: SVGSVGElement;

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.element = doc.createElementNS(SVG_NS, "svg");
    this.element.classList.add("overlay");
    this.element.setAttribute("aria-hidden", "true");
    parent.append(this.element);
  }

  render(scene: OverlayScene): void {
    const shapes: SVGElement[] = [];
    if (scene.scope) {
      const box = screenBounds(scene.scope);
      if (box) shapes.push(this.#rect(box, "overlay-scope"));
    }
    for (const item of scene.items) {
      const outline = this.#outline(item);
      if (outline) shapes.push(outline);
    }
    if (scene.items.length > 1) {
      const all = union(scene.items.map(screenBounds).filter((box): box is Rect => box !== null));
      if (all) shapes.push(this.#rect(all, "overlay-bounds"));
    }
    if (scene.handles) shapes.push(...this.#handles(scene.handles));
    for (const handle of scene.shapeHandles ?? []) {
      const circle = this.element.ownerDocument.createElementNS(SVG_NS, "circle");
      circle.classList.add("overlay-handle", "overlay-shape-handle");
      circle.setAttribute("cx", String(round(handle.x)));
      circle.setAttribute("cy", String(round(handle.y)));
      circle.setAttribute("r", String(scene.shapeHandleSize ?? 4));
      shapes.push(circle);
    }
    // Los manejadores, antes que los nodos: la línea no debe tapar el cuadrado del nodo.
    for (const { from, to } of [
      ...(scene.vertices?.handles ?? []),
      ...(scene.pen?.handles ?? []),
    ]) {
      const doc = this.element.ownerDocument;
      const line = doc.createElementNS(SVG_NS, "line");
      line.classList.add("overlay-path-handle-line");
      line.setAttribute("x1", String(round(from.x)));
      line.setAttribute("y1", String(round(from.y)));
      line.setAttribute("x2", String(round(to.x)));
      line.setAttribute("y2", String(round(to.y)));
      const circle = doc.createElementNS(SVG_NS, "circle");
      circle.classList.add("overlay-path-handle");
      circle.setAttribute("cx", String(round(to.x)));
      circle.setAttribute("cy", String(round(to.y)));
      circle.setAttribute("r", "3.5");
      shapes.push(line, circle);
    }
    scene.vertices?.points.forEach((point, index) => {
      const size = 7;
      const square = this.#rect(
        { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size },
        "overlay-vertex",
      );
      if (scene.vertices?.selected[index]) square.classList.add("overlay-vertex-selected");
      shapes.push(square);
    });
    for (const at of scene.vertices?.radii ?? []) {
      const circle = this.element.ownerDocument.createElementNS(SVG_NS, "circle");
      circle.classList.add("overlay-corner-radius");
      circle.setAttribute("cx", String(round(at.x)));
      circle.setAttribute("cy", String(round(at.y)));
      circle.setAttribute("r", "4");
      shapes.push(circle);
    }
    if (scene.pen) {
      const circle = this.element.ownerDocument.createElementNS(SVG_NS, "circle");
      circle.classList.add("overlay-pen-start");
      if (scene.pen.closing) circle.classList.add("overlay-pen-closing");
      circle.setAttribute("cx", String(round(scene.pen.start.x)));
      circle.setAttribute("cy", String(round(scene.pen.start.y)));
      circle.setAttribute("r", scene.pen.closing ? "6" : "4");
      shapes.push(circle);
    }
    for (const quad of scene.text?.selection ?? []) {
      const polygon = this.element.ownerDocument.createElementNS(SVG_NS, "polygon");
      polygon.classList.add("overlay-text-selection");
      polygon.setAttribute(
        "points",
        quad.map((p) => `${String(round(p.x))},${String(round(p.y))}`).join(" "),
      );
      shapes.push(polygon);
    }
    const caret = scene.text?.caret;
    if (caret) {
      const line = this.element.ownerDocument.createElementNS(SVG_NS, "line");
      line.classList.add("overlay-text-caret");
      line.setAttribute("x1", String(round(caret[0].x)));
      line.setAttribute("y1", String(round(caret[0].y)));
      line.setAttribute("x2", String(round(caret[1].x)));
      line.setAttribute("y2", String(round(caret[1].y)));
      shapes.push(line);
    }
    if (scene.gradient) shapes.push(...this.#gradient(scene.gradient));
    if (scene.marquee) shapes.push(this.#rect(scene.marquee, "overlay-marquee"));
    this.element.replaceChildren(...shapes);
  }

  /** Línea, manejadores y paradas de los degradados (issue #110). */
  #gradient(scene: GradientScene): SVGElement[] {
    const doc = this.element.ownerDocument;
    const shapes: SVGElement[] = [];
    for (const { from, to, stroke } of scene.lines) {
      const line = doc.createElementNS(SVG_NS, "line");
      line.classList.add("overlay-gradient-line");
      if (stroke) line.classList.add("overlay-gradient-stroke");
      line.setAttribute("x1", String(round(from.x)));
      line.setAttribute("y1", String(round(from.y)));
      line.setAttribute("x2", String(round(to.x)));
      line.setAttribute("y2", String(round(to.y)));
      shapes.push(line);
    }
    for (const { at, color, selected, stroke } of scene.stops) {
      const circle = doc.createElementNS(SVG_NS, "circle");
      circle.classList.add("overlay-gradient-stop");
      if (selected) circle.classList.add("overlay-gradient-stop-selected");
      if (stroke) circle.classList.add("overlay-gradient-stroke");
      circle.setAttribute("cx", String(round(at.x)));
      circle.setAttribute("cy", String(round(at.y)));
      circle.setAttribute("r", selected ? "5" : "4");
      circle.style.fill = color;
      shapes.push(circle);
    }
    for (const { at, kind, stroke } of scene.handles) {
      const size = 9;
      // El radio y el foco son círculos; los extremos y el centro, cuadrados.
      const circular = kind === "radius" || kind === "focus";
      const handle = circular
        ? doc.createElementNS(SVG_NS, "circle")
        : this.#rect(
            { x: at.x - size / 2, y: at.y - size / 2, width: size, height: size },
            "overlay-gradient-square",
          );
      handle.classList.add("overlay-gradient-handle", `overlay-gradient-${kind}`);
      if (stroke) handle.classList.add("overlay-gradient-stroke");
      if (circular) {
        handle.setAttribute("cx", String(round(at.x)));
        handle.setAttribute("cy", String(round(at.y)));
        handle.setAttribute("r", "4.5");
      }
      shapes.push(handle);
    }
    return shapes;
  }

  dispose(): void {
    this.element.remove();
  }

  /** Contorno de la caja del elemento con su transformación: sigue al objeto si está girado. */
  #outline(element: Element): SVGElement | null {
    const box = localBox(element);
    const matrix = screenMatrix(element);
    if (!box || !matrix) return null;
    const polygon = this.element.ownerDocument.createElementNS(SVG_NS, "polygon");
    polygon.classList.add("overlay-item");
    polygon.setAttribute(
      "points",
      corners(box)
        .map((corner) => applyToPoint(matrix, corner))
        .map(({ x, y }) => `${String(round(x))},${String(round(y))}`)
        .join(" "),
    );
    return polygon;
  }

  /** Ocho cuadrados para escalar y un círculo, unido al borde superior, para girar. */
  #handles(rect: Rect): SVGElement[] {
    const doc = this.element.ownerDocument;
    const shapes: SVGElement[] = [];
    const positions = handlePositions(rect);
    const rotate = positions.find((handle) => handle.id === "rotate");
    if (rotate) {
      const line = doc.createElementNS(SVG_NS, "line");
      line.classList.add("overlay-rotate-line");
      line.setAttribute("x1", String(round(rotate.point.x)));
      line.setAttribute("y1", String(round(rect.y)));
      line.setAttribute("x2", String(round(rotate.point.x)));
      line.setAttribute("y2", String(round(rotate.point.y)));
      shapes.push(line);
    }
    for (const { id, point } of positions) {
      if (id === "rotate") {
        const circle = doc.createElementNS(SVG_NS, "circle");
        circle.classList.add("overlay-handle", "overlay-handle-rotate");
        circle.setAttribute("cx", String(round(point.x)));
        circle.setAttribute("cy", String(round(point.y)));
        circle.setAttribute("r", String(HANDLE_SIZE / 2 + 0.5));
        shapes.push(circle);
        continue;
      }
      const half = HANDLE_SIZE / 2;
      const square = this.#rect(
        { x: point.x - half, y: point.y - half, width: HANDLE_SIZE, height: HANDLE_SIZE },
        "overlay-handle",
      );
      square.dataset.handle = id;
      shapes.push(square);
    }
    return shapes;
  }

  #rect(rect: Rect, className: string): SVGElement {
    const element = this.element.ownerDocument.createElementNS(SVG_NS, "rect");
    element.classList.add(className);
    element.setAttribute("x", String(round(rect.x)));
    element.setAttribute("y", String(round(rect.y)));
    element.setAttribute("width", String(round(rect.width)));
    element.setAttribute("height", String(round(rect.height)));
    return element;
  }
}

const round = (value: number) => Math.round(value * 100) / 100;
