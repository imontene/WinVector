import { transformRect, union, type Matrix, type Rect } from "../geometry";

/**
 * Medidas de los elementos seleccionados.
 *
 * Las coordenadas de pantalla son las del área visible de la página (las de `getBoundingClientRect`),
 * en las que dibuja la capa de superposición.
 */

function toMatrix(m: DOMMatrix): Matrix {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

/** Caja del elemento en sus propias coordenadas, o `null` si no se pinta (por ejemplo, display:none). */
export function localBox(element: Element): Rect | null {
  if (!(element instanceof SVGGraphicsElement)) return null;
  try {
    const box = element.getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch {
    // Firefox lanza con los elementos que no se pintan; Chromium devuelve una caja vacía.
    return null;
  }
}

/** Matriz que lleva las coordenadas del elemento a la pantalla, o `null` si no se pinta. */
export function screenMatrix(element: Element): Matrix | null {
  if (!(element instanceof SVGGraphicsElement)) return null;
  const ctm = element.getScreenCTM();
  return ctm ? toMatrix(ctm) : null;
}

/**
 * Caja del elemento en unidades de usuario del elemento raíz (las de su viewBox), alineada con los
 * ejes. `null` si no se pinta.
 */
export function boundsInRoot(element: Element, root: SVGSVGElement): Rect | null {
  const box = localBox(element);
  const toScreen = element instanceof SVGGraphicsElement ? element.getScreenCTM() : null;
  const rootToScreen = root.getScreenCTM();
  if (!box || !toScreen || !rootToScreen) return null;
  return transformRect(toMatrix(rootToScreen.inverse().multiply(toScreen)), box);
}

/** Caja que rodea a todos los elementos en unidades del elemento raíz, o `null` si ninguno se pinta. */
export function selectionBounds(items: Iterable<Element>, root: SVGSVGElement): Rect | null {
  const boxes = [...items].map((item) => boundsInRoot(item, root));
  return union(boxes.filter((box): box is Rect => box !== null));
}

/** Caja del elemento en la pantalla, alineada con los ejes. `null` si no se pinta. */
export function screenBounds(element: Element): Rect | null {
  const box = localBox(element);
  const matrix = screenMatrix(element);
  return box && matrix ? transformRect(matrix, box) : null;
}
