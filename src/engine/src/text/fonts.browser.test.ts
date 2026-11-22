import { afterEach, describe, expect, it } from "vitest";
import { documentFonts, splitFontFamilies } from "./fonts";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

function draw(body: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`;
  document.body.append(host);
  hosts.push(host);
  const svg = host.querySelector("svg");
  if (!svg) throw new Error("Sin svg");
  return svg;
}

describe("fuentes de un documento", () => {
  it.each([
    ['"Segoe UI", sans-serif', ["Segoe UI", "sans-serif"]],
    ["'Noto  Serif', 'Times, Roman', serif", ["Noto Serif", "Times, Roman", "serif"]],
    ["Georgia", ["Georgia"]],
    ["", []],
  ])("%s", (list, families) => {
    expect(splitFontFamilies(list)).toEqual(families);
  });

  it("da cada lista distinta una vez, venga del texto, de un tramo, de CSS o de un grupo", () => {
    const svg = draw(`
      <style>.c { font-family: 'Fuente Inventada', serif }</style>
      <g font-family="Georgia, serif">
        <text x="0" y="20">a</text>
        <text x="0" y="40">b<tspan font-family="Consolas, monospace">c</tspan></text>
      </g>
      <text class="c" x="0" y="60">d</text>
      <text x="0" y="80" font-family="georgia, SERIF">e</text>
      <text x="0" y="100" font-family="Vacía"> </text>
      <defs><text font-family="Oculta">f</text></defs>
    `);
    expect(documentFonts(svg)).toEqual([
      ["Consolas", "monospace"],
      ["Fuente Inventada", "serif"],
      ["Georgia", "serif"],
    ]);
  });
});
