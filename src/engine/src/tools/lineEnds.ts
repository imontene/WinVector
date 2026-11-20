import { applyToPoint, invert, type Point } from "../geometry";
import type { ShapeHandles } from "./shapeHandles";
import { coordinate, snapAngle } from "./shapes";

/**
 * Extremos de una línea seleccionada: dos manejadores que sustituyen a los de escalar y girar.
 * Arrastrar uno lo mueve; con `Mayús`, el ángulo respecto al otro extremo va de 15° en 15°.
 */
export function lineHandles(line: SVGLineElement): ShapeHandles | null {
  const ctm = line.getScreenCTM();
  if (!ctm) return null;
  const toScreen = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f };
  const toLocal = invert(toScreen);
  if (!toLocal) return null;
  const ends: [Point, Point] = [
    { x: line.x1.baseVal.value, y: line.y1.baseVal.value },
    { x: line.x2.baseVal.value, y: line.y2.baseVal.value },
  ];
  return {
    action: "line-end",
    cursor: "move",
    replacesBox: true,
    points: () => ends.map((end) => applyToPoint(toScreen, end)),
    start(index) {
      const [x, y] = index === 0 ? ["x1", "y1"] : ["x2", "y2"];
      const fixed = index === 0 ? ends[1] : ends[0];
      return {
        update(pointer, shift) {
          const local = applyToPoint(toLocal, pointer);
          const end = shift ? snapAngle(fixed, local) : local;
          line.setAttribute(x, coordinate(end.x));
          line.setAttribute(y, coordinate(end.y));
        },
      };
    },
  };
}
