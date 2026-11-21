import { invert, multiply } from "../geometry";
import { elementToRoot } from "../transform";
import { canConvertToPath, convertToPath, shapePathData } from "./convert";
import { transformPath } from "./operations";
import { parsePath } from "./parse";
import { forgetRounding } from "./round";
import { serializePath } from "./serialize";
import type { PathData } from "./model";

/**
 * Combinar varios trazados en uno y separar un trazado en sus subtrazados (issue #79).
 *
 * Al combinar, el trazado resultante es el primero de la selección en el orden del documento (el
 * que queda más al fondo), convertido en trazado si era otra forma, con su estilo, su identificador y
 * su sitio. Los demás se añaden como subtrazados en sus coordenadas y desaparecen. Con la regla de
 * relleno `evenodd`, una forma dentro de otra hace un agujero.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const documentOrder = (a: Element, b: Element) =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

/** Geometría de una forma o un trazado, o `null` si no es ninguna de las dos. */
function pathDataOf(element: Element): PathData | null {
  if (element.namespaceURI !== SVG_NS) return null;
  const d = element.localName === "path" ? element.getAttribute("d") : shapePathData(element);
  return d === null ? null : parsePath(d).data;
}

/** True si el elemento puede formar parte de una combinación. */
export const canCombine = (element: Element) =>
  element.namespaceURI === SVG_NS && (element.localName === "path" || canConvertToPath(element));

/**
 * Combina las formas y trazados de `items` en un solo trazado. Devuelve el trazado, o `null` si no
 * hay al menos dos que se puedan combinar.
 */
export function combinePaths(items: readonly Element[], root: SVGSVGElement): Element | null {
  const shapes = items.filter(canCombine).sort(documentOrder);
  const [first] = shapes;
  if (!first || shapes.length < 2) return null;
  const toRoot = elementToRoot(first, root);
  const fromRoot = toRoot ? invert(toRoot) : null;
  if (!fromRoot) return null;

  const parts: PathData[] = [];
  for (const shape of shapes) {
    const data = pathDataOf(shape);
    const shapeToRoot = elementToRoot(shape, root);
    if (!data || !shapeToRoot) return null;
    // A las coordenadas del primero: sus transformaciones pueden ser distintas.
    parts.push(shape === first ? data : transformPath(data, multiply(fromRoot, shapeToRoot)));
  }
  const target = first.localName === "path" ? first : convertToPath(first);
  if (!target) return null;
  // Los trazados redondeados quedan como se ven: su forma sin redondear ya no vale (issue #80).
  forgetRounding(target);
  target.setAttribute("d", serializePath(parts.flat()));
  for (const shape of shapes) if (shape !== first) shape.remove();
  return target;
}

/**
 * Separa un trazado en un trazado por subtrazado, con el mismo estilo, en su sitio y en orden. El
 * primero conserva el identificador y los hijos (`<title>`…). Devuelve los trazados, o `null` si
 * tiene un solo subtrazado.
 */
export function separatePath(element: Element): Element[] | null {
  if (element.namespaceURI !== SVG_NS || element.localName !== "path") return null;
  const data = parsePath(element.getAttribute("d") ?? "").data.filter(
    (subpath) => subpath.segments.length > 0,
  );
  if (data.length < 2) return null;
  forgetRounding(element);
  const pieces = data.map((subpath, i) => {
    if (i === 0) {
      element.setAttribute("d", serializePath([subpath]));
      return element;
    }
    const piece = element.cloneNode(false) as Element;
    piece.removeAttribute("id");
    piece.setAttribute("d", serializePath([subpath]));
    return piece;
  });
  element.after(...pieces.slice(1));
  return pieces;
}
