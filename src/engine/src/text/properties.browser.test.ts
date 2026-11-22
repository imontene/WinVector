import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document";
import { applyTextChange, fontFamilyValue, readTextProperties } from "./properties";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

function load(body: string): SvgDocument {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return SvgDocument.load(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`,
    host,
  );
}

function pick(doc: SvgDocument, selector: string): Element {
  const element = doc.root.querySelector(selector);
  if (!element) throw new Error(`No existe ${selector}`);
  return element;
}

describe("fuente con su familia de reserva", () => {
  it.each([
    ["Segoe UI", "Segoe UI, sans-serif"],
    ["Georgia", "Georgia, serif"],
    ["Times New Roman", "Times New Roman, serif"],
    ["Consolas", "Consolas, monospace"],
    ["Noto Sans", "Noto Sans, sans-serif"],
    ["Noto Serif JP", "Noto Serif JP, serif"],
    ["Yu Gothic UI", "Yu Gothic UI, sans-serif"],
    // Una palabra que empieza por un número no es un nombre de CSS válido sin comillas.
    ["Font 2000", "'Font 2000', sans-serif"],
    ["9 Point", "'9 Point', sans-serif"],
    ["Ma'Font", "'Ma\\'Font', sans-serif"],
    ["serif", "serif"],
  ])("%s → %s", (family, value) => {
    expect(fontFamilyValue(family)).toBe(value);
  });
});

describe("leer las propiedades de los textos", () => {
  it("lee las calculadas, vengan de atributos, de CSS o de un grupo", () => {
    const doc = load(`<style>.t { font-weight: bold }</style>
      <g font-family="'Noto Serif', serif" font-size="24">
        <text id="a" class="t" x="10" y="40" font-style="italic" text-anchor="middle">a</text>
      </g>`);
    expect(readTextProperties([pick(doc, "#a")])).toEqual({
      fontFamily: "Noto Serif",
      fontSize: 24,
      fontWeight: 700,
      italic: true,
      anchor: "middle",
      lineHeight: 1.2,
    });
  });

  it("con valores distintos da null, y sin textos no da nada", () => {
    const doc = load(
      `<text id="a" font-size="10">a</text><text id="b" font-size="20">b</text><rect id="r"/>`,
    );
    expect(readTextProperties([pick(doc, "#a"), pick(doc, "#b")])).toMatchObject({
      fontSize: null,
      fontWeight: 400,
      italic: false,
      anchor: "start",
    });
    expect(readTextProperties([pick(doc, "#r")])).toBeNull();
  });

  it("los textos dentro de un grupo seleccionado cuentan", () => {
    const doc = load(`<g id="g"><text font-size="12">a</text><text font-size="12">b</text></g>`);
    expect(readTextProperties([pick(doc, "#g")])?.fontSize).toBe(12);
  });
});

describe("cambiar las propiedades de los textos", () => {
  it("escribe la fuente con su reserva, el peso, la cursiva y la alineación en un paso", () => {
    const source = `<text id="a" x="10" y="40">a</text>`;
    const doc = load(source);
    const before = doc.serialize();
    const changed = applyTextChange(
      [pick(doc, "#a")],
      { fontFamily: "Georgia", fontWeight: 700, italic: true, anchor: "end" },
      doc.history,
    );
    expect(changed).toBe(true);
    const text = pick(doc, "#a");
    expect(text.getAttribute("font-family")).toBe("Georgia, serif");
    expect(text.getAttribute("font-weight")).toBe("700");
    expect(text.getAttribute("font-style")).toBe("italic");
    expect(text.getAttribute("text-anchor")).toBe("end");
    expect(doc.history.state.undoAction).toBe("text-style");
    doc.history.undo();
    expect(doc.serialize()).toBe(before);
  });

  it("al cambiar el tamaño, las líneas conservan el interlineado proporcional", () => {
    const doc = load(
      `<text id="a" x="10" y="40" font-size="10"><tspan x="10" y="40">a</tspan><tspan x="10" y="55">b</tspan></text>`,
    );
    applyTextChange([pick(doc, "#a")], { fontSize: 20 }, doc.history);
    expect(pick(doc, "#a").lastElementChild?.getAttribute("y")).toBe("70");
    applyTextChange([pick(doc, "#a")], { lineHeight: 2 }, doc.history);
    expect(pick(doc, "#a").lastElementChild?.getAttribute("y")).toBe("80");
  });

  it("los tspan que declaran la propiedad también cambian, para que no la tapen", () => {
    const doc = load(
      `<text id="a" x="10" y="40"><tspan x="10" y="40" style="font-size:10px;fill:red">a</tspan></text>`,
    );
    applyTextChange([pick(doc, "#a")], { fontSize: 30 }, doc.history);
    expect(pick(doc, "tspan").getAttribute("style")).toBe("font-size:30;fill:red");
    expect(readTextProperties([pick(doc, "#a")])?.fontSize).toBe(30);
  });

  it("cambios seguidos del mismo campo son un solo paso; sin textos no cambia nada", () => {
    const doc = load(`<text id="a" font-size="10">a</text><rect id="r"/>`);
    applyTextChange([pick(doc, "#a")], { fontSize: 11 }, doc.history);
    applyTextChange([pick(doc, "#a")], { fontSize: 12 }, doc.history);
    doc.history.undo();
    expect(pick(doc, "#a").getAttribute("font-size")).toBe("10");
    expect(applyTextChange([pick(doc, "#r")], { fontSize: 12 }, doc.history)).toBe(false);
    expect(applyTextChange([pick(doc, "#a")], { fontSize: -3 }, doc.history)).toBe(false);
  });
});
