import { afterEach, describe, expect, it } from "vitest";
import { SvgDocument } from "./svgDocument";

/**
 * Corpus de SVG de referencia (tests/corpus): cada archivo debe abrirse y guardarse sin dañarse.
 * Ver tests/corpus/README.md para añadir casos.
 */
const files = import.meta.glob<string>("../../../../tests/corpus/**/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

const cases = Object.entries(files)
  .map(([path, url]) => ({ name: path.replace(/^.*tests\/corpus\//, ""), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Lee el archivo tal cual, sin quitar la marca BOM. */
async function readExact(url: string): Promise<string> {
  const response = await fetch(url);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
}

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

/** Representación del documento independiente del formato: nombres, atributos ordenados y nodos. */
function canonical(source: string): unknown {
  const xml = new DOMParser().parseFromString(source.replace(/^\uFEFF/, ""), "image/svg+xml");
  const walk = (node: Node): unknown => {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const element = node as Element;
        return {
          name: `${element.namespaceURI ?? ""} ${element.localName}`,
          attributes: [...element.attributes]
            .map((a) => `${a.namespaceURI ?? ""} ${a.localName}=${a.value}`)
            .sort(),
          children: [...element.childNodes].map(walk),
        };
      }
      case Node.TEXT_NODE:
      case Node.CDATA_SECTION_NODE:
        return `texto:${(node as CharacterData).data}`;
      case Node.COMMENT_NODE:
        return `comentario:${(node as Comment).data}`;
      case Node.PROCESSING_INSTRUCTION_NODE:
        return `pi:${(node as ProcessingInstruction).target} ${(node as ProcessingInstruction).data}`;
      default:
        return null;
    }
  };
  return walk(xml.documentElement);
}

const RENDER_SIZE = 256;

/** Dibuja el SVG como imagen (sin scripts ni recursos externos) y devuelve sus píxeles. */
async function render(source: string): Promise<Uint8ClampedArray> {
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = new Image(RENDER_SIZE, RENDER_SIZE);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = RENDER_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Sin contexto 2D");
    context.drawImage(image, 0, 0, RENDER_SIZE, RENDER_SIZE);
    return context.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fracción de píxeles que difieren en más de `tolerance` en algún canal. */
function differentPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance = 2): number {
  let different = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > tolerance) {
        different++;
        break;
      }
    }
  }
  return different / (a.length / 4);
}

describe("corpus de SVG", () => {
  it("tiene casos", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(cases)("$name", ({ url }) => {
    it("se guarda idéntico si no se modifica", async () => {
      const source = await readExact(url);
      const doc = load(source);
      expect(doc.hasExactMapping).toBe(true);
      expect(doc.serialize()).toBe(source);
    });

    it("al regenerar todas las etiquetas sigue siendo el mismo documento", async () => {
      const source = await readExact(url);
      const doc = load(source);
      // Con un formato habitual el texto puede salir idéntico: los atributos intactos conservan su texto.
      expect(canonical(doc.serialize({ regenerate: true }))).toEqual(canonical(source));
    });

    it("al regenerar todas las etiquetas se ve igual", async ({ skip }) => {
      const source = await readExact(url);
      // Las animaciones SMIL cambian con el tiempo: dos capturas no coinciden aunque el SVG sea igual.
      if (/<animate|<set\b/.test(source)) skip("contiene animaciones");
      // Chromium no deja leer los píxeles de una imagen SVG con foreignObject (lienzo de origen cruzado).
      if (source.includes("<foreignObject"))
        skip("Chromium no permite leer los píxeles de un SVG con foreignObject");
      const doc = load(source);
      const regenerated = doc.serialize({ regenerate: true });
      const [before, after] = await Promise.all([render(source), render(regenerated)]);
      expect(differentPixels(before, after)).toBeLessThanOrEqual(0.001);
    });
  });
});
