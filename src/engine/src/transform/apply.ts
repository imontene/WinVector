import { IDENTITY, invert, multiply, toSvgTransform, type Matrix } from "../geometry";

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
 *   cambia su posición y tamaño (un círculo, solo si la escala es la misma en los dos ejes).
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
    return true;
  }
  if (isIdentity(next)) element.removeAttribute("transform");
  else element.setAttribute("transform", simplestTransform(next));
  return true;
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
  const scaled = Math.abs(m.a - 1) > 1e-9 || Math.abs(m.d - 1) > 1e-9;
  if (scaled) {
    if (!spec.size && element.localName !== "circle") return false;
    if (element.localName === "circle" && Math.abs(m.a - m.d) > 1e-9) return false;
  }
  // Un texto con tspan colocados o sobre un trazado (textPath no usa la x ni la y del texto) se
  // mueve con transform. Un texto con varias posiciones (x="1 2 3") tampoco es un número simple.
  if (
    element.localName === "text" &&
    (scaled || element.querySelector("[x],[y],[dx],[dy],textPath"))
  )
    return false;

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
}

/** Guarda los atributos que puede cambiar una transformación del elemento. */
export function snapshot(element: Element): Snapshot {
  const spec = element.namespaceURI === SVG_NS ? GEOMETRY[element.localName] : undefined;
  const names = new Set(["transform", ...(spec?.x ?? []), ...(spec?.y ?? []), "r"]);
  for (const [w, h] of spec?.size ?? []) {
    names.add(w);
    names.add(h);
  }
  return {
    element,
    attributes: new Map([...names].map((name) => [name, element.getAttribute(name)])),
  };
}

/** Devuelve el elemento al estado guardado, tocando solo los atributos que han cambiado. */
export function restore({ element, attributes }: Snapshot): void {
  for (const [name, value] of attributes) {
    if (element.getAttribute(name) === value) continue;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
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
