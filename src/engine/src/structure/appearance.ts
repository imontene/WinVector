import { invert, multiply, type Matrix } from "../geometry";
import { elementToRoot, localTransform, parentToRoot, simplestTransform } from "../transform";

/**
 * Propiedades que se heredan del padre y que cambian el aspecto. Al mover un elemento a otro padre
 * (agrupar, desagrupar, pegar), su valor puede cambiar aunque el elemento no se toque.
 */
export const INHERITED_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "paint-order",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "font-stretch",
  "letter-spacing",
  "word-spacing",
  "text-anchor",
  "text-decoration",
  "dominant-baseline",
  "visibility",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-rule",
  "color-interpolation",
  "color-interpolation-filters",
  "shape-rendering",
  "text-rendering",
  "image-rendering",
  "writing-mode",
  "direction",
] as const;

/** Valores calculados de las propiedades heredables de un elemento. */
export type StyleSnapshot = ReadonlyMap<string, string>;

export function computedInherited(element: Element): StyleSnapshot {
  const style = getComputedStyle(element);
  return new Map(INHERITED_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]));
}

/**
 * Hace que el elemento vuelva a calcular los valores guardados: primero con atributos de
 * presentación y, si una regla de CSS los sigue tapando, con su atributo style.
 */
export function restoreInherited(element: Element, before: StyleSnapshot): void {
  if (!(element instanceof SVGElement)) return;
  const differs = (name: string) =>
    getComputedStyle(element).getPropertyValue(name) !== before.get(name);
  for (const [name, value] of before) {
    if (!differs(name)) continue;
    element.setAttribute(name, value);
    if (differs(name)) element.style.setProperty(name, value);
  }
}

const isIdentity = (m: Matrix) =>
  Math.abs(m.a - 1) < 1e-9 &&
  Math.abs(m.b) < 1e-9 &&
  Math.abs(m.c) < 1e-9 &&
  Math.abs(m.d - 1) < 1e-9 &&
  Math.abs(m.e) < 1e-9 &&
  Math.abs(m.f) < 1e-9;

const same = (a: Matrix, b: Matrix) =>
  (["a", "b", "c", "d", "e", "f"] as const).every((key) => Math.abs(a[key] - b[key]) < 1e-9);

/**
 * Mueve un elemento a otro padre (antes de `before`, o al final) sin que cambie cómo se ve: ajusta
 * su `transform` a las coordenadas del padre nuevo y conserva los estilos que heredaba.
 *
 * @returns `false` si no se puede medir (documento oculto o transformación no invertible); entonces
 * no se mueve.
 */
export function reparent(
  element: Element,
  parent: Element,
  before: Node | null,
  root: SVGSVGElement,
): boolean {
  const matrix = elementToRoot(element, root);
  if (!matrix) return false;
  const style = computedInherited(element);
  const local = localTransform(element);

  parent.insertBefore(element, before);
  const parentMatrix = parentToRoot(element, root);
  const inverse = parentMatrix ? invert(parentMatrix) : null;
  if (!inverse) return false;
  const next = multiply(inverse, matrix);
  if (!same(next, local)) {
    if (isIdentity(next)) element.removeAttribute("transform");
    else element.setAttribute("transform", simplestTransform(next));
  }
  restoreInherited(element, style);
  return true;
}
