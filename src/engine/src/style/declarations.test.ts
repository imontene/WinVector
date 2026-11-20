import { describe, expect, it } from "vitest";
import { declaresProperty, setDeclaration } from "./declarations";

describe("declaraciones del atributo style", () => {
  it.each([
    ["fill:#f00;stroke:#000", "fill", "#00ff00", "fill:#00ff00;stroke:#000"],
    [
      "stroke:#000; fill : red ;opacity:.5",
      "fill",
      "#00ff00",
      "stroke:#000; fill : #00ff00 ;opacity:.5",
    ],
    ["stroke:#000", "fill", "none", "stroke:#000;fill:none"],
    ["stroke:#000;", "fill", "none", "stroke:#000;fill:none"],
    ["", "fill", "none", "fill:none"],
    [null, "fill", "none", "fill:none"],
    [
      "fill:url(data:image/png;base64,AAA);stroke:red",
      "stroke",
      "blue",
      "fill:url(data:image/png;base64,AAA);stroke:blue",
    ],
    ["font-family:'a;b';fill:red", "fill", "blue", "font-family:'a;b';fill:blue"],
  ])("%j: %s = %s", (style, property, value, expected) => {
    expect(setDeclaration(style, property, value)).toBe(expected);
  });

  it("quita una declaración sin tocar las demás", () => {
    expect(setDeclaration("a:1; fill:red ;b:2", "fill", null)).toBe("a:1;b:2");
  });

  it("sabe si una propiedad está declarada", () => {
    expect(declaresProperty("stroke-width:2;fill-opacity:1", "fill")).toBe(false);
    expect(declaresProperty("FILL: red", "fill")).toBe(true);
    expect(declaresProperty(null, "fill")).toBe(false);
  });
});
