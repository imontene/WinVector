import { SVG_NS } from "../document";
import { selectionBounds } from "../selection";
import { INHERITED_PROPERTIES } from "../structure";
import { elementToRoot, formatNumber, outermost, simplestTransform } from "../transform";
import { dependencies } from "./references";

/** Propiedades que no se heredan pero que una hoja de estilos puede dar al elemento copiado. */
const OWN_EFFECTS = ["opacity", "filter", "clip-path", "mask", "mix-blend-mode"] as const;

let defaults: ReadonlyMap<string, string> | null = null;

/** Valores calculados de un elemento SVG sin ningún estilo, para no copiar lo que ya es por defecto. */
function defaultStyle(): ReadonlyMap<string, string> {
  if (defaults) return defaults;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
  const shadow = host.attachShadow({ mode: "open" });
  const svg = document.createElementNS(SVG_NS, "svg");
  const probe = document.createElementNS(SVG_NS, "rect");
  svg.append(probe);
  shadow.append(svg);
  document.body.append(host);
  const style = getComputedStyle(probe);
  defaults = new Map(
    [...INHERITED_PROPERTIES, ...OWN_EFFECTS].map((name) => [name, style.getPropertyValue(name)]),
  );
  host.remove();
  return defaults;
}

/** True si el elemento declara la propiedad él mismo (atributo de presentación o atributo style). */
function declares(element: Element, name: string): boolean {
  if (element.hasAttribute(name)) return true;
  return element instanceof SVGElement && element.style.getPropertyValue(name) !== "";
}

/**
 * Copia de un elemento que se ve igual fuera de su documento: lleva en su `transform` la posición
 * respecto al elemento raíz y, como atributos, los estilos que heredaba o que le daba una hoja de
 * estilos.
 */
function standaloneClone(element: Element, root: SVGSVGElement): Element {
  const clone = element.cloneNode(true) as Element;
  const matrix = elementToRoot(element, root);
  if (matrix) {
    const transform = simplestTransform(matrix);
    if (transform === "translate(0 0)") clone.removeAttribute("transform");
    else clone.setAttribute("transform", transform);
  }
  const computed = getComputedStyle(element);
  const base = defaultStyle();
  for (const name of [...INHERITED_PROPERTIES, ...OWN_EFFECTS]) {
    const value = computed.getPropertyValue(name);
    if (value !== base.get(name) && !declares(element, name)) clone.setAttribute(name, value);
  }
  return clone;
}

/**
 * Convierte la selección en un SVG independiente para el portapapeles:
 * - Cada objeto con su posición y sus estilos (ver `standaloneClone`).
 * - Las definiciones que usan (degradados, patrones, símbolos, recortes, marcadores…), en `<defs>`.
 * - Las hojas de estilos del documento, si los objetos usan clases; al pegar se convierten en
 *   atributos.
 * - Un viewBox con la caja de la selección, para que otras aplicaciones lo peguen a su tamaño.
 *
 * @returns El texto del SVG, o `null` si no hay nada seleccionado.
 */
export function copySelection(items: readonly Element[], root: SVGSVGElement): string | null {
  const outer = outermost(items);
  if (outer.length === 0) return null;
  const doc = root.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const bounds = selectionBounds(outer, root);
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    svg.setAttribute("width", formatNumber(bounds.width));
    svg.setAttribute("height", formatNumber(bounds.height));
    svg.setAttribute(
      "viewBox",
      [bounds.x, bounds.y, bounds.width, bounds.height].map(formatNumber).join(" "),
    );
  }

  const usesClasses = outer.some(
    (item) => item.matches("[class]") || item.querySelector("[class]"),
  );
  if (usesClasses) {
    for (const style of root.querySelectorAll("style")) svg.append(style.cloneNode(true));
  }
  const needed = dependencies(outer, root);
  if (needed.length > 0) {
    const defs = doc.createElementNS(SVG_NS, "defs");
    for (const element of needed) defs.append(element.cloneNode(true));
    svg.append(defs);
  }
  for (const item of outer) svg.append(standaloneClone(item, root));
  return new XMLSerializer().serializeToString(svg);
}
