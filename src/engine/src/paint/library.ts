import { COLLECT_ATTRIBUTE } from "../document/collect";
import type { SvgDocument } from "../document";
import type { History } from "../history";
import { paintTargets } from "../style/style";
import { outermost } from "../transform";
import { coveringGeometry, newGradientId, writeGeometry } from "./apply";
import {
  byId,
  freeId,
  type GradientKind,
  type GradientStop,
  gradientUsers,
  isGradient,
  ownStops,
  type PaintProperty,
  readGradient,
  setPaintReference,
  type SpreadMethod,
  stopsOwner,
} from "./gradient";

/**
 * Biblioteca de degradados del documento (issue #112, ADR 0009).
 *
 * Como en Inkscape, las paradas se comparten y la posición es de cada objeto: la biblioteca son los
 * degradados que tienen paradas propias. Al aplicar uno a un objeto se le crea un degradado propio,
 * colocado sobre él en `userSpaceOnUse`, que hereda las paradas por `href`; así, cambiar las
 * paradas de la biblioteca cambia todos los objetos que las usan, cada uno en su sitio.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Degradado de la biblioteca: un juego de paradas y cuántas pinturas de objetos lo usan. */
export interface LibraryGradient {
  readonly id: string;
  readonly kind: GradientKind;
  readonly spread: SpreadMethod;
  readonly stops: readonly GradientStop[];
  readonly users: number;
}

/** Los degradados con paradas propias del documento, en orden. */
export function documentGradients(root: Element): LibraryGradient[] {
  const all = [...root.querySelectorAll("linearGradient, radialGradient")].filter(isGradient);
  const owners = new Map<SVGGradientElement, number>();
  for (const gradient of all) {
    const owner = stopsOwner(gradient, root);
    if (owner?.id) owners.set(owner, (owners.get(owner) ?? 0) + gradientUsers(gradient, root));
  }
  return [...owners].map(([owner, users]) => {
    const read = readGradient(owner, root);
    return { id: owner.id, kind: read.kind, spread: read.spread, stops: read.stops, users };
  });
}

/** Qué degradado de la biblioteca usar en la pintura de la selección. */
export interface UseGradientRequest {
  readonly property: PaintProperty;
  readonly id: string;
  /** Una copia de sus paradas, para cambiarla sin tocar a los demás objetos. */
  readonly copy?: boolean;
}

/** Copia de un degradado de la biblioteca (sus atributos y paradas) con un id nuevo, detrás de él. */
function copyOf(gradient: SVGGradientElement, root: ParentNode): SVGGradientElement {
  const copy = gradient.cloneNode(true) as SVGGradientElement;
  copy.id = freeId(root, gradient.id);
  copy.setAttribute(COLLECT_ATTRIBUTE, "always");
  for (const stop of ownStops(copy)) stop.removeAttribute("id");
  gradient.after(copy);
  return copy;
}

/**
 * Pinta con un degradado de la biblioteca el relleno o el trazo de la selección, en un paso del
 * historial. Si el degradado es en `objectBoundingBox` sin transformación, se usa tal cual (se
 * adapta a la caja de cada objeto); si no, cada objeto recibe uno propio colocado sobre él que
 * hereda sus paradas.
 */
export function useGradient(
  document: SvgDocument,
  items: readonly Element[],
  request: UseGradientRequest,
  history: History,
): boolean {
  const root = document.root;
  const targets = outermost(items).flatMap(paintTargets);
  const found = byId(root, request.id);
  if (targets.length === 0 || !isGradient(found)) return false;
  return history.transact("gradient", () => {
    const library = request.copy ? copyOf(found, root) : found;
    const read = readGradient(library, root);
    if (read.units === "objectBoundingBox" && read.transform === null) {
      for (const target of targets) setPaintReference(target, request.property, library.id);
      return true;
    }
    for (const target of targets) {
      const placed = root.ownerDocument.createElementNS(
        SVG_NS,
        read.kind === "radial" ? "radialGradient" : "linearGradient",
      );
      placed.id = newGradientId(root);
      placed.setAttribute(COLLECT_ATTRIBUTE, "always");
      placed.setAttribute("href", `#${library.id}`);
      placed.setAttribute("gradientUnits", "userSpaceOnUse");
      writeGeometry(placed, coveringGeometry(target, read.kind, false));
      library.after(placed);
      setPaintReference(target, request.property, placed.id);
    }
    return true;
  });
}
