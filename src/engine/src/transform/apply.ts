import { IDENTITY, invert, multiply, toSvgTransform, type Matrix } from "../geometry";
import {
  documentRoot,
  gradientChain,
  ownGradient,
  type PaintProperty,
  paintGradient,
  readGradient,
  writeGradient,
} from "../paint/gradient";
import { declaresProperty, setDeclaration } from "../style/declarations";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Atributos de posición y tamaño de cada elemento que se pueden reescribir en lugar de añadir un
 * `transform`. Mover cambia los de posición; escalar sin girar cambia también los de tamaño.
 */
const GEOMETRY: Readonly<
  Record<
    string,
    { readonly x: string[]; readonly y: string[]; readonly size?: readonly [string, string][] }
  >
> = {
  rect: {
    x: ["x"],
    y: ["y"],
    size: [
      ["width", "height"],
      ["rx", "ry"],
    ],
  },
  image: { x: ["x"], y: ["y"], size: [["width", "height"]] },
  foreignObject: { x: ["x"], y: ["y"], size: [["width", "height"]] },
  use: { x: ["x"], y: ["y"] },
  ellipse: { x: ["cx"], y: ["cy"], size: [["rx", "ry"]] },
  circle: { x: ["cx"], y: ["cy"] },
  line: { x: ["x1", "x2"], y: ["y1", "y2"] },
  text: { x: ["x"], y: ["y"] },
};

/** Número de un atributo, solo si es un número sin unidades; `null` si falta (vale 0) o tiene unidades. */
function plainNumber(element: Element, name: string): number | null | undefined {
  const value = element.getAttribute(name);
  if (value === null) return null;
  const trimmed = value.trim();
  return /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) ? Number(trimmed) : undefined;
}

/** Escribe un número sin restos de coma flotante (6 decimales como máximo). */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Matriz del atributo transform del elemento (la identidad si no tiene). */
export function localTransform(element: Element): Matrix {
  if (!(element instanceof SVGGraphicsElement)) return IDENTITY;
  const consolidated = element.transform.baseVal.consolidate();
  if (!consolidated) return IDENTITY;
  const m = consolidated.matrix;
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

/**
 * Matriz que lleva las coordenadas propias de `node` (sin su transform) a las del elemento raíz,
 * es decir, la de su padre; o `null` si no se puede medir (documento oculto).
 */
export function parentToRoot(element: Element, root: SVGSVGElement): Matrix | null {
  const parent = element.parentNode;
  if (!(parent instanceof Element) || parent === root) return IDENTITY;
  if (!(parent instanceof SVGGraphicsElement)) return null;
  const rootCtm = root.getScreenCTM();
  const parentCtm = parent.getScreenCTM();
  if (!rootCtm || !parentCtm) return null;
  const m = rootCtm.inverse().multiply(parentCtm);
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

const isIdentity = (m: Matrix) =>
  Math.abs(m.a - 1) < 1e-9 &&
  Math.abs(m.b) < 1e-9 &&
  Math.abs(m.c) < 1e-9 &&
  Math.abs(m.d - 1) < 1e-9 &&
  Math.abs(m.e) < 1e-9 &&
  Math.abs(m.f) < 1e-9;

/** Matriz que lleva las coordenadas propias del elemento a las del elemento raíz. */
export function elementToRoot(element: Element, root: SVGSVGElement): Matrix | null {
  const parent = parentToRoot(element, root);
  return parent ? multiply(parent, localTransform(element)) : null;
}

/**
 * Aplica al elemento la transformación `m`, expresada en las coordenadas del elemento raíz (las del
 * viewBox): después, el elemento se ve como antes transformado por `m`.
 *
 * Se escribe de la forma más limpia posible:
 * - Sin `transform` previo, mover cambia los atributos de posición (x, cx, x1…).
 * - Sin `transform` previo, escalar sin girar ni voltear un rect, image, ellipse o foreignObject
 *   cambia su posición y tamaño (un círculo, solo si la escala es la misma en los dos ejes); un
 *   texto escalado en proporción cambia sus posiciones y su tamaño de fuente.
 * - En los demás casos (trazados, grupos, giros, atributos con unidades) se escribe `transform`.
 *
 * @returns `false` si no se puede medir el elemento (por ejemplo, si el documento está oculto).
 */
export function applyTransform(element: Element, m: Matrix, root: SVGSVGElement): boolean {
  if (isIdentity(m)) return true;
  const parent = parentToRoot(element, root);
  const inverseParent = parent ? invert(parent) : null;
  if (!parent || !inverseParent) return false;
  const current = localTransform(element);
  // Nueva transformación local: P⁻¹ · M · P · T.
  const next = multiply(multiply(inverseParent, multiply(m, parent)), current);

  if (isIdentity(current) && !element.hasAttribute("transform") && rewriteGeometry(element, next)) {
    // Sus degradados en coordenadas del objeto se mueven con él (issue #111).
    moveGradients(element, next, root);
    return true;
  }
  if (isIdentity(next)) element.removeAttribute("transform");
  else element.setAttribute("transform", simplestTransform(next));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Degradados que acompañan a la geometría (issue #111).
// ---------------------------------------------------------------------------------------------

const PAINTS: readonly PaintProperty[] = ["fill", "stroke"];

/** Atributos de un degradado que cambian al moverlo con su objeto. */
const GRADIENT_ATTRIBUTES = [
  "gradientTransform",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "fx",
  "fy",
  "fr",
];

/** True si `applyTransform` reescribirá las coordenadas del elemento en lugar de su `transform`. */
const rewritesGeometry = (element: Element) =>
  element.namespaceURI === SVG_NS &&
  element.localName !== "use" &&
  GEOMETRY[element.localName] !== undefined &&
  !element.hasAttribute("transform");

/**
 * Degradados en `userSpaceOnUse` con los que se pinta el elemento: están en sus mismas coordenadas,
 * así que si se reescriben las coordenadas del elemento hay que moverlos también. Con un
 * `transform`, en cambio, el degradado ya lo acompaña; y uno en `objectBoundingBox` sigue a su caja.
 */
function userSpaceGradients(element: Element, root: Element): SVGGradientElement[] {
  return PAINTS.flatMap((property) => {
    const gradient = paintGradient(element, property, root);
    return gradient && readGradient(gradient, root).units === "userSpaceOnUse" ? [gradient] : [];
  });
}

/**
 * Antes de transformar los elementos en un gesto: los que reescribirán sus coordenadas pasan a
 * tener sus degradados en `userSpaceOnUse` propios (ADR 0009), para moverlos sin cambiar los de
 * otros objetos. Hay que llamarla dentro del paso del historial del gesto.
 */
export function prepareGradients(items: readonly Element[]): void {
  for (const element of items) {
    const root = documentRoot(element);
    if (!root || !rewritesGeometry(element)) continue;
    for (const property of PAINTS) {
      const gradient = paintGradient(element, property, root);
      if (gradient && readGradient(gradient, root).units === "userSpaceOnUse") {
        ownGradient(element, property, root);
      }
    }
  }
}

/** Matriz de un atributo `transform` de SVG (con la sintaxis de SVG, no la de CSS). */
function parseTransform(text: string, document: Document): Matrix {
  const probe = document.createElementNS(SVG_NS, "g");
  probe.setAttribute("transform", text);
  const matrix = probe.transform.baseVal.consolidate()?.matrix;
  return matrix
    ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
    : IDENTITY;
}

/**
 * Aplica `m` (en las coordenadas del elemento) a sus degradados en `userSpaceOnUse`, copiándolos
 * antes si los comparte. Si el degradado no tiene `gradientTransform` y `m` solo mueve y escala, se
 * cambian sus coordenadas; si no, se compone su `gradientTransform`.
 */
function moveGradients(element: Element, m: Matrix, root: Element): void {
  for (const property of PAINTS) {
    const found = paintGradient(element, property, root);
    if (!found || readGradient(found, root).units !== "userSpaceOnUse") continue;
    const gradient = ownGradient(element, property, root);
    if (gradient) transformGradient(gradient, m, root);
  }
}

function transformGradient(gradient: SVGGradientElement, m: Matrix, root: Element): void {
  const read = readGradient(gradient, root);
  const chain = gradientChain(gradient, root);
  const present = (name: string) => chain.find((g) => g.hasAttribute(name))?.getAttribute(name);
  const axisAligned = Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9;
  const x = (value: number) => m.a * value + m.e;
  const y = (value: number) => m.d * value + m.f;
  // Solo números (no porcentajes) y todos escritos: así se sabe qué significa cada coordenada.
  const plain = (names: readonly string[]) =>
    names.every((name) => {
      const value = present(name);
      return value !== null && value !== undefined && !value.trim().endsWith("%");
    });
  if (read.transform === null && axisAligned) {
    if (read.linear && plain(["x1", "y1", "x2", "y2"])) {
      const { x1, y1, x2, y2 } = read.linear;
      writeGradient(gradient, root, { linear: { x1: x(x1), y1: y(y1), x2: x(x2), y2: y(y2) } });
      return;
    }
    if (read.radial && Math.abs(m.a - m.d) < 1e-9 && plain(["cx", "cy", "r"])) {
      const { cx, cy, r, fx, fy, fr } = read.radial;
      // El foco y su radio solo se escriben si ya estaban: si no, siguen al centro.
      const focus = {
        ...(present("fx") ? { fx: x(fx) } : {}),
        ...(present("fy") ? { fy: y(fy) } : {}),
        ...(present("fr") ? { fr: m.a * fr } : {}),
      };
      writeGradient(gradient, root, { radial: { cx: x(cx), cy: y(cy), r: m.a * r, ...focus } });
      return;
    }
  }
  const current =
    read.transform === null ? IDENTITY : parseTransform(read.transform, gradient.ownerDocument);
  writeGradient(gradient, root, { transform: toSvgTransform(multiply(m, current)) });
}

/** `translate(…)` si solo desplaza; si no, `matrix(…)`. */
export function simplestTransform(m: Matrix): string {
  if (
    Math.abs(m.a - 1) < 1e-9 &&
    Math.abs(m.b) < 1e-9 &&
    Math.abs(m.c) < 1e-9 &&
    Math.abs(m.d - 1) < 1e-9
  ) {
    return `translate(${formatNumber(m.e)} ${formatNumber(m.f)})`;
  }
  return toSvgTransform(m);
}

/** Intenta expresar `m` cambiando los atributos del elemento. Devuelve `false` si no se puede. */
function rewriteGeometry(element: Element, m: Matrix): boolean {
  if (element.namespaceURI !== SVG_NS) return false;
  const spec = GEOMETRY[element.localName];
  if (!spec) return false;
  if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || m.a <= 0 || m.d <= 0) return false;
  if (element.localName === "text") return rewriteText(element, m);
  const scaled = Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9;
  if (scaled) {
    if (!spec.size && element.localName !== "circle") return false;
    if (element.localName === "circle" && Math.abs(m.a - m.d) > 1e-9) return false;
  }

  const updates: [string, number][] = [];
  const read = (name: string): number | null => {
    const value = plainNumber(element, name);
    if (value === undefined) throw new Error("unidades");
    return value;
  };
  try {
    for (const name of spec.x) updates.push([name, m.a * (read(name) ?? 0) + m.e]);
    for (const name of spec.y) updates.push([name, m.d * (read(name) ?? 0) + m.f]);
    if (scaled) {
      for (const [w, h] of spec.size ?? []) {
        const width = read(w);
        const height = read(h);
        // rx sin ry (o al revés) usa el mismo valor en los dos ejes: con escala desigual hay que
        // escribir los dos.
        const both = width ?? height;
        if (h !== "height" && both === null) continue;
        const uneven = Math.abs(m.a - m.d) > 1e-9;
        if (width !== null || h === "height" || uneven)
          updates.push([w, m.a * (width ?? both ?? 0)]);
        if (height !== null || h === "height" || uneven)
          updates.push([h, m.d * (height ?? both ?? 0)]);
      }
      if (element.localName === "circle") updates.push(["r", m.a * (read("r") ?? 0)]);
    }
  } catch {
    return false;
  }
  for (const [name, value] of updates) {
    const text = formatNumber(value);
    if (element.getAttribute(name) !== text) element.setAttribute(name, text);
  }
  return true;
}

/** Estado de los atributos que cambia `applyTransform`, para volver a él. */
export interface Snapshot {
  readonly element: Element;
  readonly attributes: ReadonlyMap<string, string | null>;
  /** Las líneas y tramos de un texto, que también cambian al escalarlo (issue #98). */
  readonly inner?: readonly Snapshot[];
  /** Sus degradados en `userSpaceOnUse`, que se mueven con él (issue #111). */
  readonly gradients?: readonly Snapshot[];
}

/** Atributos de un texto y sus tramos que cambian al moverlo o escalarlo. */
const TEXT_ATTRIBUTES = ["x", "y", "dx", "dy", "font-size", "stroke-width", "textLength", "style"];

const attributesOf = (element: Element, names: Iterable<string>) =>
  new Map([...names].map((name) => [name, element.getAttribute(name)]));

/** Guarda los atributos que puede cambiar una transformación del elemento. */
export function snapshot(element: Element): Snapshot {
  const saved = elementSnapshot(element);
  const root = rewritesGeometry(element) ? documentRoot(element) : null;
  const gradients = root ? userSpaceGradients(element, root) : [];
  if (gradients.length === 0) return saved;
  return {
    ...saved,
    gradients: gradients.map((gradient) => ({
      element: gradient,
      attributes: attributesOf(gradient, GRADIENT_ATTRIBUTES),
    })),
  };
}

function elementSnapshot(element: Element): Snapshot {
  if (element.namespaceURI === SVG_NS && element.localName === "text") {
    return {
      element,
      attributes: attributesOf(element, ["transform", ...TEXT_ATTRIBUTES]),
      inner: [...element.querySelectorAll("tspan")].map((span) => ({
        element: span,
        attributes: attributesOf(span, TEXT_ATTRIBUTES),
      })),
    };
  }
  const spec = element.namespaceURI === SVG_NS ? GEOMETRY[element.localName] : undefined;
  const names = new Set(["transform", ...(spec?.x ?? []), ...(spec?.y ?? []), "r"]);
  for (const [w, h] of spec?.size ?? []) {
    names.add(w);
    names.add(h);
  }
  return { element, attributes: attributesOf(element, names) };
}

/** Devuelve el elemento al estado guardado, tocando solo los atributos que han cambiado. */
export function restore({ element, attributes, inner, gradients }: Snapshot): void {
  for (const [name, value] of attributes) {
    if (element.getAttribute(name) === value) continue;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  for (const saved of inner ?? []) restore(saved);
  for (const saved of gradients ?? []) restore(saved);
}

/** Lista de números sin unidades de un atributo (`x="1 2 3"`), o `null` si falta o tiene unidades. */
function numberList(element: Element, name: string): number[] | null | undefined {
  const value = element.getAttribute(name);
  if (value === null) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const plain = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
  return parts.every((part) => plain.test(part)) ? parts.map(Number) : undefined;
}

/**
 * Multiplica una longitud de estilo de un elemento (`font-size`, `stroke-width`) por `scale`, donde
 * esté escrita: en su atributo `style`, en su atributo de presentación o, si no está en ninguno (se
 * hereda o viene de CSS), en un atributo nuevo con el valor calculado.
 */
function scaleStyleLength(
  element: Element,
  property: string,
  scale: number,
  inherited: boolean,
): void {
  const style = element.getAttribute("style");
  if (declaresProperty(style, property)) {
    const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style ?? "");
    const value = match?.[1] ? Number.parseFloat(match[1]) : Number.NaN;
    if (Number.isFinite(value)) {
      element.setAttribute("style", setDeclaration(style, property, formatNumber(value * scale)));
    }
    return;
  }
  const attribute = element.getAttribute(property);
  if (attribute !== null) {
    const value = Number.parseFloat(attribute);
    if (Number.isFinite(value)) element.setAttribute(property, formatNumber(value * scale));
    return;
  }
  if (!inherited) return;
  const computed = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
  if (Number.isFinite(computed)) element.setAttribute(property, formatNumber(computed * scale));
}

/**
 * Mueve o escala un texto cambiando sus atributos (issue #98): las posiciones de sus líneas y
 * tramos (también las listas por carácter) y, al escalar en proporción, el tamaño de la fuente, el
 * grosor del trazo y los desplazamientos. Así un texto escalado sigue siendo un texto con su tamaño
 * de fuente, sin `transform`. Escalar sin proporción, girar o un texto sobre un trazado van con
 * `transform`.
 */
function rewriteText(text: Element, m: Matrix): boolean {
  const scale = m.a;
  if (Math.abs(m.a - m.d) > 1e-9 || text.querySelector("textPath")) return false;
  const nodes = [text, ...text.querySelectorAll("tspan")];
  const updates: [Element, string, string][] = [];
  for (const node of nodes) {
    for (const [name, factor, offset] of [
      ["x", scale, m.e],
      ["y", scale, m.f],
      ["dx", scale, 0],
      ["dy", scale, 0],
      ["textLength", scale, 0],
    ] as const) {
      const values = numberList(node, name);
      if (values === undefined) return false;
      // El texto sin x ni y está en 0: al moverlo, se escribe.
      if (values === null) {
        if (node === text && (name === "x" || name === "y") && offset !== 0) {
          updates.push([node, name, formatNumber(offset)]);
        }
        continue;
      }
      updates.push([node, name, values.map((v) => formatNumber(factor * v + offset)).join(" ")]);
    }
  }
  for (const [node, name, value] of updates) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  if (Math.abs(scale - 1) > 1e-9) {
    const stroked = getComputedStyle(text).stroke !== "none";
    for (const node of nodes) {
      scaleStyleLength(node, "font-size", scale, node === text);
      if (stroked) scaleStyleLength(node, "stroke-width", scale, node === text);
    }
  }
  return true;
}

/**
 * Quita de la lista los elementos que están dentro de otro de la lista: al transformar el grupo ya
 * se transforman.
 */
export function outermost(items: readonly Element[]): Element[] {
  return items.filter((item) => !items.some((other) => other !== item && other.contains(item)));
}

/**
 * Un círculo que una transformación ha escalado de forma distinta en cada eje (su `transform` solo
 * escala y desplaza) pasa a ser la elipse equivalente: sin `transform`, con los mismos atributos e
 * hijos y en el mismo sitio. Devuelve la elipse, o `null` si no hace falta o no se puede (atributos
 * con unidades, giros).
 */
export function circleToEllipse(element: Element): Element | null {
  if (element.namespaceURI !== SVG_NS || element.localName !== "circle") return null;
  const m = localTransform(element);
  const uneven = Math.abs(m.a - m.d) > 1e-9;
  if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || m.a <= 0 || m.d <= 0 || !uneven) return null;
  const cx = plainNumber(element, "cx");
  const cy = plainNumber(element, "cy");
  const r = plainNumber(element, "r");
  if (cx === undefined || cy === undefined || r === undefined || r === null) return null;

  const ellipse = element.ownerDocument.createElementNS(SVG_NS, "ellipse");
  const geometry: Readonly<Record<string, [string, number][]>> = {
    cx: [["cx", m.a * (cx ?? 0) + m.e]],
    cy: [["cy", m.d * (cy ?? 0) + m.f]],
    r: [
      ["rx", m.a * r],
      ["ry", m.d * r],
    ],
  };
  // Los atributos en el mismo orden; cx y cy se escriben aunque el círculo no los tuviera.
  if (cx === null) ellipse.setAttribute("cx", formatNumber(m.e));
  if (cy === null) ellipse.setAttribute("cy", formatNumber(m.f));
  for (const attribute of [...element.attributes]) {
    if (attribute.namespaceURI === null && attribute.name === "transform") continue;
    const values = attribute.namespaceURI === null ? geometry[attribute.name] : undefined;
    if (values) {
      for (const [name, value] of values) ellipse.setAttribute(name, formatNumber(value));
    } else {
      ellipse.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
  }
  ellipse.append(...element.childNodes);
  element.replaceWith(ellipse);
  return ellipse;
}
