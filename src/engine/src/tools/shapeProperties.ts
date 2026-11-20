import type { ShapeChange, ShapeProperties } from "../bridge";
import { setCornerRadius } from "./cornerRadius";
import { MAX_SIDES, MIN_SIDES, readPolygon, updatePolygon } from "./polygons";
import { coordinate } from "./shapes";

/**
 * Propiedades propias de cada forma para el panel (issue #59): las del rectángulo, la elipse, el
 * círculo, la línea y los polígonos y estrellas de WinVector, en las unidades de sus atributos.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Valor de un atributo de longitud en unidades de usuario (0 si no está). */
const length = (value: SVGAnimatedLength) => value.baseVal.value;

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Propiedades de la forma, o `null` si el elemento no es una forma con propiedades propias. */
export function readShape(element: Element): ShapeProperties | null {
  const polygon = readPolygon(element);
  if (polygon) {
    return {
      type: polygon.kind,
      cx: polygon.cx,
      cy: polygon.cy,
      r: polygon.r,
      sides: polygon.sides,
      rotation: polygon.rotation,
      rounding: polygon.rounding,
      ...(polygon.kind === "star" ? { inner: polygon.inner } : {}),
    };
  }
  if (element.namespaceURI !== SVG_NS) return null;
  if (element instanceof SVGRectElement) {
    const width = length(element.width);
    const height = length(element.height);
    const rx = element.hasAttribute("rx") ? length(element.rx) : null;
    const ry = element.hasAttribute("ry") ? length(element.ry) : null;
    return {
      type: "rect",
      x: round(length(element.x)),
      y: round(length(element.y)),
      width: round(width),
      height: round(height),
      cornerRadius: round(Math.min(rx ?? ry ?? 0, width / 2, height / 2)),
    };
  }
  if (element instanceof SVGEllipseElement) {
    return {
      type: "ellipse",
      cx: round(length(element.cx)),
      cy: round(length(element.cy)),
      rx: round(length(element.rx)),
      ry: round(length(element.ry)),
    };
  }
  if (element instanceof SVGCircleElement) {
    return {
      type: "circle",
      cx: round(length(element.cx)),
      cy: round(length(element.cy)),
      r: round(length(element.r)),
    };
  }
  if (element instanceof SVGLineElement) {
    return {
      type: "line",
      x1: round(length(element.x1)),
      y1: round(length(element.y1)),
      x2: round(length(element.x2)),
      y2: round(length(element.y2)),
    };
  }
  return null;
}

type Change = Omit<ShapeChange, "documentId">;

/**
 * Aplica un cambio de propiedades. Los valores que no son del tipo de la forma o no son válidos
 * (un ancho de 0, un radio negativo) se ignoran. Devuelve el elemento resultante: un polígono que
 * pasa a tener las esquinas redondeadas se sustituye por un trazado.
 */
export function applyShape(element: Element, change: Change): Element {
  const set = (
    name: string,
    value: number | undefined,
    valid: (v: number) => boolean = Number.isFinite,
  ) => {
    if (value === undefined || !Number.isFinite(value) || !valid(value)) return;
    const text = coordinate(value);
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  };
  const positive = (value: number) => value > 0;

  if (readPolygon(element)) {
    const sides =
      change.sides !== undefined && Number.isFinite(change.sides) ? change.sides : undefined;
    return (
      updatePolygon(element, {
        ...finite("cx", change.cx),
        ...finite("cy", change.cy),
        ...finite("r", change.r),
        ...finite("rotation", change.rotation),
        ...finite("inner", change.inner),
        ...finite("rounding", change.rounding),
        ...(sides !== undefined ? { sides: Math.min(MAX_SIDES, Math.max(MIN_SIDES, sides)) } : {}),
      }) ?? element
    );
  }
  if (element instanceof SVGRectElement) {
    set("x", change.x);
    set("y", change.y);
    set("width", change.width, positive);
    set("height", change.height, positive);
    if (change.cornerRadius !== undefined && Number.isFinite(change.cornerRadius)) {
      const limit = Math.min(length(element.width), length(element.height)) / 2;
      setCornerRadius(element, Math.min(limit, Math.max(0, change.cornerRadius)));
    }
  } else if (element instanceof SVGEllipseElement) {
    set("cx", change.cx);
    set("cy", change.cy);
    set("rx", change.rx, positive);
    set("ry", change.ry, positive);
  } else if (element instanceof SVGCircleElement) {
    set("cx", change.cx);
    set("cy", change.cy);
    set("r", change.r, positive);
  } else if (element instanceof SVGLineElement) {
    set("x1", change.x1);
    set("y1", change.y1);
    set("x2", change.x2);
    set("y2", change.y2);
  }
  return element;
}

/** `{ name: value }` si el valor es un número finito; si no, nada. */
function finite<K extends string>(name: K, value: number | undefined): Partial<Record<K, number>> {
  return value !== undefined && Number.isFinite(value)
    ? ({ [name]: value } as Record<K, number>)
    : {};
}

/** Nombres de las propiedades que cambia el cambio (para fundir los pasos seguidos del historial). */
export const changedFields = (change: Change) => Object.keys(change).sort().join(",");
