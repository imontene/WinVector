import { forgetPolygon } from "../tools/polygons";
import { formatNumber } from "../transform";

/**
 * Convertir formas en trazados (issue #60): rectángulo (con esquinas redondeadas), elipse, círculo,
 * línea, polígono y polilínea pasan a un `<path>` que se ve igual. El trazado conserva el
 * identificador, el estilo, las clases, el `transform`, los atributos desconocidos y los hijos
 * (`<title>`…), en el mismo sitio del documento. Las elipses se escriben con arcos (`A`), que son
 * exactos.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Atributos de geometría de cada forma: el trazado no los necesita. */
const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  rect: ["x", "y", "width", "height", "rx", "ry"],
  ellipse: ["cx", "cy", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
  path: [],
};

/** Las coordenadas con dos decimales como máximo, como las de las herramientas de forma. */
const n = (value: number) => formatNumber(Math.round(value * 100) / 100);

const length = (value: SVGAnimatedLength) => value.baseVal.value;

/** Puntos de un polígono o polilínea. */
function points(element: SVGPolygonElement | SVGPolylineElement): string[] {
  return Array.from(element.points, (p) => `${n(p.x)} ${n(p.y)}`);
}

/** El `d` equivalente a una forma, o `null` si no es una forma que se pueda convertir. */
export function shapePathData(element: Element): string | null {
  if (element.namespaceURI !== SVG_NS) return null;
  if (element instanceof SVGRectElement) {
    const x = length(element.x);
    const y = length(element.y);
    const w = length(element.width);
    const h = length(element.height);
    if (w <= 0 || h <= 0) return null;
    const hasRx = element.hasAttribute("rx");
    const hasRy = element.hasAttribute("ry");
    // Sin uno de los dos, vale lo mismo que el otro; y como mucho, la mitad del lado.
    const rx = Math.min(w / 2, hasRx ? length(element.rx) : hasRy ? length(element.ry) : 0);
    const ry = Math.min(h / 2, hasRy ? length(element.ry) : hasRx ? length(element.rx) : 0);
    if (rx <= 0 || ry <= 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
    const arc = (toX: number, toY: number) => `A${n(rx)} ${n(ry)} 0 0 1 ${n(toX)} ${n(toY)}`;
    return [
      `M${n(x + rx)} ${n(y)}`,
      `H${n(x + w - rx)}`,
      arc(x + w, y + ry),
      `V${n(y + h - ry)}`,
      arc(x + w - rx, y + h),
      `H${n(x + rx)}`,
      arc(x, y + h - ry),
      `V${n(y + ry)}`,
      arc(x + rx, y),
      "Z",
    ].join("");
  }
  if (element instanceof SVGEllipseElement || element instanceof SVGCircleElement) {
    const cx = length(element.cx);
    const cy = length(element.cy);
    const rx = element instanceof SVGCircleElement ? length(element.r) : length(element.rx);
    const ry = element instanceof SVGCircleElement ? length(element.r) : length(element.ry);
    if (rx <= 0 || ry <= 0) return null;
    const half = (toX: number) => `A${n(rx)} ${n(ry)} 0 1 0 ${n(toX)} ${n(cy)}`;
    return `M${n(cx - rx)} ${n(cy)}${half(cx + rx)}${half(cx - rx)}Z`;
  }
  if (element instanceof SVGLineElement) {
    return `M${n(length(element.x1))} ${n(length(element.y1))}L${n(length(element.x2))} ${n(length(element.y2))}`;
  }
  if (element instanceof SVGPolygonElement || element instanceof SVGPolylineElement) {
    const [first, ...rest] = points(element);
    if (first === undefined) return null;
    const close = element instanceof SVGPolygonElement ? "Z" : "";
    return `M${first}${rest.map((p) => `L${p}`).join("")}${close}`;
  }
  return null;
}

/** True si el elemento se puede convertir en trazado. */
export const canConvertToPath = (element: Element) =>
  shapePathData(element) !== null ||
  (element.localName === "path" && element.hasAttribute("data-winvector-shape"));

/**
 * Convierte una forma en trazado y devuelve el trazado, o `null` si no es una forma. Un trazado de
 * WinVector con parámetros (una estrella con redondeo) solo pierde los parámetros.
 */
export function convertToPath(element: Element): Element | null {
  if (element.localName === "path" && element.namespaceURI === SVG_NS) {
    if (!element.hasAttribute("data-winvector-shape")) return null;
    forgetPolygon(element);
    return element;
  }
  const d = shapePathData(element);
  if (d === null) return null;
  const geometry = new Set(GEOMETRY[element.localName] ?? []);
  const path = element.ownerDocument.createElementNS(SVG_NS, "path");
  let wroteD = false;
  for (const attribute of [...element.attributes]) {
    const isGeometry = attribute.namespaceURI === null && geometry.has(attribute.name);
    if (isGeometry) {
      // `d` va donde estaba el primer atributo de geometría, para que el archivo cambie poco.
      if (!wroteD) path.setAttribute("d", d);
      wroteD = true;
      continue;
    }
    if (attribute.name.startsWith("data-winvector-")) continue;
    path.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  if (!wroteD) path.setAttribute("d", d);
  path.append(...element.childNodes);
  element.replaceWith(path);
  return path;
}

/**
 * Convierte en trazados los elementos que se pueden convertir. Devuelve cada elemento sustituido con
 * su trazado (para actualizar la selección).
 */
export function convertAllToPath(items: readonly Element[]): Map<Element, Element> {
  const replaced = new Map<Element, Element>();
  for (const item of items) {
    const path = convertToPath(item);
    if (path && path !== item) replaced.set(item, path);
    else if (path) replaced.set(item, item);
  }
  return replaced;
}
