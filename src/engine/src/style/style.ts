import type { History } from "../history";
import { isContainer } from "../selection";
import { outermost } from "../transform";
import { declaresProperty, setDeclaration } from "./declarations";

/**
 * Pintura de un relleno o un trazo: `"none"`, un color `"#rrggbb"` o `"url"` (un degradado o un
 * patrón, que se editarán en el MVP 4).
 */
export type Paint = string;

/** Estilo de la selección. `null` significa que los objetos tienen valores distintos. */
export interface StyleSummary {
  readonly fill: Paint | null;
  readonly stroke: Paint | null;
  readonly strokeWidth: number | null;
  readonly opacity: number | null;
  /** Regla de relleno común; ausente si son distintas o no hay formas (issue #79). */
  readonly fillRule?: FillRule;
}

export type FillRule = "nonzero" | "evenodd";

const isFillRule = (value: string): value is FillRule => value === "nonzero" || value === "evenodd";

/** Cambio de estilo: los campos `null` no cambian. */
export type StyleChange = StyleSummary;

const SVG_NS = "http://www.w3.org/2000/svg";

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

/** Convierte un valor calculado de fill o stroke en una pintura. */
export function paintOf(computed: string): Paint {
  const value = computed.trim();
  if (value === "none" || value === "") return "none";
  if (value.startsWith("url(")) return "url";
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (!match) return value;
  const alpha = match[4];
  // Un color totalmente transparente se muestra como ninguno: no se ve.
  if (alpha !== undefined && Number.parseFloat(alpha) === 0) return "none";
  return `#${hex(Number(match[1]))}${hex(Number(match[2]))}${hex(Number(match[3]))}`;
}

/** True si el texto es un color #rrggbb válido. */
export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/**
 * Elementos a los que se aplica el relleno y el trazo de un objeto seleccionado: el propio objeto
 * si es una forma o un texto, o las formas y textos que contiene si es un grupo.
 */
export function paintTargets(item: Element): Element[] {
  const isShape = (element: Element) =>
    element.namespaceURI === SVG_NS &&
    element instanceof SVGGraphicsElement &&
    !isContainer(element) &&
    !element.closest("defs, clipPath, mask, pattern, marker, symbol");
  if (!isContainer(item)) return isShape(item) ? [item] : [];
  return [...item.querySelectorAll("*")].filter(
    (element) => isShape(element) && !(element.parentElement?.closest("text") ?? null),
  );
}

/** Un solo valor si todos coinciden; `null` si hay varios o ninguno. */
function common<T>(values: readonly T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

/** Estilo calculado de la selección, venga de atributos, de CSS o de los grupos que la contienen. */
export function readStyle(items: readonly Element[]): StyleSummary {
  const outer = outermost(items);
  const targets = outer.flatMap(paintTargets);
  const computed = targets.map((target) => getComputedStyle(target));
  const fillRule = common(computed.map((style) => style.fillRule));
  return {
    fill: common(computed.map((style) => paintOf(style.fill))),
    stroke: common(computed.map((style) => paintOf(style.stroke))),
    strokeWidth: common(
      computed.map((style) => Math.round(Number.parseFloat(style.strokeWidth) * 1e4) / 1e4),
    ),
    opacity: common(
      outer.map(
        (item) => Math.round(Number.parseFloat(getComputedStyle(item).opacity) * 1e4) / 1e4,
      ),
    ),
    ...(fillRule !== null && isFillRule(fillRule) ? { fillRule } : {}),
  };
}

/** Propiedades cuyo valor son palabras, no números. */
const KEYWORD_PROPERTIES = new Set(["font-family", "font-style", "text-anchor"]);

const normalizeKeywords = (value: string) =>
  value
    .replace(/["']/g, "")
    .replace(/\s*,\s*/g, ",")
    .trim()
    .toLowerCase();

/** True si el valor calculado de la propiedad ya es el pedido. */
function applied(element: Element, property: string, value: string): boolean {
  const computed = getComputedStyle(element).getPropertyValue(property);
  if (property === "fill" || property === "stroke")
    return paintOf(computed) === value.toLowerCase();
  if (property === "fill-rule") return computed.trim() === value;
  // Propiedades de palabras (la fuente, la alineación…): se comparan sin comillas ni espacios.
  if (KEYWORD_PROPERTIES.has(property))
    return normalizeKeywords(computed) === normalizeKeywords(value);
  return Math.abs(Number.parseFloat(computed) - Number.parseFloat(value)) < 1e-6;
}

/**
 * Cambia una propiedad del elemento tocando lo mínimo:
 * - Si su atributo style la declara, se cambia esa declaración y nada más del atributo.
 * - Si no, el atributo de presentación (`fill="…"`), que se crea si hace falta.
 * - Si aun así no se aplica porque una regla de CSS la tapa, se declara en su atributo style, que
 *   tiene más prioridad.
 */
export function setStyleProperty(element: Element, property: string, value: string): void {
  if (
    applied(element, property, value) &&
    !declaresProperty(element.getAttribute("style"), property) &&
    !element.hasAttribute(property)
  ) {
    // Ya se ve así por herencia: no se escribe nada.
    return;
  }
  const style = element.getAttribute("style");
  if (declaresProperty(style, property)) {
    element.setAttribute("style", setDeclaration(style, property, value));
    return;
  }
  const previous = element.getAttribute(property);
  if (previous !== value) element.setAttribute(property, value);
  if (!applied(element, property, value)) {
    if (previous === null) element.removeAttribute(property);
    else element.setAttribute(property, previous);
    element.setAttribute("style", setDeclaration(style, property, value));
  }
}

/** Formatea un número sin restos de coma flotante. */
const number = (value: number) => String(Math.round(value * 1e4) / 1e4);

/**
 * Aplica un cambio de estilo a la selección en un paso del historial. Los cambios seguidos de las
 * mismas propiedades (por ejemplo, al arrastrar en el selector de color) se funden en un solo paso.
 *
 * @returns `false` si no había nada que cambiar.
 */
export function applyStyle(
  items: readonly Element[],
  change: StyleChange,
  history: History,
): boolean {
  const outer = outermost(items);
  if (outer.length === 0) return false;
  const paint = (value: string | null) =>
    value !== null && (value === "none" || isHexColor(value)) ? value.toLowerCase() : null;
  const fill = paint(change.fill);
  const stroke = paint(change.stroke);
  const strokeWidth =
    change.strokeWidth !== null && change.strokeWidth >= 0 ? number(change.strokeWidth) : null;
  const opacity = change.opacity !== null ? number(Math.min(1, Math.max(0, change.opacity))) : null;
  const fillRule = change.fillRule && isFillRule(change.fillRule) ? change.fillRule : null;
  const properties = [
    fillRule && "fill-rule",
    fill && "fill",
    stroke && "stroke",
    strokeWidth && "stroke-width",
    opacity && "opacity",
  ].filter((name): name is string => typeof name === "string");
  if (properties.length === 0) return false;

  history.transact(
    "style",
    () => {
      for (const target of outer.flatMap(paintTargets)) {
        if (fill) setStyleProperty(target, "fill", fill);
        if (stroke) setStyleProperty(target, "stroke", stroke);
        if (strokeWidth) setStyleProperty(target, "stroke-width", strokeWidth);
        if (fillRule) setStyleProperty(target, "fill-rule", fillRule);
      }
      if (opacity) for (const item of outer) setStyleProperty(item, "opacity", opacity);
    },
    `style:${properties.join(",")}`,
  );
  return true;
}
