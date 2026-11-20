import { isSelectable } from "../selection";

/** Cambios del orden de apilado. */
export type ArrangeAction = "front" | "back" | "forward" | "backward";

function documentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/** Hermanos que se pintan (se saltan defs, title, metadatos…). */
const paintedSiblings = (parent: Element) => [...parent.children].filter(isSelectable);

/**
 * Cambia el orden de apilado de los elementos dentro de su padre: al frente, al fondo, un nivel
 * arriba o un nivel abajo. Los elementos de padres distintos se ordenan cada uno en el suyo, y los
 * seleccionados conservan su orden relativo. Los metadatos y las definiciones no cuentan como
 * niveles: "al fondo" deja el elemento detrás de los demás objetos, no delante de `<defs>`.
 *
 * @returns `true` si ha cambiado algo.
 */
export function arrange(items: readonly Element[], action: ArrangeAction): boolean {
  const byParent = new Map<Element, Element[]>();
  for (const item of [...items].sort(documentOrder)) {
    const parent = item.parentElement;
    if (!parent) continue;
    byParent.set(parent, [...(byParent.get(parent) ?? []), item]);
  }

  let changed = false;
  for (const [parent, group] of byParent) {
    const before = paintedSiblings(parent);
    const selected = new Set(group);
    switch (action) {
      case "front": {
        // Detrás del último objeto no seleccionado, en su orden: cada uno después del anterior.
        let anchor: Element | undefined = before.filter((sibling) => !selected.has(sibling)).at(-1);
        if (!anchor) break;
        for (const item of group) {
          parent.insertBefore(item, anchor.nextSibling);
          anchor = item;
        }
        break;
      }
      case "back": {
        const first = before.find((sibling) => !selected.has(sibling));
        if (first) for (const item of group) parent.insertBefore(item, first);
        break;
      }
      case "forward":
        // De arriba abajo: cada elemento salta por encima del siguiente objeto no seleccionado.
        for (const item of [...group].reverse()) {
          const siblings = paintedSiblings(parent);
          const next = siblings[siblings.indexOf(item) + 1];
          if (next && !selected.has(next)) parent.insertBefore(item, next.nextSibling);
        }
        break;
      case "backward":
        for (const item of group) {
          const siblings = paintedSiblings(parent);
          const previous = siblings[siblings.indexOf(item) - 1];
          if (previous && !selected.has(previous)) parent.insertBefore(item, previous);
        }
        break;
    }
    const after = paintedSiblings(parent);
    changed ||= after.some((element, index) => element !== before[index]);
  }
  return changed;
}
