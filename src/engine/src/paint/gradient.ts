import { countReferences } from "../clipboard/references";
import { declaresProperty, setDeclaration } from "../style/declarations";
import { paintOf } from "../style/style";
import { formatNumber } from "../transform";

/**
 * Degradados lineales y radiales (issue #108, ADR 0009).
 *
 * Se leen como los dibuja el navegador: siguiendo las cadenas `href` (o `xlink:href`), un atributo
 * que falta se hereda del degradado referenciado, y las paradas son las del primero de la cadena que
 * tenga. Al cambiar el degradado de un objeto se escribe solo lo que cambia, siempre en un degradado
 * propio del objeto: si otro objeto lo usa, antes se hace una copia (ver `ownGradient`).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export type GradientKind = "linear" | "radial";
export type GradientUnits = "objectBoundingBox" | "userSpaceOnUse";
export type SpreadMethod = "pad" | "reflect" | "repeat";
export type PaintProperty = "fill" | "stroke";

/** Parada de un degradado: posición de 0 a 1, color `#rrggbb` y opacidad de 0 a 1. */
export interface GradientStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity: number;
}

/** Geometría de un degradado lineal, en las unidades del degradado (fracciones de la caja o del documento). */
export interface LinearGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Geometría de un degradado radial: círculo final (cx, cy, r) y foco (fx, fy, fr). */
export interface RadialGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx: number;
  readonly fy: number;
  readonly fr: number;
}

/** Degradado tal como se dibuja, con lo heredado por `href` ya resuelto. */
export interface Gradient {
  /** El degradado al que hace referencia la pintura (el primero de la cadena). */
  readonly element: SVGGradientElement;
  readonly kind: GradientKind;
  readonly units: GradientUnits;
  readonly spread: SpreadMethod;
  /** `gradientTransform` tal como está escrito, o `null`. */
  readonly transform: string | null;
  readonly stops: readonly GradientStop[];
  readonly linear: LinearGeometry | null;
  readonly radial: RadialGeometry | null;
}

const GEOMETRY: Readonly<Record<GradientKind, readonly string[]>> = {
  linear: ["x1", "y1", "x2", "y2"],
  radial: ["cx", "cy", "r", "fx", "fy", "fr"],
};

/** True si el elemento es un degradado lineal o radial de SVG. */
export const isGradient = (element: Element | null | undefined): element is SVGGradientElement =>
  element?.namespaceURI === SVG_NS &&
  (element.localName === "linearGradient" || element.localName === "radialGradient");

const kindOf = (element: SVGGradientElement): GradientKind =>
  element.localName === "radialGradient" ? "radial" : "linear";

/** El `href` de un elemento (SVG 2 o `xlink:href`), sin la almohadilla, o `null`. */
function hrefOf(element: Element): string | null {
  const value = element.getAttribute("href") ?? element.getAttributeNS(XLINK_NS, "href");
  return value?.startsWith("#") ? value.slice(1) : null;
}

/** Busca un elemento por su id dentro del documento (que vive en un shadow root). */
export function byId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[id="${CSS.escape(id)}"]`);
}

/** El degradado y los que hereda por `href`, en orden; se para en un ciclo o en lo que no lo es. */
export function gradientChain(element: SVGGradientElement, root: ParentNode): SVGGradientElement[] {
  const chain: SVGGradientElement[] = [element];
  const seen = new Set<Element>(chain);
  for (let id = hrefOf(element); id !== null;) {
    const next = byId(root, id);
    if (!isGradient(next) || seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    id = hrefOf(next);
  }
  return chain;
}

/** Primer valor del atributo en la cadena, o `null`. */
const inherited = (chain: readonly Element[], name: string): string | null =>
  chain.find((element) => element.hasAttribute(name))?.getAttribute(name) ?? null;

/** Paradas propias de un degradado (sus hijos `<stop>`). */
export const ownStops = (element: Element): SVGStopElement[] =>
  [...element.children].filter(
    (child): child is SVGStopElement => child.namespaceURI === SVG_NS && child.localName === "stop",
  );

/** Un número o un porcentaje (`"50%"` → 0,5); `fallback` si no es válido. */
function fraction(text: string | null, fallback: number): number {
  if (text === null) return fallback;
  const trimmed = text.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return trimmed.endsWith("%") ? value / 100 : value;
}

/** Color `#rrggbb` y opacidad de una parada, con lo que dice su estilo calculado. */
function stopPaint(stop: SVGStopElement): { color: string; opacity: number } {
  const style = getComputedStyle(stop);
  const rgba =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(
      style.stopColor.trim(),
    );
  const alpha = rgba?.[4] === undefined ? 1 : Number(rgba[4]) / (rgba[5] ? 100 : 1);
  const color = rgba
    ? paintOf(`rgb(${rgba[1] ?? "0"}, ${rgba[2] ?? "0"}, ${rgba[3] ?? "0"})`)
    : paintOf(style.stopColor);
  const opacity = Number.parseFloat(style.stopOpacity);
  return {
    color: color === "none" ? "#000000" : color,
    opacity: Math.min(1, Math.max(0, (Number.isFinite(opacity) ? opacity : 1) * alpha)),
  };
}

/** Paradas como se dibujan: cada posición entre 0 y 1 y nunca menor que la anterior. */
function readStops(stops: readonly SVGStopElement[]): GradientStop[] {
  let previous = 0;
  return stops.map((stop) => {
    const offset = Math.max(
      previous,
      Math.min(1, Math.max(0, fraction(stop.getAttribute("offset"), 0))),
    );
    previous = offset;
    const paint = stopPaint(stop);
    return { offset: round(offset), color: paint.color, opacity: round(paint.opacity) };
  });
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Lee un degradado con lo que hereda por `href`. */
export function readGradient(element: SVGGradientElement, root: ParentNode): Gradient {
  const chain = gradientChain(element, root);
  const kind = kindOf(element);
  const units =
    inherited(chain, "gradientUnits") === "userSpaceOnUse" ? "userSpaceOnUse" : "objectBoundingBox";
  const spreadText = inherited(chain, "spreadMethod");
  const spread: SpreadMethod =
    spreadText === "reflect" || spreadText === "repeat" ? spreadText : "pad";
  const stopsOwner = chain.find((gradient) => ownStops(gradient).length > 0);
  const value = (name: string, fallback: number) => fraction(inherited(chain, name), fallback);
  // Sin valor, los porcentajes por defecto son del espacio del degradado (50 % de la caja).
  const linear: LinearGeometry | null =
    kind === "linear"
      ? { x1: value("x1", 0), y1: value("y1", 0), x2: value("x2", 1), y2: value("y2", 0) }
      : null;
  let radial: RadialGeometry | null = null;
  if (kind === "radial") {
    const cx = value("cx", 0.5);
    const cy = value("cy", 0.5);
    radial = {
      cx,
      cy,
      r: value("r", 0.5),
      fx: value("fx", cx),
      fy: value("fy", cy),
      fr: value("fr", 0),
    };
  }
  return {
    element,
    kind,
    units,
    spread,
    transform: inherited(chain, "gradientTransform"),
    stops: stopsOwner ? readStops(ownStops(stopsOwner)) : [],
    linear,
    radial,
  };
}

/** Cuántas veces aparece `url(#id)` en un texto. */
const urlCount = (text: string, id: string): number =>
  text.includes(`#${id}`)
    ? [...text.matchAll(/url\(\s*(['"]?)[^'")]*#([^'")\s]+)\1\s*\)/g)].filter((m) => m[2] === id)
        .length
    : 0;

/** Identificador de la pintura `url(#id)` de un valor calculado, o `null`. */
export function paintId(computed: string): string | null {
  const match = /url\(\s*(['"]?)[^'")]*#([^'")\s]+)\1\s*\)/.exec(computed);
  return match?.[2] ?? null;
}

/** El `<svg>` más exterior del documento al que pertenece el elemento. */
export function documentRoot(element: Element): SVGSVGElement | null {
  let svg = element instanceof SVGSVGElement ? element : (element as SVGElement).ownerSVGElement;
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
  return svg ?? null;
}

/** Degradado de una pintura para la interfaz (`GradientPaint` del contrato). */
export interface GradientSummary {
  readonly id: string;
  readonly kind: GradientKind;
  readonly spread: SpreadMethod;
  readonly stops: readonly GradientStop[];
  readonly users: number;
}

/**
 * Degradado común del relleno o el trazo de varios elementos, o `null` si alguno no pinta con un
 * degradado o no todos usan el mismo.
 */
export function commonGradient(
  targets: readonly Element[],
  property: PaintProperty,
): GradientSummary | null {
  const [first] = targets;
  const root = first ? documentRoot(first) : null;
  if (!first || !root) return null;
  const gradients = targets.map((target) => paintGradient(target, property, root));
  const [gradient] = gradients;
  if (!gradient || gradients.some((other) => other !== gradient)) return null;
  const read = readGradient(gradient, root);
  return {
    id: gradient.id,
    kind: read.kind,
    spread: read.spread,
    stops: read.stops,
    users: gradientUsers(gradient, root),
  };
}

/** Degradado que pinta el relleno o el trazo de un elemento, o `null`. */
export function paintGradient(
  element: Element,
  property: PaintProperty,
  root: ParentNode,
): SVGGradientElement | null {
  const id = paintId(getComputedStyle(element).getPropertyValue(property));
  const found = id === null ? null : byId(root, id);
  return isGradient(found) ? found : null;
}

/** Cuántos objetos (que no son degradados) pintan con el degradado directamente. */
export function gradientUsers(gradient: SVGGradientElement, root: Element): number {
  if (!gradient.id) return 0;
  const id = gradient.id;
  let users = 0;
  for (const element of root.querySelectorAll("*")) {
    if (isGradient(element) || element.localName === "style") continue;
    for (const attribute of element.attributes) users += urlCount(attribute.value, id);
  }
  return users;
}

// ---------------------------------------------------------------------------------------------
// Escritura.
// ---------------------------------------------------------------------------------------------

/** Identificador libre en el documento a partir de otro: `cielo` → `cielo-2`, `cielo-3`… */
export function freeId(root: ParentNode, base: string): string {
  const stem = base.replace(/-\d+$/, "") || "degradado";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${String(n)}`;
    if (!byId(root, candidate)) return candidate;
  }
}

/** Pone la pintura `url(#id)` en el relleno o el trazo, donde estuviera declarada. */
export function setPaintReference(element: Element, property: PaintProperty, id: string): void {
  const value = `url(#${id})`;
  const style = element.getAttribute("style");
  if (declaresProperty(style, property)) {
    element.setAttribute("style", setDeclaration(style, property, value));
    return;
  }
  const previous = element.getAttribute(property);
  element.setAttribute(property, value);
  // Una regla de CSS más fuerte que el atributo: se declara en el atributo style.
  if (paintId(getComputedStyle(element).getPropertyValue(property)) !== id) {
    if (previous === null) element.removeAttribute(property);
    else element.setAttribute(property, previous);
    element.setAttribute("style", setDeclaration(style, property, value));
  }
}

/**
 * El degradado propio del relleno o el trazo de un objeto, listo para cambiarlo: si se usa en otro
 * sitio (otro objeto, el otro de sus pinturas, una hoja de estilos o un degradado que lo hereda), se
 * hace una copia justo detrás, con un id nuevo y su mismo `href`, y el objeto pasa a usarla. Así un
 * cambio nunca alcanza a otros objetos. `null` si el objeto no pinta con un degradado.
 */
export function ownGradient(
  target: Element,
  property: PaintProperty,
  root: Element,
): SVGGradientElement | null {
  const gradient = paintGradient(target, property, root);
  if (!gradient) return null;
  if (gradient.id && isPrivate(gradient.id, target, property, root)) return gradient;
  const copy = gradient.cloneNode(false) as SVGGradientElement;
  copy.id = freeId(root, gradient.id || "degradado");
  for (const stop of ownStops(gradient)) {
    const clone = stop.cloneNode(true) as Element;
    clone.removeAttribute("id");
    copy.append(clone);
  }
  gradient.after(copy);
  setPaintReference(target, property, copy.id);
  return copy;
}

/**
 * True si solo el objeto usa el degradado, y para esa pintura: lo declara él mismo (no lo hereda de
 * un grupo ni de una clase de CSS) y nada más se refiere a él.
 */
function isPrivate(id: string, target: Element, property: PaintProperty, root: Element): boolean {
  const style = target.getAttribute("style") ?? "";
  const own = declaresProperty(style, property)
    ? urlCount(style, id) > 0
    : urlCount(target.getAttribute(property) ?? "", id) > 0;
  return own && countReferences(root, id) === 1;
}

/** Cambio de un degradado: solo cambia lo que se indica. */
export interface GradientChange {
  readonly stops?: readonly GradientStop[];
  readonly spread?: SpreadMethod;
  readonly units?: GradientUnits;
  readonly linear?: Partial<LinearGeometry>;
  readonly radial?: Partial<RadialGeometry>;
  /** `gradientTransform`; `null` lo quita. */
  readonly transform?: string | null;
}

/** Cambia un atributo solo si su valor (o el heredado) es otro. */
function writeAttribute(element: Element, chain: readonly Element[], name: string, value: string) {
  if (inherited(chain, name) === value && !element.hasAttribute(name)) return;
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Cambia una propiedad de una parada donde esté declarada (su style o su atributo). */
function writeStopProperty(stop: Element, property: string, value: string | null): void {
  const style = stop.getAttribute("style");
  if (declaresProperty(style, property)) {
    const next = setDeclaration(style, property, value);
    if (next.trim() === "") stop.removeAttribute("style");
    else if (next !== style) stop.setAttribute("style", next);
    return;
  }
  if (value === null) stop.removeAttribute(property);
  else if (stop.getAttribute(property) !== value) stop.setAttribute(property, value);
}

/** Escribe las paradas como paradas propias, reutilizando las que ya tiene. */
function writeStops(
  gradient: SVGGradientElement,
  root: ParentNode,
  stops: readonly GradientStop[],
) {
  let own = ownStops(gradient);
  if (own.length === 0) {
    // Las heredaba: pasan a ser suyas (copiadas de la cadena) antes de cambiarlas.
    const source = gradientChain(gradient, root).find((g) => ownStops(g).length > 0);
    for (const stop of source ? ownStops(source) : []) {
      const clone = stop.cloneNode(true) as Element;
      clone.removeAttribute("id");
      gradient.append(clone);
    }
    own = ownStops(gradient);
  }
  stops.forEach((wanted, i) => {
    let stop: Element | undefined = own[i];
    if (!stop) {
      const last = own.at(-1);
      stop = last
        ? (last.cloneNode(false) as Element)
        : gradient.ownerDocument.createElementNS(SVG_NS, "stop");
      stop.removeAttribute("id");
      gradient.append(stop);
      own.push(stop as SVGStopElement);
    }
    const offset = formatNumber(Math.min(1, Math.max(0, wanted.offset)));
    if (stop.getAttribute("offset") !== offset) stop.setAttribute("offset", offset);
    const current = stopPaint(stop as SVGStopElement);
    if (current.color !== wanted.color.toLowerCase())
      writeStopProperty(stop, "stop-color", wanted.color.toLowerCase());
    if (Math.abs(current.opacity - wanted.opacity) > 1e-6) {
      const opacity = Math.min(1, Math.max(0, wanted.opacity));
      writeStopProperty(stop, "stop-opacity", opacity === 1 ? null : formatNumber(opacity));
      // Si el color llevaba transparencia (rgba), la opacidad escrita ya no basta: se reescribe.
      if (Math.abs(stopPaint(stop as SVGStopElement).opacity - opacity) > 1e-6) {
        writeStopProperty(stop, "stop-color", wanted.color.toLowerCase());
        writeStopProperty(stop, "stop-opacity", formatNumber(opacity));
      }
    }
  });
  for (const extra of own.slice(stops.length)) extra.remove();
}

/**
 * Escribe un cambio en un degradado, tocando solo lo que cambia. Lo que se escribe en él tapa lo
 * que heredaba. Usar con el degradado de `ownGradient`, para no cambiar el de otros objetos.
 */
export function writeGradient(
  gradient: SVGGradientElement,
  root: ParentNode,
  change: GradientChange,
): void {
  const chain = gradientChain(gradient, root);
  if (change.units) writeAttribute(gradient, chain, "gradientUnits", change.units);
  if (change.spread) writeAttribute(gradient, chain, "spreadMethod", change.spread);
  if (change.transform !== undefined) {
    if (change.transform === null) {
      gradient.removeAttribute("gradientTransform");
      // Si lo heredaba, se anula con la identidad.
      if (inherited(chain, "gradientTransform") !== null)
        gradient.setAttribute("gradientTransform", "matrix(1 0 0 1 0 0)");
    } else {
      writeAttribute(gradient, chain, "gradientTransform", change.transform);
    }
  }
  const geometry = kindOf(gradient) === "radial" ? change.radial : change.linear;
  for (const name of GEOMETRY[kindOf(gradient)]) {
    const value = (geometry as Record<string, number | undefined> | undefined)?.[name];
    if (value !== undefined) writeAttribute(gradient, chain, name, formatNumber(value));
  }
  if (change.stops) writeStops(gradient, root, change.stops);
}
