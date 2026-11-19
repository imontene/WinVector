import type { SelectedElement } from "../bridge";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Elementos que nunca se seleccionan: metadatos, estilos, scripts y animaciones. */
const NON_SELECTABLE = new Set([
  "title",
  "desc",
  "metadata",
  "style",
  "script",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "mpath",
]);

/**
 * Elementos que no se pintan por sí mismos: su contenido solo se usa por referencia. Nada de lo que
 * contienen se selecciona.
 */
const NON_RENDERED = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
]);

/** Elementos cuyo contenido se selecciona como un todo (un tspan pertenece a su text). */
const ATOMIC = new Set(["text", "foreignObject"]);

/** Contenedores en los que se puede entrar con doble clic (un svg anidado también lo es). */
const CONTAINERS = new Set(["g", "a", "switch", "svg"]);

const isSvg = (element: Element, names: ReadonlySet<string>) =>
  element.namespaceURI === SVG_NS && names.has(element.localName);

/** True si se puede entrar en el elemento para seleccionar sus hijos. */
export function isContainer(element: Element): boolean {
  return isSvg(element, CONTAINERS);
}

/**
 * True si el elemento, como hijo de su padre, se puede seleccionar: es un elemento SVG que se pinta
 * y no es un metadato. No comprueba sus antepasados (ver `isInsideRenderedContent`).
 */
export function isSelectable(element: Element): boolean {
  return (
    element.namespaceURI === SVG_NS &&
    !NON_SELECTABLE.has(element.localName) &&
    !NON_RENDERED.has(element.localName)
  );
}

/** Hijos de `scope` que se pueden seleccionar, en orden de documento. */
export function selectableChildren(scope: Element): Element[] {
  return [...scope.children].filter(isSelectable);
}

/** Resultado de buscar qué se selecciona bajo el puntero. */
export interface Pick {
  /** Elemento que se selecciona. */
  readonly element: Element;
  /**
   * Grupo desde el que se ha elegido: `scope` si el elemento está dentro, o el antepasado común más
   * cercano si el usuario ha hecho clic fuera del grupo en el que estaba.
   */
  readonly scope: Element;
}

export interface PickOptions {
  /** Grupo en el que está el usuario. Por defecto, el elemento raíz. */
  readonly scope?: Element;
  /** Selecciona el elemento más profundo bajo el puntero, sin entrar en grupos (`Ctrl`+clic). */
  readonly deep?: boolean;
}

/**
 * Devuelve qué se selecciona al hacer clic sobre `target`, o `null` si el clic cae en el fondo del
 * documento o en algo que no se puede seleccionar.
 *
 * Un clic selecciona el hijo del grupo actual (`scope`) que contiene el punto, como en las
 * aplicaciones de diseño: en un SVG exportado, primero se selecciona la capa o el grupo, y con doble
 * clic se entra en él. Con `deep` se selecciona directamente el elemento más profundo. En los dos
 * casos, el contenido de un `text` o un `foreignObject` se selecciona como un todo.
 */
export function pickAt(
  target: EventTarget | null,
  root: SVGSVGElement,
  options: PickOptions = {},
): Pick | null {
  if (!(target instanceof Element) || target === root || !root.contains(target)) {
    return null;
  }

  // Cadena de antepasados desde el elemento tocado hasta el hijo de la raíz.
  const chain: Element[] = [];
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.namespaceURI === SVG_NS && !isSelectable(node)) return null;
    chain.unshift(node);
  }

  // El contenido de un texto (tspan, textPath…) se selecciona con el texto.
  const atomic = chain.findIndex((node) => isSvg(node, ATOMIC));
  const path = atomic === -1 ? chain : chain.slice(0, atomic + 1);
  const deepest = path.at(-1);
  if (!deepest || !isSelectable(deepest)) return null;

  const requested = options.scope ?? root;
  if (options.deep) {
    return { element: deepest, scope: requested.contains(deepest) ? requested : root };
  }

  // Si el clic cae fuera del grupo actual, se sube hasta el antepasado común.
  let scope: Element = requested;
  while (scope !== root && !scope.contains(deepest)) {
    scope = scope.parentElement ?? root;
  }
  const element = scope === root ? path[0] : path[path.indexOf(scope) + 1];
  return element ? { element, scope } : null;
}

/** Datos de un elemento para el evento selection.changed. */
export function describeElement(element: Element): SelectedElement {
  return { id: element.id === "" ? null : element.id, tagName: element.localName };
}
