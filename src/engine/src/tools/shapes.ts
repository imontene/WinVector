import type { ToolName } from "../bridge";
import type { Point, Rect } from "../geometry";
import { formatNumber } from "../transform";

/**
 * Geometría de las formas que se crean arrastrando. Cada forma dice qué elemento crea y cómo
 * escribe en él el arrastre; la herramienta común (shapeTool.ts) se ocupa del puntero, el
 * historial, el estilo y la selección.
 */

/** Un arrastre en las coordenadas del grupo donde se crea la forma. */
export interface ShapeDrag {
  readonly start: Point;
  readonly end: Point;
  /** `Mayús`: mantener la proporción (cuadrado, círculo, ángulos fijos). */
  readonly proportional: boolean;
  /** `Alt`: el punto inicial es el centro de la forma. */
  readonly fromCenter: boolean;
}

export interface ShapeKind {
  /** Elemento SVG que crea el arrastre (puede cambiar con las teclas: elipse o círculo). */
  tagFor(drag: ShapeDrag): string;
  /** Acción del historial ("create-rectangle"); la aplicación la traduce. */
  readonly action: string;
  /** Escribe la geometría del arrastre en el elemento. */
  apply(element: Element, drag: ShapeDrag): void;
  /** True si el arrastre no da una forma visible (ancho o alto cero): no se crea. */
  isEmpty(drag: ShapeDrag): boolean;
  /** Atributos de estilo con los que nace; si no se indica, relleno, trazo y grosor del estilo. */
  paint?(style: ShapeStyle): Readonly<Record<string, string>>;
}

/** Estilo con el que nacen las formas: el último que se ha usado. */
export interface ShapeStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/**
 * Caja que dibuja un arrastre: de la esquina inicial a la final o, con `fromCenter`, centrada en el
 * punto inicial. Con `proportional`, cuadrada, del lado mayor y hacia donde va el puntero.
 */
export function dragBox({ start, end, proportional, fromCenter }: ShapeDrag): Rect {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (proportional) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (fromCenter) {
    return {
      x: start.x - Math.abs(dx),
      y: start.y - Math.abs(dy),
      width: 2 * Math.abs(dx),
      height: 2 * Math.abs(dy),
    };
  }
  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/** Las coordenadas se guardan con dos decimales como máximo: suficiente y legible. */
export const coordinate = (value: number) => formatNumber(Math.round(value * 100) / 100);

const boxIsEmpty = (drag: ShapeDrag) => {
  const box = dragBox(drag);
  return box.width < 1e-6 || box.height < 1e-6;
};

const setAttributes = (element: Element, values: Readonly<Record<string, number>>) => {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, coordinate(value));
};

export const RECTANGLE: ShapeKind = {
  tagFor: () => "rect",
  action: "create-rectangle",
  apply(element, drag) {
    const { x, y, width, height } = dragBox(drag);
    setAttributes(element, { x, y, width, height });
  },
  isEmpty: boxIsEmpty,
};

/** Elipse inscrita en la caja del arrastre; con `Mayús`, un círculo (`<circle>`). */
export const ELLIPSE: ShapeKind = {
  tagFor: (drag) => (drag.proportional ? "circle" : "ellipse"),
  action: "create-ellipse",
  apply(element, drag) {
    const { x, y, width, height } = dragBox(drag);
    const cx = x + width / 2;
    const cy = y + height / 2;
    if (element.localName === "circle") setAttributes(element, { cx, cy, r: width / 2 });
    else setAttributes(element, { cx, cy, rx: width / 2, ry: height / 2 });
  },
  isEmpty: boxIsEmpty,
};

/** Paso del ángulo con `Mayús`, en grados. */
export const ANGLE_STEP = 15;

/** Lleva `point` al ángulo más cercano, en pasos de `step` grados vistos desde `origin`, con la misma distancia. */
export function snapAngle(origin: Point, point: Point, step = ANGLE_STEP): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return point;
  const radians = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI / step) * step * Math.PI) / 180;
  return { x: origin.x + length * Math.cos(radians), y: origin.y + length * Math.sin(radians) };
}

/** Extremos de la línea de un arrastre: `Mayús` fija el ángulo y `Alt` la centra en el punto inicial. */
export function lineEnds({ start, end, proportional, fromCenter }: ShapeDrag): [Point, Point] {
  const tip = proportional ? snapAngle(start, end) : end;
  const tail = fromCenter ? { x: 2 * start.x - tip.x, y: 2 * start.y - tip.y } : start;
  return [tail, tip];
}

/** Segmento recto (`<line>`). */
export const LINE: ShapeKind = {
  tagFor: () => "line",
  action: "create-line",
  apply(element, drag) {
    const [a, b] = lineEnds(drag);
    setAttributes(element, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  },
  isEmpty: (drag) => {
    const [a, b] = lineEnds(drag);
    return Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;
  },
  paint: (style) => ({
    // Una línea sin trazo no se vería: toma el color del relleno o, si tampoco hay, negro.
    stroke: style.stroke !== "none" ? style.stroke : style.fill !== "none" ? style.fill : "#000000",
    "stroke-width": formatNumber(style.strokeWidth),
  }),
};

/** Formas de cada herramienta. */
export const SHAPE_TOOLS: Partial<Readonly<Record<ToolName, ShapeKind>>> = {
  rectangle: RECTANGLE,
  ellipse: ELLIPSE,
  line: LINE,
};

/** La forma que crea una herramienta, o `undefined` si no es una herramienta de forma. */
export const shapeForTool = (tool: ToolName): ShapeKind | undefined => SHAPE_TOOLS[tool];
