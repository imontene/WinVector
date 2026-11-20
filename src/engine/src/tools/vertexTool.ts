import type { ToolName } from "../bridge";
import {
  applyToPoint,
  invert,
  rectFromCorners,
  snapToGrid,
  type Matrix,
  type Point,
  type Rect,
} from "../geometry";
import type { History } from "../history";
import { pickAt, type Selection } from "../selection";
import { elementToRoot } from "../transform";
import { isPressed } from "./modifiers";
import { snapAngle } from "./shapes";
import {
  displayVertices,
  insertVertex,
  readVertices,
  removeVertices,
  segmentAt,
  toEditablePolygon,
  vertexEditKind,
  writeVertices,
  type VertexEditKind,
} from "./vertices";

/** Distancia en píxeles para acertar a un vértice o a un segmento, y para ajustar a otro vértice. */
const HIT_DISTANCE = 6;
/** Distancia en píxeles a partir de la cual pulsar y mover es un arrastre. */
const DRAG_THRESHOLD = 3;

export interface VertexToolHost {
  tool(): ToolName;
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  /** Separación de la cuadrícula en unidades del documento si está activo el ajuste, o `null`. */
  snapSpacing(): number | null;
  showMarquee(marquee: Rect | null): void;
  /** Ha cambiado lo que se dibuja (los vértices seleccionados). */
  changed(): void;
  /** Una forma ha pasado a ser un polígono normal al editar sus vértices. */
  converted(from: Exclude<VertexEditKind, "direct">): void;
}

/** Lo que dibuja la capa de superposición: los vértices en pantalla y cuáles están seleccionados. */
export interface VertexScene {
  readonly points: readonly Point[];
  readonly selected: readonly boolean[];
}

type Press =
  | {
      readonly kind: "drag";
      readonly index: number;
      readonly start: Point;
      started: boolean;
      element: Element;
      toLocal: Matrix;
      original: Point[];
    }
  | {
      readonly kind: "marquee";
      readonly start: Point;
      readonly additive: boolean;
      rect: Rect | null;
    };

const toMatrix = (m: DOMMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });

/**
 * Herramienta Vértices (atajo `A`): edita los vértices de polígonos, polilíneas, líneas, estrellas y
 * rectángulos (estos dos pasan a ser polígonos normales al editarlos).
 *
 * - Clic en un vértice lo selecciona (`Mayús`: lo añade o lo quita); arrastrar desde el fondo
 *   selecciona los vértices que quedan dentro del marco. Clic en otra forma la elige.
 * - Arrastrar mueve los vértices seleccionados (`Mayús`: en horizontal, vertical o a 45°), con ajuste
 *   a la cuadrícula y a los demás vértices. Las flechas los mueven 1 unidad (10 con `Mayús`).
 * - Doble clic en un segmento añade un vértice; `Supr` quita los seleccionados sin bajar del mínimo.
 * - `Esc` cancela el arrastre o deselecciona los vértices.
 *
 * Cada edición es un paso del historial. Pensada para que la herramienta de nodos de la Fase 3 la
 * amplíe con los manejadores de las curvas.
 */
export function installVertexTool(target: Window, host: VertexToolHost) {
  let selected = new Set<number>();
  let shape: Element | null = null;
  let press: Press | null = null;

  const isActive = () => host.tool() === "vertex";
  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });

  /** La forma que se edita: la única seleccionada, si se puede editar por vértices. */
  const current = () => {
    const active = host.active();
    const [only] = active?.selection.items ?? [];
    const element =
      active && only && active.selection.items.length === 1 && vertexEditKind(only) ? only : null;
    if (element !== shape) {
      shape = element;
      selected = new Set();
    }
    return active && element ? { ...active, element } : null;
  };

  /** Vértices de la forma en pantalla. */
  const screenVertices = (element: Element): Point[] => {
    const vertices = displayVertices(element);
    const ctm = element instanceof SVGGraphicsElement ? element.getScreenCTM() : null;
    if (!vertices || !ctm) return [];
    const m = toMatrix(ctm);
    return vertices.points.map((p) => applyToPoint(m, p));
  };

  const vertexAt = (element: Element, p: Point) =>
    screenVertices(element).findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y) <= HIT_DISTANCE);

  /**
   * Prepara la forma para editarla (un rectángulo o una estrella pasan a ser polígonos) dentro del
   * paso del historial ya empezado. Devuelve el elemento editable.
   */
  const editable = (element: Element, selection: Selection): Element | null => {
    const kind = vertexEditKind(element);
    const result = toEditablePolygon(element);
    if (!result) return null;
    if (result !== element) selection.replace([element], new Map([[element, result]]));
    if (kind && kind !== "direct") host.converted(kind);
    shape = result;
    return result;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isActive()) return;
    consume(event);
    if (event.button !== 0 || press) return;
    const editing = current();
    const p = point(event);
    const index = editing ? vertexAt(editing.element, p) : -1;
    if (editing && index !== -1) {
      if (isPressed(event, "Shift")) {
        if (selected.has(index)) selected.delete(index);
        else selected.add(index);
        host.changed();
        if (!selected.has(index)) return;
      } else if (!selected.has(index)) {
        selected = new Set([index]);
        host.changed();
      }
      const ctm =
        editing.element instanceof SVGGraphicsElement ? editing.element.getScreenCTM() : null;
      const toLocal = ctm ? invert(toMatrix(ctm)) : null;
      if (!toLocal) return;
      press = {
        kind: "drag",
        index,
        start: p,
        started: false,
        element: editing.element,
        toLocal,
        original: [],
      };
      target.document.documentElement.setPointerCapture(event.pointerId);
      return;
    }

    // Otra forma editable: pasa a ser la que se edita.
    const active = host.active();
    if (!active) return;
    const pick = pickAt(event.composedPath()[0] ?? null, active.root, { deep: true });
    if (pick && pick.element !== editing?.element && vertexEditKind(pick.element)) {
      active.selection.set([pick.element], pick.element.parentElement ?? active.root);
      current();
      host.changed();
      return;
    }
    press = { kind: "marquee", start: p, additive: isPressed(event, "Shift"), rect: null };
    target.document.documentElement.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isActive() && !press) return;
    event.stopImmediatePropagation();
    if (!press) return;
    const p = point(event);
    if (press.kind === "marquee") {
      if (!press.rect && Math.hypot(p.x - press.start.x, p.y - press.start.y) <= DRAG_THRESHOLD)
        return;
      press.rect = rectFromCorners(press.start, p);
      host.showMarquee(press.rect);
      return;
    }
    const active = host.active();
    if (!active) return;
    if (!press.started) {
      if (Math.hypot(p.x - press.start.x, p.y - press.start.y) <= DRAG_THRESHOLD) return;
      active.history.begin("move-vertices");
      const element = editable(press.element, active.selection);
      const vertices = element ? readVertices(element) : null;
      if (!element || !vertices) {
        active.history.rollback();
        press = null;
        return;
      }
      press.started = true;
      press.element = element;
      press.original = vertices.points;
    }
    const startLocal = applyToPoint(press.toLocal, press.start);
    let delta = (() => {
      const local = applyToPoint(press.toLocal, p);
      return { x: local.x - startLocal.x, y: local.y - startLocal.y };
    })();
    if (isPressed(event, "Shift")) {
      const snapped = snapAngle({ x: 0, y: 0 }, delta, 45);
      delta = snapped;
    }
    const anchor = press.original[press.index];
    if (!anchor) return;
    let moved = { x: anchor.x + delta.x, y: anchor.y + delta.y };
    moved = snapVertex(press.element, moved, press.original, active.root);
    delta = { x: moved.x - anchor.x, y: moved.y - anchor.y };
    const points = press.original.map((v, i) =>
      selected.has(i) ? { x: v.x + delta.x, y: v.y + delta.y } : v,
    );
    writeVertices(press.element, points);
  };

  /** Ajusta un vértice a otro vértice cercano (que no se esté moviendo) o, si no, a la cuadrícula. */
  const snapVertex = (
    element: Element,
    p: Point,
    original: Point[],
    root: SVGSVGElement,
  ): Point => {
    const ctm = element instanceof SVGGraphicsElement ? element.getScreenCTM() : null;
    if (!ctm) return p;
    const m = toMatrix(ctm);
    const screen = applyToPoint(m, p);
    for (const [i, other] of original.entries()) {
      if (selected.has(i)) continue;
      const s = applyToPoint(m, other);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= HIT_DISTANCE) return other;
    }
    const spacing = host.snapSpacing();
    const toRoot = elementToRoot(element, root);
    const fromRoot = toRoot ? invert(toRoot) : null;
    if (!spacing || !toRoot || !fromRoot) return p;
    return applyToPoint(fromRoot, snapToGrid(applyToPoint(toRoot, p), spacing));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isActive() && !press) return;
    consume(event);
    if (!press) return;
    onPointerMove(event);
    const finished = press;
    press = null;
    const active = host.active();
    if (finished.kind === "drag") {
      if (finished.started) active?.history.commit();
      return;
    }
    host.showMarquee(null);
    const editing = current();
    if (!finished.rect) {
      // Clic en el fondo: deselecciona los vértices.
      if (!finished.additive && selected.size > 0) {
        selected = new Set();
        host.changed();
      }
      return;
    }
    const rect = finished.rect;
    const inside = editing
      ? screenVertices(editing.element)
          .map((v, i) => ({ v, i }))
          .filter(
            ({ v }) =>
              v.x >= rect.x &&
              v.x <= rect.x + rect.width &&
              v.y >= rect.y &&
              v.y <= rect.y + rect.height,
          )
          .map(({ i }) => i)
      : [];
    selected = finished.additive ? new Set([...selected, ...inside]) : new Set(inside);
    host.changed();
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (!isActive()) return;
    consume(event);
    const editing = current();
    if (!editing) return;
    const p = point(event);
    if (vertexAt(editing.element, p) !== -1) return;
    const ctm =
      editing.element instanceof SVGGraphicsElement ? editing.element.getScreenCTM() : null;
    const vertices = displayVertices(editing.element);
    if (!ctm || !vertices?.resizable) return;
    const m = toMatrix(ctm);
    const toLocal = invert(m);
    if (!toLocal) return;
    // La tolerancia se mide en pantalla: se pasa el punto y los vértices a pantalla.
    const onScreen = { ...vertices, points: vertices.points.map((v) => applyToPoint(m, v)) };
    const hit = segmentAt(onScreen, p, HIT_DISTANCE);
    if (!hit) return;
    editing.history.transact("add-vertex", () => {
      const element = editable(editing.element, editing.selection);
      const current = element ? readVertices(element) : null;
      if (!element || !current) return;
      writeVertices(
        element,
        insertVertex(current.points, hit.index, applyToPoint(toLocal, hit.point)),
      );
    });
    selected = new Set([hit.index + 1]);
    host.changed();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isActive()) return;
    if (event.key === "Escape") {
      if (press?.kind === "drag" && press.started) host.active()?.history.rollback();
      if (press?.kind === "marquee") host.showMarquee(null);
      if (press) {
        press = null;
        consume(event);
        return;
      }
      if (selected.size > 0) {
        selected = new Set();
        host.changed();
        consume(event);
      }
      return;
    }
    const editing = current();
    if (!editing || selected.size === 0 || press) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      consume(event);
      const vertices = displayVertices(editing.element);
      if (!vertices || !removeVertices(vertices, selected)) return;
      editing.history.transact("delete-vertices", () => {
        const element = editable(editing.element, editing.selection);
        const current = element ? readVertices(element) : null;
        const kept = current ? removeVertices(current, selected) : null;
        if (element && kept) writeVertices(element, kept);
      });
      selected = new Set();
      host.changed();
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow || event.ctrlKey || event.altKey || event.metaKey) return;
    consume(event);
    const step = event.shiftKey ? 10 : 1;
    editing.history.transact(
      "move-vertices",
      () => {
        const element = editable(editing.element, editing.selection);
        const current = element ? readVertices(element) : null;
        if (!element || !current) return;
        writeVertices(
          element,
          current.points.map((v, i) =>
            selected.has(i) ? { x: v.x + arrow.x * step, y: v.y + arrow.y * step } : v,
          ),
        );
      },
      "nudge-vertices",
    );
  };

  const onClick = (event: MouseEvent) => {
    if (isActive()) consume(event);
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["click", onClick as EventListener],
    ["dblclick", onDoubleClick as EventListener],
    ["keydown", onKeyDown as EventListener],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });

  return {
    /** Vértices que hay que dibujar, o `null` si la herramienta no está activa o no hay forma. */
    scene(): VertexScene | null {
      if (!isActive()) return null;
      const editing = current();
      if (!editing) return null;
      const points = screenVertices(editing.element);
      return { points, selected: points.map((_, i) => selected.has(i)) };
    },
    dispose() {
      for (const [type, listener] of listeners) {
        target.removeEventListener(type, listener, { capture: true });
      }
    },
  };
}

const ARROWS: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
