import { describe, expect, it } from "vitest";
import { nearestOnSegment, pathBounds, pointAt, splitPathAt, splitSegment } from "./curves";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

/**
 * Con los trazados del corpus: la caja exacta coincide con la que calcula el navegador, y partir
 * cualquier segmento deja el trazado igual (comparación de píxeles).
 */
const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SVG_NS = "http://www.w3.org/2000/svg";

const paths = Object.values(files).flatMap((source) => {
  const xml = new DOMParser().parseFromString(source.replace(/^\uFEFF/, ""), "image/svg+xml");
  return [...xml.getElementsByTagNameNS(SVG_NS, "path")]
    .map((element) => element.getAttribute("d"))
    .filter((d): d is string => d !== null && d.trim() !== "");
});

describe("geometría de curvas con el corpus", () => {
  it("la caja exacta coincide con la del navegador", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.append(svg);
    const element = document.createElementNS(SVG_NS, "path");
    svg.append(element);
    const failures: string[] = [];
    for (const d of paths) {
      const bounds = pathBounds(parsePath(d).data);
      element.setAttribute("d", d);
      const box = element.getBBox();
      if (!bounds) continue;
      const tolerance = Math.max(0.02, Math.max(box.width, box.height) * 1e-4);
      const differs =
        Math.abs(bounds.x - box.x) > tolerance ||
        Math.abs(bounds.y - box.y) > tolerance ||
        Math.abs(bounds.width - box.width) > tolerance ||
        Math.abs(bounds.height - box.height) > tolerance;
      if (differs)
        failures.push(`${d.slice(0, 60)}: ${JSON.stringify(bounds)} ≠ ${JSON.stringify(box)}`);
    }
    svg.remove();
    expect(failures).toEqual([]);
  });

  it("partir cualquier segmento no cambia lo que se ve", () => {
    const size = 160;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Sin canvas");
    const draw = (d: string, box: { x: number; y: number; width: number; height: number }) => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, size, size);
      const scale = (size - 20) / Math.max(box.width, box.height, 1);
      context.setTransform(scale, 0, 0, scale, 10 - box.x * scale, 10 - box.y * scale);
      const path = new Path2D(d);
      context.fillStyle = "#000";
      context.fill(path);
      return context.getImageData(0, 0, size, size).data;
    };
    const failures: string[] = [];
    let checked = 0;
    for (const d of paths) {
      const { data } = parsePath(d);
      const box = pathBounds(data);
      if (!box) continue;
      const original = draw(serializePath(data, { precision: 6 }), box);
      data.forEach((subpath, s) => {
        const count = subpath.segments.length + (subpath.closed ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const split = splitPathAt(data, { subpath: s, segment: i, t: 0.37 });
          const pixels = draw(serializePath(split, { precision: 6 }), box);
          let different = 0;
          for (let k = 0; k < pixels.length; k += 4) {
            if (
              Math.abs((pixels[k] ?? 0) - (original[k] ?? 0)) +
                Math.abs((pixels[k + 3] ?? 0) - (original[k + 3] ?? 0)) >
              96
            )
              different++;
          }
          checked++;
          // Se compara el relleno (la forma). Partir una arista cambia un poco su suavizado, porque el
          // rasterizador calcula cada trozo por separado: se admite un 0,5 % del lienzo. Que los puntos
          // sean los mismos se comprueba exactamente en la prueba siguiente.
          if (different > 128)
            failures.push(
              `${d.slice(0, 60)} (subtrazado ${String(s)}, segmento ${String(i)}): ${String(different)} píxeles`,
            );
        }
      });
    }
    expect(checked).toBeGreaterThan(300);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("partir cualquier segmento deja los mismos puntos: los dos trozos están sobre el original", () => {
    let worst = 0;
    for (const d of paths) {
      const { data } = parsePath(d);
      for (const subpath of data) {
        let from = subpath.start;
        for (const segment of subpath.segments) {
          const [a, b] = splitSegment(from, segment, 0.37);
          for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            worst = Math.max(worst, nearestOnSegment(from, segment, pointAt(from, a, t)).distance);
            worst = Math.max(worst, nearestOnSegment(from, segment, pointAt(a.to, b, t)).distance);
          }
          from = segment.to;
        }
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });
});
