import type { SvgDocument } from "../document";
import { moveBy, outermost, transformItems } from "../transform";
import { renameReferences, subtree } from "./references";

/** Desplazamiento de los duplicados, en unidades del documento, para que se vean junto al original. */
export const DUPLICATE_OFFSET = 10;

/**
 * Duplica los elementos: cada copia va justo encima de su original, desplazada, con identificadores
 * nuevos (y las referencias internas de la copia apuntando a ellos).
 *
 * @returns Las copias, en el mismo orden.
 */
export function duplicate(items: readonly Element[], document_: SvgDocument): Element[] {
  const copies: Element[] = [];
  for (const item of outermost(items)) {
    const copy = item.cloneNode(true) as Element;
    const renamed = new Map<string, string>();
    for (const element of subtree(copy)) {
      if (!element.id) continue;
      const next = document_.createId(element.id);
      renamed.set(element.id, next);
      element.id = next;
    }
    renameReferences([copy], renamed);
    item.after(copy);
    copies.push(copy);
  }
  transformItems(copies, moveBy(DUPLICATE_OFFSET, DUPLICATE_OFFSET), document_.root);
  return copies;
}

/** Elimina los elementos del documento. */
export function remove(items: readonly Element[]): number {
  const outer = outermost(items);
  for (const item of outer) item.remove();
  return outer.length;
}
