import type { SelectedElement } from "../bridge";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Elementos que nunca se seleccionan: metadatos y definiciones. */
const NON_SELECTABLE = new Set(["defs", "title", "desc", "metadata", "style", "script"]);

/** Elementos cuyo contenido se selecciona como un todo (un tspan pertenece a su text). */
const ATOMIC = new Set(["text"]);

/**
 * Devuelve el elemento que se selecciona al hacer clic sobre `target`, o `null` si el clic cae en
 * el fondo del documento.
 *
 * Fase 0: se selecciona el elemento más profundo bajo el puntero, salvo que esté dentro de un
 * `text` (se selecciona el texto entero). Los grupos se atraviesan; entrar y salir de grupos llega
 * en la Fase 1.
 */
export function selectableElementAt(
  target: EventTarget | null,
  root: SVGSVGElement,
): Element | null {
  if (!(target instanceof Element) || target === root || !root.contains(target)) {
    return null;
  }

  let candidate: Element = target;
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.namespaceURI === SVG_NS && NON_SELECTABLE.has(node.localName)) {
      return null;
    }
    if (node.namespaceURI === SVG_NS && ATOMIC.has(node.localName)) {
      candidate = node;
    }
  }
  return candidate;
}

/** Datos de un elemento para el evento selection.changed. */
export function describeElement(element: Element): SelectedElement {
  return { id: element.id === "" ? null : element.id, tagName: element.localName };
}
