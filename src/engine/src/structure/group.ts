import { SVG_NS } from "../document";
import { elementToRoot } from "../transform";
import { reparent } from "./appearance";

function documentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * Agrupa los elementos en un `<g>` nuevo, que ocupa el lugar del que está más arriba. Si estaban
 * en padres distintos, el grupo va al padre de ese elemento y los demás se mueven a él sin cambiar
 * su aspecto.
 *
 * @returns El grupo nuevo, o `null` si no hay nada que agrupar o no se puede medir el documento.
 */
export function group(items: readonly Element[], root: SVGSVGElement): SVGGElement | null {
  // Un elemento dentro de otro seleccionado ya va con él.
  const outer = items.filter(
    (item) => !items.some((other) => other !== item && other.contains(item)),
  );
  const ordered = [...outer].sort(documentOrder);
  const top = ordered.at(-1);
  const parent = top?.parentElement;
  if (!top || !parent || ordered.length === 0) return null;
  // Los que cambian de padre tienen que poder medirse: si no, no se agrupa nada.
  if (ordered.some((item) => item.parentElement !== parent && !elementToRoot(item, root)))
    return null;

  const g = root.ownerDocument.createElementNS(SVG_NS, "g");
  parent.insertBefore(g, top.nextSibling);
  for (const item of ordered) {
    if (item.parentElement === parent) g.append(item);
    else reparent(item, g, null, root);
  }
  return g;
}

/** Por qué un grupo no se puede desagrupar sin que cambie cómo se ve. */
export type UngroupBlocker = "effects" | "referenced" | "not-a-group";

/**
 * Comprueba si un grupo se puede desagrupar sin cambiar el aspecto: no puede tener opacidad,
 * filtro, recorte, máscara ni modo de fusión (afectan al grupo entero, no a cada hijo), ni estar
 * referenciado por un `<use>`.
 */
export function ungroupBlocker(element: Element, root: SVGSVGElement): UngroupBlocker | null {
  if (element.namespaceURI !== SVG_NS || element.localName !== "g") return "not-a-group";
  const style = getComputedStyle(element);
  if (
    style.opacity !== "1" ||
    style.filter !== "none" ||
    style.clipPath !== "none" ||
    style.mask !== "none" ||
    style.mixBlendMode !== "normal"
  ) {
    return "effects";
  }
  if (element.id) {
    const reference = `#${element.id}`;
    const referenced = [...root.querySelectorAll("*")].some(
      (other) =>
        other.getAttribute("href") === reference ||
        other.getAttributeNS("http://www.w3.org/1999/xlink", "href") === reference,
    );
    if (referenced) return "referenced";
  }
  return null;
}

/**
 * Desagrupa: los hijos del grupo pasan a su padre, en su lugar, con la transformación y los
 * estilos que heredaban del grupo, de modo que se ven igual. Los grupos que no se pueden desagrupar
 * sin cambiar el aspecto (ver `ungroupBlocker`) se dejan como están.
 *
 * @returns Los elementos que estaban dentro de los grupos desagrupados.
 */
export function ungroup(groups: readonly Element[], root: SVGSVGElement): Element[] {
  const released: Element[] = [];
  for (const g of groups) {
    const parent = g.parentElement;
    if (!parent || ungroupBlocker(g, root)) continue;
    // Los nodos que no son elementos (texto con espacios, comentarios) se van con el grupo.
    const children = [...g.children];
    for (const child of children) {
      if (!reparent(child, parent, g, root)) return released;
      released.push(child);
    }
    g.remove();
  }
  return released;
}
