/** Textos de prueba: fuentes, tamaños y transformaciones con los que se mide la precisión. */

export interface Case {
  readonly id: string;
  readonly font: string;
  readonly fontName: string;
  readonly size: number;
  readonly transform: string;
  readonly transformName: string;
  readonly letterSpacing?: number;
  readonly text: string;
}

/** Cada familia empieza por la fuente de Windows y sigue con equivalentes de Linux para la CI. */
export const FONTS = [
  {
    name: "sans",
    family: "Segoe UI, Inter, sans-serif",
    text: "Hola, mundo: ñandú AVATAR fi 0123",
  },
  {
    name: "serif",
    family: "Georgia, Liberation Serif, serif",
    text: "Hola, mundo: ñandú AVATAR fi 0123",
  },
  {
    name: "mono",
    family: "Consolas, JetBrains Mono, monospace",
    text: "Hola, mundo: ñandú AVATAR fi 0123",
  },
  {
    name: "japonés",
    family: "Yu Gothic, IPAGothic, sans-serif",
    text: "日本語のテキストと English mezcla",
  },
] as const;

export const TRANSFORMS = [
  { name: "ninguna", transform: "" },
  { name: "escala 2", transform: "scale(2)" },
  { name: "escala 0,5", transform: "scale(0.5)" },
  { name: "rotación 15°", transform: "rotate(15)" },
  { name: "sesgo 20°", transform: "skewX(-20)" },
  { name: "escala 2×1", transform: "scale(2 1)" },
] as const;

export const CASES: Case[] = [
  ...FONTS.flatMap((font) =>
    TRANSFORMS.map((transform) => ({
      id: `c-${font.name}-${transform.name}`.replace(/[^a-z0-9-]+/gi, "-"),
      font: font.family,
      fontName: font.name,
      size: 24,
      transform: transform.transform,
      transformName: transform.name,
      text: font.text,
    })),
  ),
  ...[11, 48].map((size) => ({
    id: `c-sans-${String(size)}`,
    font: FONTS[0].family,
    fontName: "sans",
    size,
    transform: "",
    transformName: "ninguna",
    text: FONTS[0].text,
  })),
  {
    id: "c-sans-espaciado",
    font: FONTS[0].family,
    fontName: "sans",
    size: 24,
    transform: "",
    transformName: "ninguna",
    letterSpacing: 2,
    text: FONTS[0].text,
  },
];

/** Texto que editan las pruebas de funcionamiento. */
export const EDIT_ID = "t-editar";
