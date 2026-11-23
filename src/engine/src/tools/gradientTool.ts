import type { ToolName } from "../bridge";
import type { SvgDocument } from "../document";
import { applyToPoint, invert, multiply, type Matrix, type Point } from "../geometry";
import type { History } from "../history";
import {
  applyGradient,
  type GradientStop,
  ownGradient,
  type PaintProperty,
  paintGradient,
  readGradient,
  type Gradient,
  writeGradient,
} from "../paint";
import { pickAt, type Selection } from "../selection";
import { paintTargets } from "../style/style";
import { parseTransform } from "../transform";
import { isPressed } from "./modifiers";
import { snapAngle } from "./shapes";

/** Distancia en píxeles para tocar un manejador, una parada o la línea. */
const HIT_DISTANCE = 6;
/** Píxeles que hay que mover el puntero con el botón pulsado para crear un degradado arrastrando. */
const DRAG_THRESHOLD = 3;

export interface GradientToolHost {
  tool(): ToolName;
  active(): {
    readonly document: SvgDocument;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  /** Ha cambiado lo que se dibuja en la capa de superposición. */
  changed(): void;
}

/** Manejador de un degradado en pantalla. */
export interface GradientHandle {
  readonly at: Point;
  readonly kind: "start" | "end" | "center" | "radius" | "focus";
  /** Es del degradado del trazo (se dibuja distinto). */
  readonly stroke: boolean;
}

/** Lo que dibuja la capa de superposición con la herramienta Degradado, en pantalla. */
export interface GradientScene {
  readonly lines: readonly { readonly from: Point; readonly to: Point; readonly stroke: boolean }[];
  readonly handles: readonly GradientHandle[];
  readonly stops: readonly {
    readonly at: Point;
    readonly color: string;
    readonly selected: boolean;
    readonly stroke: boolean;
  }[];
}

/** Un degradado de una pintura del objeto, con lo que hace falta para dibujarlo y moverlo. */
interface Frame {
  readonly property: PaintProperty;
  readonly gradient: SVGGradientElement;
  readonly read: Gradient;
  /** Del espacio del degradado (sus x1, cx…) a la pantalla, y al revés. */
  readonly toScreen: Matrix;
  readonly fromScreen: Matrix;
  /** Extremos de la línea de las paradas, en el espacio del degradado. */
  readonly from: Point;
  readonly to: Point;
}

type Target =
  | {
      readonly kind: "handle";
      readonly property: PaintProperty;
      readonly handle: GradientHandle["kind"];
    }
  | { readonly kind: "stop"; readonly property: PaintProperty; readonly index: number }
  | { readonly kind: "line"; readonly property: PaintProperty; readonly t: number };

interface Press {
  readonly element: Element;
  readonly start: Point;
  readonly target: Target | null;
  /** Pintura del degradado que se crea arrastrando sobre el objeto. */
  readonly property: PaintProperty;
  dragged: boolean;
  /** Parada que se arrastra (cambia de índice si pasa a otra). */
  stop: number;
}

const toMatrix = (m: DOMMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Parte de 0 a 1 de la proyección de `p` sobre el segmento de `a` a `b`. */
function along(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  return length === 0
    ? 0
    : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
}

/** Distancia de `p` al segmento de `a` a `b`. */
const distanceToSegment = (a: Point, b: Point, p: Point) => {
  const q = lerp(a, b, along(a, b, p));
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** Color de un degradado en una posición, mezclando las paradas vecinas. */
function stopAt(stops: readonly GradientStop[], offset: number): GradientStop {
  const before = [...stops].reverse().find((stop) => stop.offset <= offset) ?? stops[0];
  const after = stops.find((stop) => stop.offset >= offset) ?? stops.at(-1);
  if (!before || !after) return { offset, color: "#000000", opacity: 1 };
  const span = after.offset - before.offset;
  const t = span <= 1e-9 ? 0 : (offset - before.offset) / span;
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const color = [0, 1, 2]
    .map((i) =>
      Math.round(
        channel(before.color, i) + (channel(after.color, i) - channel(before.color, i)) * t,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return {
    offset,
    color: `#${color}`,
    opacity: round(before.opacity + (after.opacity - before.opacity) * t),
  };
}

/**
 * Herramienta Degradado (atajo `D`, issue #110): los degradados del objeto seleccionado se editan
 * sobre el lienzo.
 *
 * - Lineal: manejadores de inicio y fin. Radial: centro, radio y foco (con `Mayús`, arrastrar el
 *   centro mueve solo el foco). Con `Mayús`, los extremos giran de 15° en 15°.
 * - Las paradas se ven sobre la línea: se arrastran, doble clic en la línea añade una y `Supr` borra
 *   la elegida (quedan al menos dos).
 * - Arrastrar sobre un objeto le pone un degradado entre los dos puntos: el que tenga (en su
 *   tipo) o uno lineal nuevo. Con `Alt`, el del trazo.
 * - Clic en otro objeto lo selecciona. Cada arrastre es un paso del historial; `Esc` lo cancela.
 */
export function installGradientTool(target: Window, host: GradientToolHost) {
  let press: Press | null = null;
  let selected: {
    readonly element: Element;
    readonly property: PaintProperty;
    readonly index: number;
  } | null = null;

  const isActive = () => host.tool() === "gradient";
  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });

  /** El objeto cuyos degradados se editan: el único seleccionado que se pinta. */
  const current = () => {
    const active = host.active();
    const [only] = active?.selection.items ?? [];
    if (!active || !only || active.selection.items.length !== 1) return null;
    const [element] = paintTargets(only);
    if (!element) return null;
    if (selected && selected.element !== element) selected = null;
    return { ...active, element };
  };

  /** El degradado de una pintura del objeto, con sus transformaciones hasta la pantalla. */
  const frameOf = (
    element: Element,
    property: PaintProperty,
    root: SVGSVGElement,
  ): Frame | null => {
    const gradient = paintGradient(element, property, root);
    const ctm = (element as SVGGraphicsElement).getScreenCTM();
    if (!gradient || !ctm) return null;
    const read = readGradient(gradient, root);
    let m = toMatrix(ctm);
    if (read.units === "objectBoundingBox") {
      const box = (element as SVGGraphicsElement).getBBox();
      m = multiply(m, { a: box.width, b: 0, c: 0, d: box.height, e: box.x, f: box.y });
    }
    if (read.transform) m = multiply(m, parseTransform(read.transform, element.ownerDocument));
    const inverse = invert(m);
    if (!inverse) return null;
    const from = read.linear
      ? { x: read.linear.x1, y: read.linear.y1 }
      : { x: read.radial?.cx ?? 0, y: read.radial?.cy ?? 0 };
    const to = read.linear
      ? { x: read.linear.x2, y: read.linear.y2 }
      : { x: (read.radial?.cx ?? 0) + (read.radial?.r ?? 0), y: read.radial?.cy ?? 0 };
    return { property, gradient, read, toScreen: m, fromScreen: inverse, from, to };
  };

  const frames = () => {
    const editing = current();
    if (!editing) return [];
    const root = editing.document.root;
    return (["fill", "stroke"] as const)
      .map((property) => frameOf(editing.element, property, root))
      .filter((frame): frame is Frame => frame !== null);
  };

  const handlesOf = (frame: Frame): GradientHandle[] => {
    const stroke = frame.property === "stroke";
    const screen = (p: Point) => applyToPoint(frame.toScreen, p);
    if (frame.read.linear) {
      return [
        { at: screen(frame.from), kind: "start", stroke },
        { at: screen(frame.to), kind: "end", stroke },
      ];
    }
    const radial = frame.read.radial;
    const handles: GradientHandle[] = [
      { at: screen(frame.from), kind: "center", stroke },
      { at: screen(frame.to), kind: "radius", stroke },
    ];
    if (radial && Math.hypot(radial.fx - radial.cx, radial.fy - radial.cy) > 1e-9) {
      handles.push({ at: screen({ x: radial.fx, y: radial.fy }), kind: "focus", stroke });
    }
    return handles;
  };

  const stopPoints = (frame: Frame) =>
    frame.read.stops.map((stop) =>
      applyToPoint(frame.toScreen, lerp(frame.from, frame.to, stop.offset)),
    );

  /** Lo que hay bajo el puntero: una parada, un manejador o la línea (en ese orden). */
  const hit = (p: Point): Target | null => {
    const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) <= HIT_DISTANCE;
    for (const frame of frames()) {
      const index = stopPoints(frame).findIndex(near);
      // Las paradas de los extremos coinciden con los manejadores: estos tienen prioridad.
      const handle = handlesOf(frame).find((h) => near(h.at));
      if (handle) return { kind: "handle", property: frame.property, handle: handle.kind };
      if (index >= 0) return { kind: "stop", property: frame.property, index };
    }
    for (const frame of frames()) {
      const a = applyToPoint(frame.toScreen, frame.from);
      const b = applyToPoint(frame.toScreen, frame.to);
      if (distanceToSegment(a, b, p) <= HIT_DISTANCE) {
        return { kind: "line", property: frame.property, t: along(a, b, p) };
      }
    }
    return null;
  };

  /** Escribe las paradas, ordenadas, y deja elegida la que estaba en `index`. */
  const writeStops = (
    frame: Frame,
    stops: GradientStop[],
    index: number,
    element: Element,
    root: SVGSVGElement,
  ) => {
    const chosen = stops[index];
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    writeGradient(frame.gradient, root, { stops: sorted });
    selected = { element, property: frame.property, index: chosen ? sorted.indexOf(chosen) : -1 };
    return selected.index;
  };

  /** Mueve un manejador del degradado al punto de la pantalla `p`. */
  const moveHandle = (
    frame: Frame,
    handle: GradientHandle["kind"],
    screen: Point,
    shift: boolean,
    gradientRoot: SVGSVGElement,
  ) => {
    const space = (p: Point) => applyToPoint(frame.fromScreen, p);
    const other = applyToPoint(frame.toScreen, handle === "start" ? frame.to : frame.from);
    const p = space(
      shift && (handle === "start" || handle === "end") ? snapAngle(other, screen) : screen,
    );
    const radial = frame.read.radial;
    switch (handle) {
      case "start":
        writeGradient(frame.gradient, gradientRoot, { linear: { x1: p.x, y1: p.y } });
        break;
      case "end":
        writeGradient(frame.gradient, gradientRoot, { linear: { x2: p.x, y2: p.y } });
        break;
      case "center":
        if (!radial) break;
        if (shift) {
          writeGradient(frame.gradient, gradientRoot, { radial: { fx: p.x, fy: p.y } });
          break;
        }
        {
          const dx = p.x - radial.cx;
          const dy = p.y - radial.cy;
          const focused = frame.gradient.hasAttribute("fx") || frame.gradient.hasAttribute("fy");
          writeGradient(frame.gradient, gradientRoot, {
            radial: {
              cx: p.x,
              cy: p.y,
              ...(focused ? { fx: radial.fx + dx, fy: radial.fy + dy } : {}),
            },
          });
        }
        break;
      case "radius":
        if (radial) {
          writeGradient(frame.gradient, gradientRoot, {
            radial: { r: Math.hypot(p.x - radial.cx, p.y - radial.cy) },
          });
        }
        break;
      case "focus":
        writeGradient(frame.gradient, gradientRoot, { radial: { fx: p.x, fy: p.y } });
        break;
    }
  };

  /** Pone un degradado entre dos puntos de la pantalla en una pintura del objeto. */
  const placeGradient = (
    editing: NonNullable<ReturnType<typeof current>>,
    property: PaintProperty,
    from: Point,
    to: Point,
  ) => {
    const root = editing.document.root;
    if (!paintGradient(editing.element, property, root)) {
      applyGradient(
        editing.document,
        [editing.element],
        { property, kind: "linear" },
        editing.history,
      );
    } else {
      ownGradient(editing.element, property, root);
    }
    const frame = frameOf(editing.element, property, root);
    if (!frame) return;
    const a = applyToPoint(frame.fromScreen, from);
    const b = applyToPoint(frame.fromScreen, to);
    if (frame.read.linear) {
      writeGradient(frame.gradient, root, { linear: { x1: a.x, y1: a.y, x2: b.x, y2: b.y } });
    } else {
      writeGradient(frame.gradient, root, {
        radial: { cx: a.x, cy: a.y, r: Math.hypot(b.x - a.x, b.y - a.y), fx: a.x, fy: a.y },
      });
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isActive() || event.button !== 0 || press) return;
    const active = host.active();
    if (!active) return;
    consume(event);
    const p = point(event);
    const found = hit(p);
    const editing = current();
    if (found && editing) {
      // Un manejador, una parada o la línea del objeto seleccionado.
      active.history.begin("gradient");
      // El degradado pasa a ser propio antes de cambiarlo (ADR 0009).
      ownGradient(editing.element, found.property, active.document.root);
      if (found.kind === "stop")
        selected = { element: editing.element, property: found.property, index: found.index };
      press = {
        element: editing.element,
        start: p,
        target: found,
        property: found.property,
        dragged: false,
        stop: found.kind === "stop" ? found.index : -1,
      };
      target.document.documentElement.setPointerCapture(event.pointerId);
      host.changed();
      return;
    }
    // Otro objeto: se selecciona, y arrastrando se le pone un degradado.
    const pick = pickAt(event.composedPath()[0] ?? null, active.document.root, {
      scope: active.selection.scope,
    });
    if (!pick) {
      active.selection.set([], active.selection.scope);
      selected = null;
      host.changed();
      return;
    }
    if (!active.selection.items.includes(pick.element) || active.selection.items.length !== 1) {
      active.selection.set([pick.element], pick.scope);
    }
    const [element] = paintTargets(pick.element);
    if (!element) return;
    active.history.begin("gradient");
    press = {
      element,
      start: p,
      target: null,
      property: isPressed(event, "Alt") ? "stroke" : "fill",
      dragged: false,
      stop: -1,
    };
    target.document.documentElement.setPointerCapture(event.pointerId);
    host.changed();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isActive() || !press) return;
    consume(event);
    const p = point(event);
    if (!press.dragged && Math.hypot(p.x - press.start.x, p.y - press.start.y) < DRAG_THRESHOLD)
      return;
    press.dragged = true;
    const editing = current();
    if (!editing) return;
    const shift = isPressed(event, "Shift");
    const root = editing.document.root;
    const found = press.target;
    if (!found) {
      placeGradient(editing, press.property, press.start, shift ? snapAngle(press.start, p) : p);
    } else {
      const frame = frameOf(editing.element, found.property, root);
      if (frame && found.kind === "handle") moveHandle(frame, found.handle, p, shift, root);
      if (frame && found.kind === "stop" && press.stop >= 0) {
        const a = applyToPoint(frame.toScreen, frame.from);
        const b = applyToPoint(frame.toScreen, frame.to);
        const stops = frame.read.stops.map((stop, i) =>
          i === press?.stop ? { ...stop, offset: round(along(a, b, p)) } : stop,
        );
        press.stop = writeStops(frame, stops, press.stop, editing.element, root);
      }
    }
    host.changed();
  };

  const finish = (cancel: boolean) => {
    const active = host.active();
    const current = press;
    press = null;
    if (!active || !current) return;
    // Un clic sin arrastrar no cambia nada: no queda paso (ni la copia del degradado).
    if (cancel || !current.dragged) active.history.rollback();
    else active.history.commit();
    host.changed();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isActive() || !press) return;
    consume(event);
    finish(false);
  };

  /** Doble clic en la línea: una parada nueva con el color que hay ahí. */
  const onDoubleClick = (event: MouseEvent) => {
    if (!isActive()) return;
    const found = hit(point(event));
    const editing = current();
    if (found?.kind !== "line" || !editing) return;
    consume(event);
    editing.history.transact("gradient", () => {
      const gradient = ownGradient(editing.element, found.property, editing.document.root);
      const frame = gradient
        ? frameOf(editing.element, found.property, editing.document.root)
        : null;
      if (!frame) return;
      const added = stopAt(frame.read.stops, round(found.t));
      const stops = [...frame.read.stops, added];
      writeStops(frame, stops, stops.length - 1, editing.element, editing.document.root);
    });
    host.changed();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isActive()) return;
    if (event.key === "Escape" && press) {
      consume(event);
      finish(true);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      const editing = current();
      const chosen = selected;
      if (!editing) return;
      const frame = frameOf(editing.element, chosen.property, editing.document.root);
      // Con dos paradas no se borra ninguna, pero la tecla tampoco borra el objeto.
      consume(event);
      if (!frame || frame.read.stops.length <= 2) return;
      editing.history.transact("gradient", () => {
        ownGradient(editing.element, chosen.property, editing.document.root);
        const own = frameOf(editing.element, chosen.property, editing.document.root);
        if (!own) return;
        const stops = own.read.stops.filter((_, i) => i !== chosen.index);
        writeGradient(own.gradient, editing.document.root, { stops });
      });
      selected = null;
      host.changed();
    }
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["dblclick", onDoubleClick as EventListener],
    ["keydown", onKeyDown as EventListener],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });

  return {
    /** Lo que dibuja la capa de superposición, o `null` si la herramienta no está activa. */
    scene(): GradientScene | null {
      if (!isActive()) return null;
      const lines: GradientScene["lines"][number][] = [];
      const handles: GradientHandle[] = [];
      const stops: GradientScene["stops"][number][] = [];
      for (const frame of frames()) {
        const stroke = frame.property === "stroke";
        lines.push({
          from: applyToPoint(frame.toScreen, frame.from),
          to: applyToPoint(frame.toScreen, frame.to),
          stroke,
        });
        handles.push(...handlesOf(frame));
        stopPoints(frame).forEach((at, i) => {
          stops.push({
            at,
            color: frame.read.stops[i]?.color ?? "#000000",
            selected: selected?.property === frame.property && selected.index === i,
            stroke,
          });
        });
      }
      return { lines, handles, stops };
    },
    /** Cancela un arrastre a medias (al cambiar de herramienta). */
    finish() {
      if (press) finish(true);
    },
    dispose() {
      for (const [type, listener] of listeners) {
        target.removeEventListener(type, listener, { capture: true });
      }
    },
  };
}
