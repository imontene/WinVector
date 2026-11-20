import type { ToolName } from "../bridge";
import { POLYGON, STAR } from "./polygons";
import { ELLIPSE, LINE, RECTANGLE, type ShapeKind } from "./shapes";

/** Formas de cada herramienta. */
export const SHAPE_TOOLS: Partial<Readonly<Record<ToolName, ShapeKind>>> = {
  rectangle: RECTANGLE,
  ellipse: ELLIPSE,
  line: LINE,
  polygon: POLYGON,
  star: STAR,
};

/** La forma que crea una herramienta, o `undefined` si no es una herramienta de forma. */
export const shapeForTool = (tool: ToolName): ShapeKind | undefined => SHAPE_TOOLS[tool];
