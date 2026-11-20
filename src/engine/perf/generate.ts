/**
 * Documentos de prueba para medir el rendimiento: `count` objetos variados (rectángulos, círculos,
 * trazados con curvas, textos y algunos con degradado), en grupos de 50 como un documento real.
 * Siempre genera el mismo documento para el mismo número de objetos.
 */
export function generateDocument(count: number): string {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const columns = Math.ceil(Math.sqrt(count * 1.5));
  const rows = Math.ceil(count / columns);
  const cell = 20;
  const width = columns * cell;
  const height = rows * cell;
  const palette = ["#1f4f99", "#3a7bd5", "#ffb547", "#e94b3c", "#2a9d8f", "#9db7e0"];
  const color = () => palette[Math.floor(random() * palette.length)] ?? "#000";
  const number = (value: number) => String(Math.round(value * 100) / 100);

  const shapes: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % columns) * cell + 2;
    const y = Math.floor(i / columns) * cell + 2;
    const size = 8 + random() * 8;
    const fill = i % 37 === 0 ? "url(#degradado)" : color();
    switch (i % 4) {
      case 0:
        shapes.push(
          `<rect id="o${String(i)}" x="${number(x)}" y="${number(y)}" width="${number(size)}" height="${number(size)}" rx="2" fill="${fill}"/>`,
        );
        break;
      case 1:
        shapes.push(
          `<circle id="o${String(i)}" cx="${number(x + size / 2)}" cy="${number(y + size / 2)}" r="${number(size / 2)}" fill="${fill}" stroke="#000" stroke-width="0.5"/>`,
        );
        break;
      case 2:
        shapes.push(
          `<path id="o${String(i)}" d="M${number(x)} ${number(y + size)} C${number(x + size / 3)} ${number(y)} ${number(x + (2 * size) / 3)} ${number(y + size)} ${number(x + size)} ${number(y)}" fill="none" stroke="${color()}" stroke-width="1.5"/>`,
        );
        break;
      default:
        shapes.push(
          `<text id="o${String(i)}" x="${number(x)}" y="${number(y + 10)}" font-family="Segoe UI, sans-serif" font-size="8" fill="${fill}">T${String(i)}</text>`,
        );
    }
  }

  const groups: string[] = [];
  for (let start = 0; start < shapes.length; start += 50) {
    groups.push(
      `  <g id="grupo-${String(start / 50)}">\n    ${shapes.slice(start, start + 50).join("\n    ")}\n  </g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">
  <defs>
    <linearGradient id="degradado" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb547"/>
      <stop offset="1" stop-color="#e94b3c"/>
    </linearGradient>
  </defs>
${groups.join("\n")}
</svg>
`;
}
