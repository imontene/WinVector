const XLINK_NS = "http://www.w3.org/1999/xlink";
const URL_REFERENCE = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

/** El elemento y todos sus descendientes. */
export const subtree = (element: Element): Element[] => [element, ...element.querySelectorAll("*")];

/** Identificadores a los que se refiere un elemento con `url(#id)` o `href="#id"`, sin sus descendientes. */
function ownReferences(element: Element): string[] {
  const ids: string[] = [];
  for (const attribute of element.attributes) {
    const isHref =
      attribute.localName === "href" &&
      (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NS);
    if (isHref && attribute.value.startsWith("#")) ids.push(attribute.value.slice(1));
    for (const match of attribute.value.matchAll(URL_REFERENCE)) {
      if (match[2]) ids.push(match[2]);
    }
  }
  // Las referencias dentro de <style> también cuentan (fill: url(#degradado)).
  if (element.localName === "style") {
    for (const match of element.textContent.matchAll(URL_REFERENCE)) {
      if (match[2]) ids.push(match[2]);
    }
  }
  return ids;
}

/**
 * Cuántas veces se hace referencia a un identificador en `root`: cada `url(#id)` o `href="#id"` de
 * cada elemento (salvo `except`) cuenta una vez, también en las hojas de estilos.
 */
export function countReferences(root: Element, id: string, except?: Element): number {
  let count = 0;
  for (const node of subtree(root)) {
    if (node === except) continue;
    for (const found of ownReferences(node)) if (found === id) count += 1;
  }
  return count;
}

/** Identificadores a los que se refieren los elementos o sus descendientes. */
export function referencedIds(elements: Iterable<Element>): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    for (const node of subtree(element)) for (const id of ownReferences(node)) ids.add(id);
  }
  return ids;
}

/**
 * Elementos de `source` a los que se refieren los elementos, también de forma indirecta (un
 * degradado que hereda de otro con href), sin contar los que están dentro de los propios elementos.
 */
export function dependencies(elements: readonly Element[], source: ParentNode): Element[] {
  const found = new Map<string, Element>();
  const inside = (candidate: Element) => elements.some((element) => element.contains(candidate));
  let pending = [...referencedIds(elements)];
  while (pending.length > 0) {
    const next: string[] = [];
    for (const id of pending) {
      if (found.has(id)) continue;
      const target = source.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!target || inside(target)) continue;
      found.set(id, target);
      next.push(...referencedIds([target]));
    }
    pending = next;
  }
  // Un elemento que contiene a otro ya lo lleva dentro.
  const list = [...found.values()];
  return list.filter(
    (element) => !list.some((other) => other !== element && other.contains(element)),
  );
}

/** Cambia las referencias `url(#viejo)` y `href="#viejo"` por los identificadores nuevos. */
export function renameReferences(
  elements: Iterable<Element>,
  renamed: ReadonlyMap<string, string>,
): void {
  if (renamed.size === 0) return;
  const replaceUrls = (text: string) =>
    text.replace(URL_REFERENCE, (whole, quote: string, id: string) => {
      const next = renamed.get(id);
      return next ? `url(${quote}#${next}${quote})` : whole;
    });
  for (const element of elements) {
    for (const node of subtree(element)) {
      for (const attribute of [...node.attributes]) {
        const isHref =
          attribute.localName === "href" &&
          (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NS);
        let value = attribute.value;
        if (isHref && value.startsWith("#")) {
          const next = renamed.get(value.slice(1));
          if (next) value = `#${next}`;
        }
        value = replaceUrls(value);
        if (value !== attribute.value)
          node.setAttributeNS(attribute.namespaceURI, attribute.name, value);
      }
      if (node.localName === "style" && node.textContent) {
        const text = replaceUrls(node.textContent);
        if (text !== node.textContent) node.textContent = text;
      }
    }
  }
}
