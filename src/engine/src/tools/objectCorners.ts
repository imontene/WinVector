import type { History } from "../history";
import {
  convertToPath,
  cornerKeys,
  editableData,
  effectiveRadii,
  type PathData,
  readRounding,
  writeRounding,
} from "../paths";
import type { Selection } from "../selection";
import { readPolygon } from "./polygons";

/**
 * Redondear todas las esquinas de una figura a la vez (issue #114): con la herramienta Selección, el
 * radio se aplica a todas las esquinas entre dos rectas de los polígonos, polilíneas y trazados
 * seleccionados, con los mismos arcos exactos que el redondeo de vértices (ADR 0008).
 *
 * Los rectángulos tienen su propio radio (`rx`), y los polígonos regulares y estrellas de WinVector
 * su redondeo proporcional: no se redondean aquí.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Geometría sin redondear de un objeto cuyas esquinas se pueden redondear todas, o `null`. */
function cornerData(element: Element): PathData | null {
  if (element.namespaceURI !== SVG_NS || readPolygon(element)) return null;
  if (element.localName === "path") return editableData(element);
  if (!(element instanceof SVGPolygonElement || element instanceof SVGPolylineElement)) return null;
  const [start, ...rest] = Array.from(element.points, (p) => ({ x: p.x, y: p.y }));
  if (!start) return null;
  return [
    {
      start,
      segments: rest.map((to) => ({ kind: "line" as const, to })),
      closed: element instanceof SVGPolygonElement,
    },
  ];
}

/** Radios actuales de todas las esquinas de un objeto (0 si no está redondeada), o `null`. */
function cornerRadii(element: Element): number[] | null {
  const data = cornerData(element);
  if (!data) return null;
  const keys = cornerKeys(data);
  if (keys.length === 0) return null;
  const rounding = element.localName === "path" ? readRounding(element) : null;
  const effective = rounding ? effectiveRadii(rounding.source, rounding.radii) : null;
  return keys.map((key) => effective?.get(key) ?? 0);
}

/** Esquinas de los objetos seleccionados para el panel: `null` si ninguno tiene esquinas. */
export interface ObjectCorners {
  /** Radio común de todas las esquinas, o `null` si son distintos. */
  readonly radius: number | null;
}

/** Resume las esquinas de los objetos seleccionados, o `null` si ninguno se puede redondear. */
export function readObjectCorners(items: readonly Element[]): ObjectCorners | null {
  const radii = items.flatMap((item) => cornerRadii(item) ?? []);
  const [first] = radii;
  if (first === undefined) return null;
  const common = radii.every((radius) => Math.abs(radius - first) < 1e-6);
  return { radius: common ? Math.round(first * 1000) / 1000 : null };
}

/**
 * Pone el mismo radio a todas las esquinas de los objetos seleccionados, en un paso del historial.
 * Cada radio se limita a lo que cabe; 0 quita el redondeo. Los polígonos y polilíneas que se
 * redondean pasan a ser trazados. Devuelve si algo cambió.
 */
export function setObjectCornerRadius(
  selection: Selection,
  history: History,
  radius: number,
): boolean {
  if (!Number.isFinite(radius) || radius < 0) return false;
  const targets = selection.items.filter((item) => cornerRadii(item) !== null);
  if (targets.length === 0) return false;
  return history.transact("corner-radius", () => {
    const replaced = new Map<Element, Element>();
    let changed = false;
    for (const item of targets) {
      // Un polígono sin redondear se queda como está si no se redondea.
      if (radius === 0 && item.localName !== "path") continue;
      const path = item.localName === "path" ? item : convertToPath(item);
      if (!path) continue;
      if (path !== item) replaced.set(item, path);
      const rounding = readRounding(path);
      const source = rounding?.source ?? editableData(path);
      const keys = cornerKeys(source);
      const wanted = new Map(keys.map((key) => [key, radius]));
      const fits = effectiveRadii(source, wanted);
      const radii = new Map(
        keys.map((key) => [key, Math.round((fits.get(key) ?? 0) * 1000) / 1000]),
      );
      const before = path.getAttribute("d");
      writeRounding(path, source, radii);
      changed ||= path !== item || path.getAttribute("d") !== before;
    }
    if (replaced.size > 0) selection.replace([...replaced.keys()], replaced);
    return changed;
  });
}
