import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "../document/svgDocument";

/** Un trazado que no se edita se guarda exactamente como llegó, aunque se edite lo de alrededor. */

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});

describe("trazados sin editar", () => {
  it("conservan su d tal cual al guardar", () => {
    const d = "M 0,0\n  L 10 , 10 l.5.5 c 1e1 0 1E+1 1 10,10 a5 5 0 1110 10 z";
    const source = `<svg xmlns="http://www.w3.org/2000/svg"><path id="p" d="${d}"/><rect id="r" x="1" width="2" height="2"/></svg>`;
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const doc = SvgDocument.load(source, host);
    doc.history.transact("move", () => {
      doc.root.querySelector("#r")?.setAttribute("x", "5");
    });
    const saved = doc.serialize();
    expect(saved).toContain(`d="${d}"`);
    expect(saved).toContain('x="5"');
  });
});
