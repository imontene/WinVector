import { SVG_NS, type SvgDocument } from "../document";
import { invert, multiply, translation, type Point } from "../geometry";
import { selectionBounds } from "../selection";
import { INHERITED_PROPERTIES } from "../structure";
import { localTransform, parentToRoot, simplestTransform, transformItems } from "../transform";
import { renameReferences, subtree } from "./references";

/** Elementos del SVG pegado que no se copian: no se ven o son peligrosos. */
const SKIPPED = new Set(["title", "desc", "metadata", "style", "script", "namedview"]);

const BAKED = [...INHERITED_PROPERTIES, "opacity", "filter", "clip-path", "mask", "mix-blend-mode"];

export interface PasteOptions {
  /** Punto del documento donde centrar lo pegado (el puntero), o `null` para desplazarlo. */
  readonly at: Point | null;
  /** Desplazamiento respecto a la posición original cuando no se pega en el puntero. */
  readonly offset: number;
}

/** Lee el SVG del portapapeles. Devuelve `null` si no es un SVG válido. */
function parse(text: string): SVGSVGElement | null {
  const xml = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ""), "image/svg+xml");
  if (xml.getElementsByTagNameNS("*", "parsererror").length > 0) return null;
  const root = xml.documentElement;
  return root.namespaceURI === SVG_NS && root.localName === "svg"
    ? (root as unknown as SVGSVGElement)
    : null;
}

/** Quita lo que podría ejecutar código: scripts, manejadores de eventos y enlaces javascript:. */
function sanitize(root: Element): void {
  for (const script of [...root.getElementsByTagNameNS("*", "script")]) script.remove();
  for (const element of subtree(root)) {
    for (const attribute of [...element.attributes]) {
      const javascript = attribute.localName === "href" && /^\s*javascript:/i.test(attribute.value);
      if (/^on/i.test(attribute.localName) || javascript) element.removeAttributeNode(attribute);
    }
  }
}

/**
 * Convierte las hojas de estilos del SVG pegado en atributos de presentación, para que no choquen
 * con las del documento (Illustrator, por ejemplo, usa .st0, .st1… en todos sus archivos). Para
 * calcular los estilos se muestra un momento el SVG en un shadow root, aislado del resto.
 */
function bakeStylesheets(svg: SVGSVGElement): SVGSVGElement {
  const styles = [...svg.getElementsByTagNameNS(SVG_NS, "style")];
  if (styles.length === 0) return svg;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
  const shadow = host.attachShadow({ mode: "open" });
  const shown = document.importNode(svg, true);
  shadow.append(shown);
  document.body.append(host);
  try {
    const elements = subtree(shown).filter((element) => element instanceof SVGElement);
    const before = new Map(
      elements.map((element) => {
        const computed = getComputedStyle(element);
        return [element, new Map(BAKED.map((name) => [name, computed.getPropertyValue(name)]))];
      }),
    );
    for (const style of shown.getElementsByTagNameNS(SVG_NS, "style")) style.textContent = "";
    for (const element of elements) element.removeAttribute("class");
    // En orden de documento: lo que se fija en un padre ya lo heredan sus hijos.
    for (const element of elements) {
      for (const [name, value] of before.get(element) ?? []) {
        if (getComputedStyle(element).getPropertyValue(name) === value) continue;
        element.setAttribute(name, value);
        if (getComputedStyle(element).getPropertyValue(name) !== value) {
          element.style.setProperty(name, value);
        }
      }
    }
    for (const style of [...shown.getElementsByTagNameNS(SVG_NS, "style")]) style.remove();
    return shown;
  } finally {
    host.remove();
  }
}

/** Texto de un elemento sin su id, para saber si una definición pegada ya existe en el documento. */
function signature(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.removeAttribute("id");
  return new XMLSerializer().serializeToString(clone).replace(/\s+/g, " ");
}

/**
 * Pega un SVG en el documento, dentro de `scope` (el grupo en el que está el usuario):
 * - Sus definiciones van a `<defs>`. Una definición idéntica a una que ya existe con el mismo id se
 *   reutiliza; si el id ya se usa para otra cosa, se renombra y se actualizan sus referencias.
 * - Los objetos van al frente de `scope`, con su aspecto (las hojas de estilos se convierten en
 *   atributos) y sin scripts.
 * - Se colocan centrados en `at` o desplazados `offset` unidades respecto a su posición original.
 *
 * @returns Los objetos pegados, o `[]` si el texto no es un SVG o no tiene nada que pegar.
 */
export function pasteSvg(
  text: string,
  document_: SvgDocument,
  scope: Element,
  options: PasteOptions,
): Element[] {
  const parsed = parse(text);
  if (!parsed) return [];
  sanitize(parsed);
  const source = bakeStylesheets(parsed);
  const root = document_.root;
  const target = root.ownerDocument;

  // Identificadores: se reutilizan las definiciones idénticas y se renombran los que chocan.
  const renamed = new Map<string, string>();
  const reused = new Set<Element>();
  for (const element of source.querySelectorAll("[id]")) {
    const id = element.id;
    const existing = root.querySelector(`[id="${CSS.escape(id)}"]`);
    if (!existing) {
      document_.createId(id);
      continue;
    }
    const inDefs = element.parentElement?.localName === "defs";
    if (inDefs && signature(existing) === signature(element)) reused.add(element);
    else renamed.set(id, document_.createId(id));
  }
  for (const [oldId, newId] of renamed) {
    const element = source.querySelector(`[id="${CSS.escape(oldId)}"]`);
    if (element) element.id = newId;
  }
  renameReferences([source], renamed);

  const definitions: Element[] = [];
  const items: Element[] = [];
  for (const child of [...source.children]) {
    if (child.namespaceURI !== SVG_NS || SKIPPED.has(child.localName)) continue;
    if (child.localName === "defs") {
      definitions.push(...[...child.children].filter((definition) => !reused.has(definition)));
    } else {
      items.push(child);
    }
  }
  if (items.length === 0) return [];

  if (definitions.length > 0) {
    const defs = document_.getOrCreateDefs();
    for (const definition of definitions) defs.append(target.importNode(definition, true));
  }
  const pasted = items.map((item) => {
    const imported = target.importNode(item, true);
    scope.append(imported);
    return imported;
  });

  // Los objetos traen coordenadas del elemento raíz: dentro de un grupo transformado se compensa.
  if (scope !== root) {
    for (const element of pasted) {
      const parent = parentToRoot(element, root);
      const inverse = parent ? invert(parent) : null;
      if (inverse)
        element.setAttribute(
          "transform",
          simplestTransform(multiply(inverse, localTransform(element))),
        );
    }
  }

  const bounds = selectionBounds(pasted, root);
  if (bounds) {
    const dx = options.at ? options.at.x - (bounds.x + bounds.width / 2) : options.offset;
    const dy = options.at ? options.at.y - (bounds.y + bounds.height / 2) : options.offset;
    transformItems(pasted, translation(dx, dy), root);
  }
  return pasted;
}
