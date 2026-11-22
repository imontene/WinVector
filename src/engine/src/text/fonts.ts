/**
 * Fuentes que usa un documento (issue #97): la lista de `font-family` calculada de cada texto, para
 * que la aplicación avise de las que no están instaladas. El documento no cambia.
 */

/** Separa una lista de `font-family` en familias, sin comillas ni espacios de más. */
export function splitFontFamilies(list: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of list) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      families.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  families.push(current);
  return families.map((family) => family.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/**
 * Listas de fuentes distintas que usan los textos de un documento (sin los de `defs`, máscaras…),
 * en orden alfabético. Cada lista va en su orden: la primera fuente es la pedida, las demás son de
 * reserva.
 */
export function documentFonts(root: Element): string[][] {
  const seen = new Map<string, string[]>();
  for (const element of root.querySelectorAll("text, tspan, textPath")) {
    if (element.closest("defs, clipPath, mask, pattern, marker, symbol")) continue;
    if (!element.textContent.trim()) continue;
    const families = splitFontFamilies(getComputedStyle(element).fontFamily);
    if (families.length === 0) continue;
    const key = families.join("\u0000").toLowerCase();
    if (!seen.has(key)) seen.set(key, families);
  }
  return [...seen.values()].sort((a, b) => a.join(",").localeCompare(b.join(","), "en"));
}
