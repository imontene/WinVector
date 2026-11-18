import sampleSvg from "./sample.svg?raw";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Muestra un documento SVG en la zona de trabajo.
 *
 * Provisional: en la Fase 1 el módulo `document` se encargará de cargar, validar y preservar el
 * contenido. Aquí solo se analiza el texto y se inserta el resultado.
 */
function showDocument(source: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new Error("El documento no es un SVG válido.");
  }

  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  const { width, height } = svg.viewBox.baseVal;
  if (width > 0 && height > 0) {
    svg.style.setProperty("--artboard-ratio", String(width / height));
  }

  const workspace = document.getElementById("workspace");
  if (!workspace) {
    throw new Error("Falta el contenedor #workspace en la página.");
  }
  workspace.replaceChildren(svg);
  return svg;
}

showDocument(sampleSvg);
