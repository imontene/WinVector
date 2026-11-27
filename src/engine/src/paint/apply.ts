import type { SvgDocument } from "../document";
import type { History } from "../history";
import { paintOf, paintTargets } from "../style/style";
import { formatNumber, outermost } from "../transform";
import {
  byId,
  type GradientKind,
  type GradientStop,
  type LinearGeometry,
  ownGradient,
  type PaintProperty,
  paintGradient,
  type RadialGeometry,
  readGradient,
  setPaintReference,
  type SpreadMethod,
  stopsOwner,
  writeGradient,
} from "./gradient";

/**
 * Aplicar degradados a la selección desde el panel (issue #109): crear uno nuevo a partir del color
 * del objeto, cambiar su tipo, sus paradas o su repetición. Siempre sobre el degradado propio del
 * objeto (ADR 0009), en un paso del historial.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lo que se quiere del degradado de una pintura; lo que no se indica no cambia. */
export interface GradientRequest {
  readonly property: PaintProperty;
  readonly kind?: GradientKind;
  readonly stops?: readonly GradientStop[];
  readonly spread?: SpreadMethod;
  /**
   * Cambiar las paradas y la repetición donde están, para todos los objetos que las comparten
   * (biblioteca, issue #112), en lugar de en un degradado propio del objeto.
   */
  readonly shared?: boolean;
}

const TAG: Readonly<Record<GradientKind, string>> = {
  linear: "linearGradient",
  radial: "radialGradient",
};

const LINEAR_ATTRIBUTES = ["x1", "y1", "x2", "y2"];
const RADIAL_ATTRIBUTES = ["cx", "cy", "r", "fx", "fy", "fr"];

/** Identificador nuevo: `degradado`, o `degradado-2`, `degradado-3`… si ya existe. */
export function newGradientId(root: ParentNode): string {
  if (!byId(root, "degradado")) return "degradado";
  for (let n = 2; ; n++) {
    const candidate = `degradado-${String(n)}`;
    if (!byId(root, candidate)) return candidate;
  }
}

/** Caja del objeto en su propio sistema de coordenadas (el de `userSpaceOnUse`). */
function boxOf(target: Element): DOMRect {
  try {
    return (target as SVGGraphicsElement).getBBox();
  } catch {
    return new DOMRect(0, 0, 0, 0);
  }
}

/**
 * Geometría que cubre el objeto de lado a lado: lineal de izquierda a derecha por el centro, radial
 * desde el centro hasta el lado más lejano. En fracciones de la caja si el degradado usa
 * `objectBoundingBox`.
 */
export function coveringGeometry(
  target: Element,
  kind: GradientKind,
  boundingBox: boolean,
): LinearGeometry | RadialGeometry {
  if (boundingBox) {
    return kind === "linear"
      ? { x1: 0, y1: 0.5, x2: 1, y2: 0.5 }
      : { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5, fr: 0 };
  }
  const box = boxOf(target);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return kind === "linear"
    ? { x1: box.x, y1: cy, x2: box.x + box.width, y2: cy }
    : { cx, cy, r: Math.max(box.width, box.height) / 2, fx: cx, fy: cy, fr: 0 };
}

export function writeGeometry(element: Element, geometry: LinearGeometry | RadialGeometry): void {
  for (const [name, value] of Object.entries(geometry)) {
    // El foco en el centro y sin radio propio son los valores por defecto: no se escriben.
    if ((name === "fx" || name === "fy" || name === "fr") && "cx" in geometry) {
      const center = name === "fx" ? geometry.cx : name === "fy" ? geometry.cy : 0;
      if (Math.abs((value as number) - center) < 1e-9) continue;
    }
    element.setAttribute(name, formatNumber(value as number));
  }
}

/** Paradas de un degradado nuevo: del color actual de la pintura a ese color transparente. */
function stopsFromPaint(target: Element, property: PaintProperty): GradientStop[] {
  const paint = paintOf(getComputedStyle(target).getPropertyValue(property));
  const color = /^#[0-9a-f]{6}$/.test(paint) ? paint : "#000000";
  return [
    { offset: 0, color, opacity: 1 },
    { offset: 1, color, opacity: 0 },
  ];
}

/** El primer `<defs>` hijo de la raíz, o uno nuevo tras `<title>`, `<desc>` y `<metadata>`. */
function defsOf(document: SvgDocument): Element {
  return document.getOrCreateDefs();
}

/** Crea un degradado nuevo para la pintura del objeto (ADR 0009: en `userSpaceOnUse`). */
function createGradient(
  document: SvgDocument,
  target: Element,
  request: GradientRequest,
): SVGGradientElement {
  const kind = request.kind ?? "linear";
  const gradient = document.root.ownerDocument.createElementNS(
    SVG_NS,
    TAG[kind],
  ) as SVGGradientElement;
  gradient.id = newGradientId(document.root);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  writeGeometry(gradient, coveringGeometry(target, kind, false));
  if (request.spread && request.spread !== "pad")
    gradient.setAttribute("spreadMethod", request.spread);
  defsOf(document).append(gradient);
  writeGradient(gradient, document.root, {
    stops: request.stops ?? stopsFromPaint(target, request.property),
  });
  return gradient;
}

/**
 * Convierte un degradado en uno del otro tipo, con el mismo id, sus paradas y sus demás atributos;
 * la geometría pasa a cubrir el objeto.
 */
function convertGradient(
  gradient: SVGGradientElement,
  target: Element,
  kind: GradientKind,
  root: Element,
): SVGGradientElement {
  const read = readGradient(gradient, root);
  const next = gradient.ownerDocument.createElementNS(SVG_NS, TAG[kind]) as SVGGradientElement;
  const skip = new Set([...LINEAR_ATTRIBUTES, ...RADIAL_ATTRIBUTES]);
  for (const attribute of [...gradient.attributes]) {
    if (attribute.namespaceURI === null && skip.has(attribute.name)) continue;
    next.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  writeGeometry(next, coveringGeometry(target, kind, read.units === "objectBoundingBox"));
  next.append(...gradient.childNodes);
  gradient.replaceWith(next);
  return next;
}

/** Aplica el degradado pedido a una pintura de un objeto. Devuelve si cambió algo. */
function applyToTarget(document: SvgDocument, target: Element, request: GradientRequest): boolean {
  const root = document.root;
  const before = paintGradient(target, request.property, root);
  if (!before) {
    const created = createGradient(document, target, request);
    setPaintReference(target, request.property, created.id);
    return true;
  }
  let gradient = ownGradient(target, request.property, root);
  if (!gradient) return false;
  const snapshot = gradient.outerHTML;
  if (request.kind && readGradient(gradient, root).kind !== request.kind) {
    gradient = convertGradient(gradient, target, request.kind, root);
  }
  writeGradient(gradient, root, {
    ...(request.stops ? { stops: request.stops } : {}),
    ...(request.spread ? { spread: request.spread } : {}),
  });
  return gradient !== before || gradient.outerHTML !== snapshot;
}

/** Cambia las paradas y la repetición en el degradado que las tiene, compartido por varios objetos. */
function applyShared(
  root: Element,
  targets: readonly Element[],
  request: GradientRequest,
): boolean {
  const owners = new Set<SVGGradientElement>();
  for (const target of targets) {
    const gradient = paintGradient(target, request.property, root);
    const owner = gradient ? (stopsOwner(gradient, root) ?? gradient) : null;
    if (owner) owners.add(owner);
  }
  let changed = false;
  for (const owner of owners) {
    const before = owner.outerHTML;
    writeGradient(owner, root, {
      ...(request.stops ? { stops: request.stops } : {}),
      ...(request.spread ? { spread: request.spread } : {}),
    });
    changed = changed || owner.outerHTML !== before;
  }
  return changed;
}

/**
 * Aplica un degradado a la pintura de los objetos seleccionados (o de las formas de los grupos), en
 * un paso del historial. Mover o recolorear las mismas paradas seguidas (al arrastrar) es un paso.
 */
export function applyGradient(
  document: SvgDocument,
  items: readonly Element[],
  request: GradientRequest,
  history: History,
): boolean {
  const targets = outermost(items).flatMap(paintTargets);
  if (targets.length === 0) return false;
  const [first] = targets;
  const current = first ? paintGradient(first, request.property, document.root) : null;
  const sameStops =
    request.kind === undefined &&
    request.spread === undefined &&
    current !== null &&
    request.stops?.length === readGradient(current, document.root).stops.length;
  const mergeKey = sameStops
    ? `gradient-stops:${request.property}:${String(request.stops.length)}`
    : undefined;
  return history.transact(
    "gradient",
    () => {
      if (request.shared) return applyShared(document.root, targets, request);
      let changed = false;
      for (const target of targets) changed = applyToTarget(document, target, request) || changed;
      return changed;
    },
    mergeKey,
  );
}
