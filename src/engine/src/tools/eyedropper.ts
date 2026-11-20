import type { ToolName } from "../bridge";
import type { History } from "../history";
import { pickAt, type Selection } from "../selection";
import { applyStyle, paintOf } from "../style";
import { isPressed } from "./modifiers";

export interface EyedropperHost {
  tool(): ToolName;
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
}

/**
 * Cuentagotas: con la herramienta activa, un clic en un objeto del lienzo toma su color y se lo da
 * de relleno a la selección; con `Mayús`, de trazo. Toma el relleno del objeto o, si no tiene (o es
 * un degradado), su trazo.
 */
export function installEyedropper(target: Window, host: EyedropperHost): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (host.tool() !== "eyedropper" || event.button !== 0) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const active = host.active();
    if (!active || active.selection.items.length === 0) return;
    const pick = pickAt(event.composedPath()[0] ?? null, active.root, { deep: true });
    if (!pick) return;
    const style = getComputedStyle(pick.element);
    const fill = paintOf(style.fill);
    const stroke = paintOf(style.stroke);
    const color = fill.startsWith("#") ? fill : stroke.startsWith("#") ? stroke : null;
    if (!color) return;
    const asStroke = isPressed(event, "Shift");
    applyStyle(
      active.selection.items,
      {
        fill: asStroke ? null : color,
        stroke: asStroke ? color : null,
        strokeWidth: null,
        opacity: null,
      },
      active.history,
    );
  };
  target.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () => {
    target.removeEventListener("pointerdown", onPointerDown, { capture: true });
  };
}
