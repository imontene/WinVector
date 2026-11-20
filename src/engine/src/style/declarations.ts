/**
 * Edición del texto de un atributo `style` sin tocar el resto de declaraciones: cambiar el relleno
 * de `style="fill:#f00;stroke:#000"` deja `stroke:#000` exactamente como estaba.
 */

interface Declaration {
  /** Texto completo de la declaración, tal cual. */
  readonly text: string;
  /** Nombre de la propiedad, en minúsculas y sin espacios. */
  readonly name: string;
}

/** Separa las declaraciones por `;`, sin cortar dentro de paréntesis ni de comillas (url(data:…;base64)). */
function split(style: string): Declaration[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const char = style.charAt(i);
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      parts.push(style.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(style.slice(start));
  return parts.map((text) => ({ text, name: text.split(":")[0]?.trim().toLowerCase() ?? "" }));
}

/** True si el texto del atributo style declara la propiedad. */
export function declaresProperty(style: string | null, property: string): boolean {
  return style !== null && split(style).some((declaration) => declaration.name === property);
}

/**
 * Devuelve el texto del atributo style con la propiedad cambiada (o añadida al final), o sin ella
 * si `value` es `null`. Las demás declaraciones, los espacios y el orden no cambian.
 */
export function setDeclaration(
  style: string | null,
  property: string,
  value: string | null,
): string {
  const declarations = split(style ?? "");
  const index = declarations.findIndex((declaration) => declaration.name === property);
  if (index >= 0) {
    const current = declarations[index];
    if (!current) return style ?? "";
    if (value === null) {
      declarations.splice(index, 1);
    } else {
      // Se conservan los espacios alrededor de los dos puntos y del valor.
      const colon = current.text.indexOf(":");
      const valueText = current.text.slice(colon + 1);
      const leading = /^\s*/.exec(valueText)?.[0] ?? "";
      const trailing = /\s*$/.exec(valueText)?.[0] ?? "";
      declarations[index] = {
        name: property,
        text: `${current.text.slice(0, colon + 1)}${leading}${value}${trailing}`,
      };
    }
    return declarations.map((declaration) => declaration.text).join(";");
  }
  if (value === null) return style ?? "";
  const text = style ?? "";
  if (text.trim() === "") return `${property}:${value}`;
  // Se añade después de la última declaración, respetando un ";" final si lo había.
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.endsWith(";")
    ? `${trimmed}${property}:${value}`
    : `${trimmed};${property}:${value}`;
}
