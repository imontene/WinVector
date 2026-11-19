import type { Rect } from "../geometry";
import type { SvgDocument } from "./svgDocument";

/** Tamaño de la mesa de trabajo: los atributos width, height y viewBox del elemento raíz. */
export interface ArtboardSettings {
  /** Atributo width tal cual, con sus unidades, o `null` si no lo tiene. */
  readonly width: string | null;
  readonly height: string | null;
  /** viewBox, o `null` si no lo tiene o no es válido. */
  readonly viewBox: Rect | null;
}

/** Lee el viewBox de un atributo: cuatro números separados por espacios o comas, con ancho y alto positivos. */
export function parseViewBox(value: string | null): Rect | null {
  if (value === null) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Escribe un viewBox sin decimales de más. */
export function formatViewBox(rect: Rect): string {
  return [rect.x, rect.y, rect.width, rect.height]
    .map((value) => String(Number(value.toPrecision(10))))
    .join(" ");
}

export function readArtboard(root: SVGSVGElement): ArtboardSettings {
  return {
    width: root.getAttribute("width"),
    height: root.getAttribute("height"),
    viewBox: parseViewBox(root.getAttribute("viewBox")),
  };
}

export function sameArtboard(a: ArtboardSettings, b: ArtboardSettings): boolean {
  const box = (rect: Rect | null) => (rect ? formatViewBox(rect) : null);
  return a.width === b.width && a.height === b.height && box(a.viewBox) === box(b.viewBox);
}

/**
 * Cambia el tamaño de la mesa de trabajo como un paso del historial ("artboard"). Un valor `null`
 * quita el atributo. Los atributos que no cambian no se tocan, para que se guarden tal cual.
 */
export function applyArtboard(document: SvgDocument, settings: ArtboardSettings): void {
  const root = document.root;
  const current = readArtboard(root);
  document.history.transact("artboard", () => {
    const set = (name: string, value: string | null, unchanged: boolean) => {
      if (unchanged) return;
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    };
    set("width", settings.width, settings.width === current.width);
    set("height", settings.height, settings.height === current.height);
    const viewBox = settings.viewBox ? formatViewBox(settings.viewBox) : null;
    const currentViewBox = current.viewBox ? formatViewBox(current.viewBox) : null;
    set("viewBox", viewBox, viewBox === currentViewBox);
  });
}
