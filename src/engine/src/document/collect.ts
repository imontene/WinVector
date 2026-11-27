/**
 * Limpieza de definiciones (issue #113).
 *
 * - Automática: los degradados que crea WinVector llevan `data-winvector-collect`. Al cerrar cada
 *   paso del historial, los que ya nada usa se borran en ese mismo paso (deshacer los devuelve).
 *   Los de otros programas se conservan aunque no se usen.
 * - A petición (`cleanDefinitions`): se borran todas las definiciones de `<defs>` a las que nada
 *   llega desde el contenido, también a través de otras definiciones (cadenas `href`).
 */

/** Atributo de las definiciones que WinVector crea y puede borrar cuando nada las usa. */
export const COLLECT_ATTRIBUTE = "data-winvector-collect";

const XLINK_NS = "http://www.w3.org/1999/xlink";
const URL_REFERENCE = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

/** Identificadores a los que se refiere un elemento con `url(#id)` o `href="#id"`, sin sus hijos. */
function references(element: Element): string[] {
  const ids: string[] = [];
  for (const attribute of element.attributes) {
    const isHref =
      attribute.localName === "href" &&
      (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NS);
    if (isHref && attribute.value.startsWith("#")) ids.push(attribute.value.slice(1));
    if (attribute.value.includes("url(")) {
      for (const match of attribute.value.matchAll(URL_REFERENCE)) if (match[2]) ids.push(match[2]);
    }
  }
  if (element.localName === "style") {
    for (const match of element.textContent.matchAll(URL_REFERENCE))
      if (match[2]) ids.push(match[2]);
  }
  return ids;
}

/** True si algo del documento, salvo el propio elemento y lo que contiene, se refiere a `id`. */
function isReferenced(root: Element, element: Element, id: string): boolean {
  const name = CSS.escape(`#${id}`);
  // Solo los elementos con algún atributo que lo nombre: los busca el navegador.
  const candidates = root.querySelectorAll(
    `[fill*="${name}"], [stroke*="${name}"], [style*="${name}"], [href="${name}"], [*|href="${name}"], style`,
  );
  for (const candidate of candidates) {
    if (element.contains(candidate)) continue;
    if (references(candidate).includes(id)) return true;
  }
  return false;
}

/**
 * Borra las definiciones de WinVector que nada usa, también las que solo usaban otras que se
 * borran. Devuelve cuántas borró.
 */
export function collectDefinitions(root: Element): number {
  let removed = 0;
  for (;;) {
    const orphans = [...root.querySelectorAll(`[${COLLECT_ATTRIBUTE}]`)].filter(
      (element) => !element.id || !isReferenced(root, element, element.id),
    );
    if (orphans.length === 0) return removed;
    for (const orphan of orphans) orphan.remove();
    removed += orphans.length;
  }
}

/** True si el elemento está dentro de un `<defs>` (o lo es). */
const inDefs = (element: Element) => element.closest("defs") !== null;

/**
 * Definiciones de `<defs>` a las que no se llega desde el contenido del documento, ni directamente
 * ni a través de otras definiciones. Solo las de primer nivel con id; una que contiene algo que sí
 * se usa se conserva.
 */
export function unusedDefinitions(root: Element): Element[] {
  const byId = new Map<string, Element>();
  for (const element of root.querySelectorAll("[id]")) {
    if (!byId.has(element.id)) byId.set(element.id, element);
  }
  // Desde todo lo que no está en <defs> (y las hojas de estilos, estén donde estén).
  const reached = new Set<Element>();
  const pending: Element[] = [];
  const visit = (element: Element) => {
    for (const id of references(element)) {
      const target = byId.get(id);
      if (target && !reached.has(target)) {
        reached.add(target);
        pending.push(target);
      }
    }
  };
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!inDefs(element) || element.localName === "style") visit(element);
  }
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    visit(next);
    for (const inside of next.querySelectorAll("*")) visit(inside);
  }
  const used = (element: Element) =>
    reached.has(element) || [...reached].some((other) => element.contains(other));
  return [...root.querySelectorAll("defs > [id]")].filter((element) => !used(element));
}

/** Borra las definiciones que nada usa (la orden «Limpiar definiciones sin usar»). */
export function cleanDefinitions(root: Element): number {
  const unused = unusedDefinitions(root);
  for (const element of unused) element.remove();
  return unused.length;
}
