import type { ToolName } from "../bridge";
import { applyToPoint, invert, snapToGrid, type Matrix, type Point } from "../geometry";
import type { History } from "../history";
import type { Selection } from "../selection";
import { elementToRoot, formatNumber } from "../transform";
import { isPressed } from "./modifiers";
import { LINE, snapAngle, type ShapeStyle } from "./shapes";
import { writeVertices } from "./vertices";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Distancia en píxeles al primer vértice para cerrar la forma. */
const CLOSE_DISTANCE = 6;
/** Dos clics a menos de esta distancia (los del doble clic) son el mismo vértice. */
const SAME_POINT = 3;

export interface PenToolHost {
  tool(): ToolName;
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  snapSpacing(): number | null;
  style(): ShapeStyle;
  /** Ha cambiado lo que se dibuja en la capa de superposición. */
  changed(): void;
}

/** Lo que dibuja la capa de superposición mientras se dibuja: el primer vértice y si cerraría. */
export interface PenScene {
  readonly start: Point;
  readonly closing: boolean;
}

interface Drawing {
  readonly root: SVGSVGElement;
  readonly history: History;
  readonly selection: Selection;
  readonly parent: Element;
  /** De la pantalla a las coordenadas del grupo, y al revés. */
  readonly toParent: Matrix;
  readonly toScreen: Matrix;
  /** Polilínea de vista previa: los vértices fijados y el que sigue al puntero. */
  readonly preview: Element;
  readonly points: Point[];
  /** Vértices fijados en pantalla, para el doble clic y para cerrar. */
  readonly screen: Point[];
  pointer: Point | null;
  closing: boolean;
}

const toMatrix = (m: DOMMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });

/**
 * Formas libres de líneas rectas (issue #62), en el botón de la pluma (atajo `P`): cada clic añade
 * un vértice y una línea de vista previa sigue al puntero.
 *
 * - Clic en el primer vértice (con tres o más): cierra la forma, que es un `<polygon>` con el último
 *   estilo usado.
 * - Doble clic o `Intro`: la termina abierta, como `<polyline>` con trazo y sin relleno.
 * - `Retroceso` quita el último vértice; `Esc` cancela la forma entera.
 * - `Mayús` fija el ángulo del segmento de 15° en 15°; con la cuadrícula activa, los vértices se
 *   ajustan a ella.
 *
 * La forma terminada es un solo paso del historial y queda seleccionada; sus vértices se editan con
 * la herramienta Vértices. Pensada para que la pluma de la Fase 3 la amplíe con curvas.
 */
export function installPenTool(target: Window, host: PenToolHost) {
  const page = target.document;
  let drawing: Drawing | null = null;

  const isActive = () => host.tool() === "pen";
  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });

  /** Punto de la pantalla en el grupo, con Mayús (ángulo) y la cuadrícula. */
  const place = (current: Drawing, screen: Point, shift: boolean): Point => {
    let p = applyToPoint(current.toParent, screen);
    const last = current.points.at(-1);
    if (shift && last) p = snapAngle(last, p);
    const spacing = host.snapSpacing();
    if (spacing && !shift) {
      const toRoot =
        current.parent === current.root ? null : elementToRoot(current.parent, current.root);
      const fromRoot = toRoot ? invert(toRoot) : null;
      const rootPoint = toRoot ? applyToPoint(toRoot, p) : p;
      const snapped = snapToGrid(rootPoint, spacing);
      p = fromRoot ? applyToPoint(fromRoot, snapped) : snapped;
    }
    return p;
  };

  const redraw = (current: Drawing) => {
    const pointer = current.pointer;
    const points = pointer && !current.closing ? [...current.points, pointer] : current.points;
    writeVertices(
      current.preview,
      points.length === 1 && points[0] ? [points[0], points[0]] : points,
    );
    host.changed();
  };

  const start = (screen: Point, shift: boolean) => {
    const active = host.active();
    if (!active) return;
    const parent = active.selection.scope;
    const ctm = parent instanceof SVGGraphicsElement ? parent.getScreenCTM() : null;
    const toScreen = ctm ? toMatrix(ctm) : null;
    const toParent = toScreen ? invert(toScreen) : null;
    if (!toScreen || !toParent) return;
    active.history.begin("create-polyline");
    const preview = page.createElementNS(SVG_NS, "polyline");
    for (const [name, value] of Object.entries(paintOf(host.style(), false)))
      preview.setAttribute(name, value);
    parent.append(preview);
    drawing = {
      root: active.root,
      history: active.history,
      selection: active.selection,
      parent,
      toParent,
      toScreen,
      preview,
      points: [],
      screen: [],
      pointer: null,
      closing: false,
    };
    add(drawing, screen, shift);
  };

  const add = (current: Drawing, screen: Point, shift: boolean) => {
    const p = place(current, screen, shift);
    current.points.push(p);
    current.screen.push(applyToPoint(current.toScreen, p));
    current.pointer = p;
    redraw(current);
  };

  /**
   * Termina la forma: cerrada (polígono) o abierta (polilínea). La vista previa se anula y la forma
   * final se crea en un paso propio, con el nombre de lo que es.
   */
  const finish = (closed: boolean) => {
    const current = drawing;
    if (!current) return;
    drawing = null;
    const points = current.points;
    current.history.rollback();
    host.changed();
    if (points.length < (closed ? 3 : 2)) return;
    const element = current.history.transact(closed ? "create-polygon" : "create-polyline", () => {
      const shape = page.createElementNS(SVG_NS, closed ? "polygon" : "polyline");
      for (const [name, value] of Object.entries(paintOf(host.style(), closed)))
        shape.setAttribute(name, value);
      writeVertices(shape, points);
      current.parent.append(shape);
      return shape;
    });
    current.selection.set([element], current.parent);
  };

  const cancel = () => {
    if (!drawing) return;
    drawing.history.rollback();
    drawing = null;
    host.changed();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isActive()) return;
    consume(event);
    if (event.button !== 0) return;
    const screen = point(event);
    if (!drawing) {
      start(screen, false);
      return;
    }
    const [first] = drawing.screen;
    const last = drawing.screen.at(-1);
    if (
      first &&
      drawing.points.length >= 3 &&
      Math.hypot(screen.x - first.x, screen.y - first.y) <= CLOSE_DISTANCE
    ) {
      finish(true);
      return;
    }
    // El segundo clic de un doble clic cae en el mismo sitio: no es otro vértice.
    if (last && Math.hypot(screen.x - last.x, screen.y - last.y) <= SAME_POINT) return;
    add(drawing, screen, isPressed(event, "Shift"));
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isActive()) return;
    event.stopImmediatePropagation();
    if (!drawing) return;
    const screen = point(event);
    const [first] = drawing.screen;
    drawing.closing =
      first !== undefined &&
      drawing.points.length >= 3 &&
      Math.hypot(screen.x - first.x, screen.y - first.y) <= CLOSE_DISTANCE;
    drawing.pointer = place(drawing, screen, isPressed(event, "Shift"));
    redraw(drawing);
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (!isActive()) return;
    consume(event);
    finish(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!drawing) return;
    if (event.key === "Escape") {
      cancel();
      consume(event);
    } else if (event.key === "Enter") {
      finish(false);
      consume(event);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      drawing.points.pop();
      drawing.screen.pop();
      if (drawing.points.length === 0) cancel();
      else redraw(drawing);
      consume(event);
    }
  };

  const onOther = (event: Event) => {
    if (isActive()) consume(event);
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onOther],
    ["click", onOther],
    ["dblclick", onDoubleClick as EventListener],
    ["keydown", onKeyDown as EventListener],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });

  return {
    /** El primer vértice en pantalla mientras se dibuja, o `null`. */
    scene(): PenScene | null {
      const [first] = drawing?.screen ?? [];
      return drawing && first ? { start: first, closing: drawing.closing } : null;
    },
    /** Al cambiar de herramienta: la forma a medias se termina abierta (si tiene dos vértices). */
    finish() {
      finish(false);
    },
    dispose() {
      cancel();
      for (const [type, listener] of listeners) {
        target.removeEventListener(type, listener, { capture: true });
      }
    },
  };
}

/** Estilo de la forma: cerrada, el último usado; abierta, como una línea (con trazo, sin relleno). */
function paintOf(style: ShapeStyle, closed: boolean): Record<string, string> {
  if (closed) {
    return {
      fill: style.fill,
      stroke: style.stroke,
      "stroke-width": formatNumber(style.strokeWidth),
    };
  }
  return { fill: "none", ...LINE.paint?.(style) };
}
