import { describe, expect, it } from "vitest";
import { parsePath } from "./parse";
import { serializePath } from "./serialize";

/**
 * Todos los trazados del corpus (tests/corpus) se leen y se vuelven a escribir sin cambiar lo que
 * se ve: el navegador da la misma caja y la misma longitud al original y al escrito.
 */
const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SVG_NS = "http://www.w3.org/2000/svg";

const paths = Object.entries(files).flatMap(([file, source]) => {
  const xml = new DOMParser().parseFromString(source.replace(/^\uFEFF/, ""), "image/svg+xml");
  return [...xml.getElementsByTagNameNS(SVG_NS, "path")]
    .map((element) => element.getAttribute("d"))
    .filter((d): d is string => d !== null && d.trim() !== "")
    .map((d) => ({ file: file.replace(/^.*tests\/corpus\//, ""), d }));
});

function measure(svg: SVGSVGElement, d: string) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  const box = path.getBBox();
  const length = path.getTotalLength();
  path.remove();
  return { x: box.x, y: box.y, width: box.width, height: box.height, length };
}

describe("trazados del corpus", () => {
  it("hay trazados que probar", () => {
    expect(paths.length).toBeGreaterThan(100);
  });

  it("se leen y se vuelven a escribir sin cambiar su geometría", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.append(svg);
    const failures: string[] = [];
    for (const { file, d } of paths) {
      const { data } = parsePath(d);
      const written = serializePath(data);
      const before = measure(svg, d);
      const after = measure(svg, written);
      // Tolerancia relativa al tamaño del trazado: el escrito redondea a 3 decimales.
      const size = Math.max(1, before.width, before.height);
      const tolerance = size * 1e-3 + 0.01;
      const differs = (["x", "y", "width", "height"] as const).some(
        (k) => Math.abs(before[k] - after[k]) > tolerance,
      );
      const lengthDiffers =
        Math.abs(before.length - after.length) > Math.max(0.05, before.length * 2e-3);
      if (differs || lengthDiffers)
        failures.push(`${file}: ${d.slice(0, 80)} → ${written.slice(0, 80)}`);
    }
    svg.remove();
    expect(failures).toEqual([]);
  });
});
