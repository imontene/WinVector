import { afterEach, describe, expect, it } from "vitest";
import {
  cleanDefinitions,
  COLLECT_ATTRIBUTE,
  collectDefinitions,
  unusedDefinitions,
} from "./collect";
import { SvgDocument } from "./svgDocument";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

function load(source: string): SvgDocument {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return SvgDocument.load(source, host);
}

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">${body}</svg>`;
const mark = `${COLLECT_ATTRIBUTE}="always"`;
const stop = `<stop offset="0" stop-color="#000"/>`;
const ids = (doc: SvgDocument) =>
  [...doc.root.querySelectorAll("defs [id]")].map((element) => element.id);

describe("degradados de WinVector que nada usa (issue #113)", () => {
  it("se borran los marcados sin uso; los usados y los de otros programas se quedan", () => {
    const doc = load(
      svg(`<defs>
        <linearGradient id="mio" ${mark}>${stop}</linearGradient>
        <linearGradient id="usado" ${mark}>${stop}</linearGradient>
        <linearGradient id="ajeno">${stop}</linearGradient>
      </defs><rect fill="url(#usado)" width="10" height="10"/>`),
    );
    expect(collectDefinitions(doc.root)).toBe(1);
    expect(ids(doc)).toEqual(["usado", "ajeno"]);
  });

  it("una cadena href sin uso se borra entera; si algo usa el último, se queda toda", () => {
    const doc = load(
      svg(`<defs>
        <linearGradient id="paradas" ${mark}>${stop}</linearGradient>
        <linearGradient id="colocado" href="#paradas" ${mark}/>
        <linearGradient id="viejo" xlink:href="#paradas" ${mark}/>
      </defs><rect id="r" fill="url(#colocado)" width="10" height="10"/>`),
    );
    expect(collectDefinitions(doc.root)).toBe(1);
    expect(ids(doc)).toEqual(["paradas", "colocado"]);
    doc.root.querySelector("#r")?.setAttribute("fill", "#ff0000");
    expect(collectDefinitions(doc.root)).toBe(2);
    expect(ids(doc)).toEqual([]);
  });

  it("cuenta lo que usan el atributo style y las hojas de estilos", () => {
    const doc = load(
      svg(`<style>.c { stroke: url(#hoja) }</style><defs>
        <linearGradient id="estilo" ${mark}>${stop}</linearGradient>
        <linearGradient id="hoja" ${mark}>${stop}</linearGradient>
      </defs><rect style="fill: url('#estilo')" width="10" height="10"/>`),
    );
    expect(collectDefinitions(doc.root)).toBe(0);
  });

  it("al cerrar un paso del historial se borran en ese mismo paso, y deshacer los devuelve", () => {
    const source = svg(
      `<defs><linearGradient id="mio" ${mark}>${stop}</linearGradient></defs><rect id="r" fill="url(#mio)" width="10" height="10"/>`,
    );
    const doc = load(source);
    doc.history.transact("style", () => {
      doc.root.querySelector("#r")?.setAttribute("fill", "#ff0000");
    });
    expect(ids(doc)).toEqual([]);
    expect(doc.history.state.undoAction).toBe("style");
    doc.history.undo();
    expect(doc.serialize()).toBe(source);
  });
});

describe("limpiar definiciones sin usar", () => {
  it("quita lo que no alcanza el contenido, siguiendo href, use y las hojas de estilos", () => {
    const doc = load(
      svg(`<style>.c { fill: url(#por-clase) }</style><defs>
        <linearGradient id="base">${stop}</linearGradient>
        <linearGradient id="usado" href="#base"/>
        <linearGradient id="huerfano" href="#base"/>
        <linearGradient id="por-clase">${stop}</linearGradient>
        <symbol id="icono"><rect width="1" height="1" fill="url(#del-simbolo)"/></symbol>
        <linearGradient id="del-simbolo">${stop}</linearGradient>
        <clipPath id="recorte-sin-uso"><rect width="1" height="1"/></clipPath>
        <g id="contenedor"><linearGradient id="dentro">${stop}</linearGradient></g>
      </defs>
      <rect fill="url(#usado)" width="10" height="10"/>
      <rect class="c" width="10" height="10"/>
      <use href="#icono"/>
      <rect fill="url(#dentro)" width="10" height="10"/>`),
    );
    expect(unusedDefinitions(doc.root).map((element) => element.id)).toEqual([
      "huerfano",
      "recorte-sin-uso",
    ]);
    expect(cleanDefinitions(doc.root)).toBe(2);
    expect(cleanDefinitions(doc.root)).toBe(0);
  });
});
