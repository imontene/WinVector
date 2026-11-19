import { applyToPoint, corners, union, type Rect } from "../geometry";
import { localBox, screenBounds, screenMatrix } from "../selection";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lo que dibuja la capa de superposición, en coordenadas de pantalla. */
export interface OverlayScene {
  /** Elementos seleccionados: se dibuja el contorno de cada uno y, si hay varios, la caja común. */
  readonly items: readonly Element[];
  /** Grupo en el que ha entrado el usuario, o `null`. Se marca con un contorno discontinuo. */
  readonly scope: Element | null;
  /** Marco de selección mientras se arrastra, o `null`. */
  readonly marquee: Rect | null;
}

export const EMPTY_SCENE: OverlayScene = { items: [], scope: null, marquee: null };

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
    if (scene.marquee) shapes.push(this.#rect(scene.marquee, "overlay-marquee"));
    this.element.replaceChildren(...shapes);
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
