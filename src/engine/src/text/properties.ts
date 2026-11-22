import type { History } from "../history";
import { declaresProperty, setStyleProperty } from "../style";
import { outermost } from "../transform";
import { SVG_NS, lineHeight, readLines, textEditability, writeLines } from "./model";

/**
 * Propiedades tipográficas de los textos seleccionados (issue #95): fuente, tamaño, peso, cursiva,
 * alineación e interlineado. Se leen del estilo calculado (venga de atributos, de CSS o de un
 * grupo) y se escriben tocando lo mínimo, como el resto del estilo.
 */

export type TextAnchor = "start" | "middle" | "end";

/** Propiedades comunes de los textos seleccionados; `null`, si son distintas. */
export interface TextProperties {
  /** La primera familia de `font-family` (la que se ha pedido), sin comillas. */
  readonly fontFamily: string | null;
  readonly fontSize: number | null;
  /** Peso de 100 a 900 (400 normal, 700 negrita). */
  readonly fontWeight: number | null;
  readonly italic: boolean | null;
  readonly anchor: TextAnchor | null;
  /** Interlineado en múltiplos del tamaño de la fuente. */
  readonly lineHeight: number | null;
}

/** Cambio de propiedades tipográficas: lo que no está no cambia. */
export interface TextChange {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly italic?: boolean;
  readonly anchor?: TextAnchor;
  readonly lineHeight?: number;
}

/** Textos de la selección: los seleccionados y los que hay dentro de los grupos seleccionados. */
export function selectedTexts(items: readonly Element[]): SVGTextElement[] {
  return outermost(items).flatMap((item) =>
    item instanceof SVGTextElement
      ? [item]
      : [...item.querySelectorAll("text")].filter(
          (text): text is SVGTextElement =>
            text instanceof SVGTextElement &&
            !text.closest("defs, clipPath, mask, pattern, marker, symbol"),
        ),
  );
}

function common<T>(values: readonly T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

/** La primera familia de una lista de `font-family`, sin comillas. */
export function firstFamily(list: string): string {
  const [first = ""] = list.split(",");
  return first.trim().replace(/^(["'])(.*)\1$/, "$2");
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Propiedades comunes de los textos seleccionados, o `null` si no hay ningún texto. */
export function readTextProperties(items: readonly Element[]): TextProperties | null {
  const texts = selectedTexts(items);
  if (texts.length === 0) return null;
  const styles = texts.map((text) => getComputedStyle(text));
  const anchors = styles.map((style) => style.textAnchor);
  const anchor = common(anchors);
  return {
    fontFamily: common(styles.map((style) => firstFamily(style.fontFamily))),
    fontSize: common(styles.map((style) => round(Number.parseFloat(style.fontSize)))),
    fontWeight: common(styles.map((style) => Number.parseInt(style.fontWeight, 10) || 400)),
    italic: common(styles.map((style) => style.fontStyle !== "normal")),
    anchor: anchor === "start" || anchor === "middle" || anchor === "end" ? anchor : null,
    lineHeight: common(texts.map((text) => lineHeight(text))),
  };
}

/** Familias genéricas de CSS: van tal cual, sin otra de reserva. */
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const MONOSPACE = /mono|consolas|courier|cascadia|lucida console|fixedsys/i;
const SERIF =
  /serif|times|georgia|garamond|cambria|palatino|book antiqua|constantia|sylfaen|baskerville|bodoni/i;

/**
 * Valor de `font-family` para una fuente elegida: la fuente y una familia genérica de reserva, para
 * que el texto se vea razonable en un equipo sin ella (`Segoe UI, sans-serif`).
 */
export function fontFamilyValue(family: string): string {
  const name = family.trim();
  if (GENERIC.has(name.toLowerCase())) return name.toLowerCase();
  const generic = MONOSPACE.test(name)
    ? "monospace"
    : SERIF.test(name) && !/sans/i.test(name)
      ? "serif"
      : "sans-serif";
  // Sin comillas si es una serie de palabras sencillas; si no, entre comillas.
  const plain = /^[A-Za-z][A-Za-z0-9-]*( [A-Za-z][A-Za-z0-9-]*)*$/.test(name);
  const quoted = plain ? name : `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return `${quoted}, ${generic}`;
}

/**
 * Escribe una propiedad en el texto y en sus líneas o tramos que la declaran (como los `tspan` de
 * Inkscape con su propio estilo), para que no la tapen.
 */
function setTextProperty(text: Element, property: string, value: string): void {
  setStyleProperty(text, property, value);
  for (const inner of text.querySelectorAll("*")) {
    if (inner.namespaceURI !== SVG_NS) continue;
    if (inner.hasAttribute(property) || declaresProperty(inner.getAttribute("style"), property)) {
      setStyleProperty(inner, property, value);
    }
  }
}

const number = (value: number) => String(round(value));

/**
 * Aplica un cambio a los textos seleccionados en un paso del historial. Los cambios seguidos de las
 * mismas propiedades (escribir un tamaño, pulsar las flechas del campo) se funden en uno.
 *
 * Al cambiar el tamaño o el interlineado, las líneas de los textos que se editan en el lienzo se
 * vuelven a colocar: el interlineado es proporcional al tamaño.
 *
 * @returns `false` si no hay textos o el cambio no es válido.
 */
export function applyTextChange(
  items: readonly Element[],
  change: TextChange,
  history: History,
): boolean {
  const texts = selectedTexts(items);
  const fontFamily = change.fontFamily?.trim() ? fontFamilyValue(change.fontFamily) : null;
  const fontSize = change.fontSize !== undefined && change.fontSize > 0 ? change.fontSize : null;
  const fontWeight =
    change.fontWeight !== undefined && change.fontWeight >= 1 && change.fontWeight <= 1000
      ? Math.round(change.fontWeight)
      : null;
  const italic = change.italic ?? null;
  const anchor = change.anchor ?? null;
  const spacing =
    change.lineHeight !== undefined && change.lineHeight > 0 ? change.lineHeight : null;
  const properties = [
    fontFamily !== null && "font-family",
    fontSize !== null && "font-size",
    fontWeight !== null && "font-weight",
    italic !== null && "font-style",
    anchor !== null && "text-anchor",
    spacing !== null && "line-height",
  ].filter((name): name is string => typeof name === "string");
  if (texts.length === 0 || properties.length === 0) return false;

  history.transact(
    "text-style",
    () => {
      for (const text of texts) {
        // El interlineado de antes, para conservarlo al cambiar el tamaño.
        const before = lineHeight(text);
        if (fontFamily !== null) setTextProperty(text, "font-family", fontFamily);
        if (fontSize !== null) setTextProperty(text, "font-size", number(fontSize));
        if (fontWeight !== null) setTextProperty(text, "font-weight", String(fontWeight));
        if (italic !== null) setTextProperty(text, "font-style", italic ? "italic" : "normal");
        if (anchor !== null) setTextProperty(text, "text-anchor", anchor);
        if ((fontSize !== null || spacing !== null) && textEditability(text).editable) {
          writeLines(text, readLines(text), spacing ?? before);
        }
      }
    },
    `text:${properties.join(",")}`,
  );
  return true;
}
