import type { ToolName } from "../bridge";
import { applyToPoint, invert, snapToGrid, type Point } from "../geometry";
import type { History } from "../history";
import { screenToRoot, type Selection } from "../selection";
import { elementToRoot, formatNumber } from "../transform";
import { isPressed } from "./modifiers";
import { shapeForTool } from "./shapeRegistry";
import type { ShapeKind, ShapeStyle } from "./shapes";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Distancia en píxeles a partir de la cual pulsar y mover empieza a dibujar. */
const DRAG_THRESHOLD = 3;

/** Estilo de las formas mientras no se haya usado ninguno. */
export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 1,
};

export interface ShapeToolHost {
  tool(): ToolName;
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  /** Separación de la cuadrícula en unidades del documento si está activo el ajuste, o `null`. */
  snapSpacing(): number | null;
  style(): ShapeStyle;
}

interface Press {
  readonly kind: ShapeKind;
  readonly root: SVGSVGElement;
  readonly history: History;
  readonly selection: Selection;
  /** Grupo donde se crea la forma: el grupo en el que se ha entrado, o el documento. */
  readonly parent: Element;
  /** Del documento (viewBox) a las coordenadas del grupo. */
  readonly toParent: (p: Point) => Point;
  readonly startScreen: Point;
  /** Punto inicial en coordenadas del documento, ya ajustado a la cuadrícula. */
  readonly start: Point;
  /** Último puntero, para rehacer la forma si cambian las teclas sin mover el ratón. */
  last: { readonly screen: Point; readonly shift: boolean; readonly alt: boolean };
  element: Element | null;
}

/**
 * Herramientas de forma (rectángulo, elipse, línea, polígono, estrella): arrastrar dibuja la forma, `Mayús` mantiene la proporción y
 * `Alt` dibuja desde el centro; las teclas se pueden pulsar y soltar durante el arrastre. `Esc` lo
 * cancela. La forma nace con el último estilo usado, dentro del grupo en el que se ha entrado, queda
 * seleccionada y es un solo paso del historial. Un clic sin arrastrar no crea nada.
 *
 * Mientras la herramienta está activa, el lienzo no atiende a la herramienta Selección.
 */
export function installShapeTool(target: Window, host: ShapeToolHost): () => void {
  const page = target.document;
  let press: Press | null = null;

  const shapeTool = () => shapeForTool(host.tool());
  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  /** Punto de la pantalla en coordenadas del documento, ajustado a la cuadrícula si está activa. */
  const toDocument = (screen: Point, root: SVGSVGElement): Point | null => {
    const point = screenToRoot(screen, root);
    if (!point) return null;
    const spacing = host.snapSpacing();
    return spacing ? snapToGrid(point, spacing) : point;
  };

  const draw = (current: Press) => {
    const end = toDocument(current.last.screen, current.root);
    if (!end) return;
    const drag = {
      start: current.toParent(current.start),
      end: current.toParent(end),
      proportional: current.last.shift,
      fromCenter: current.last.alt,
    };
    const tag = current.kind.tagFor(drag);
    if (!current.element) {
      current.history.begin(current.kind.action);
      current.element = createShape(page, tag, current.kind, host.style());
      current.parent.append(current.element);
    } else if (current.element.localName !== tag) {
      // Elipse o círculo según Mayús: se cambia el elemento, con el mismo estilo.
      const replacement = createShape(page, tag, current.kind, host.style());
      current.element.replaceWith(replacement);
      current.element = replacement;
    }
    current.kind.apply(current.element, drag);
  };

  const onPointerDown = (event: PointerEvent) => {
    const kind = shapeTool();
    if (!kind) return;
    consume(event);
    const active = host.active();
    if (event.button !== 0 || !active || press) return;
    const { root, selection, history } = active;
    const screen = { x: event.clientX, y: event.clientY };
    const start = toDocument(screen, root);
    const parent = selection.scope;
    const parentToRoot = parent === root ? null : elementToRoot(parent, root);
    const rootToParent = parentToRoot ? invert(parentToRoot) : null;
    if (!start || (parentToRoot && !rootToParent)) return;
    press = {
      kind,
      root,
      history,
      selection,
      parent,
      toParent: (p) => (rootToParent ? applyToPoint(rootToParent, p) : p),
      startScreen: screen,
      start,
      last: { screen, shift: isPressed(event, "Shift"), alt: isPressed(event, "Alt") },
      element: null,
    };
    // El arrastre sigue aunque el puntero salga del lienzo.
    page.documentElement.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!shapeTool()) return;
    // Sin la herramienta Selección: ni manejadores ni su cursor.
    event.stopImmediatePropagation();
    if (!press) return;
    const screen = { x: event.clientX, y: event.clientY };
    press.last = { screen, shift: isPressed(event, "Shift"), alt: isPressed(event, "Alt") };
    const moved = Math.hypot(screen.x - press.startScreen.x, screen.y - press.startScreen.y);
    if (!press.element && moved <= DRAG_THRESHOLD) return;
    draw(press);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!shapeTool() && !press) return;
    consume(event);
    if (!press) return;
    // La posición final llega siempre con el pointerup, aunque se hayan perdido movimientos.
    onPointerMove(event);
    const current = press;
    press = null;
    const { element } = current;
    if (!element) return;
    const end = toDocument(current.last.screen, current.root);
    const empty =
      !end ||
      current.kind.isEmpty({
        start: current.toParent(current.start),
        end: current.toParent(end),
        proportional: current.last.shift,
        fromCenter: current.last.alt,
      });
    if (empty) {
      current.history.rollback();
      return;
    }
    current.history.commit();
    current.selection.set([element], current.parent);
  };

  const cancel = () => {
    if (press?.element) press.history.rollback();
    press = null;
  };

  const onKey = (event: KeyboardEvent) => {
    if (!press) return;
    if (event.type === "keydown" && event.key === "Escape") {
      cancel();
      consume(event);
      return;
    }
    // Teclas propias de la forma (las flechas cambian los lados de un polígono).
    if (event.type === "keydown" && press.kind.adjust?.(event.key)) {
      if (press.element) draw(press);
      consume(event);
      return;
    }
    // Mayús y Alt cambian la forma aunque el ratón no se mueva.
    if ((event.key === "Shift" || event.key === "Alt") && press.element) {
      press.last = { ...press.last, shift: event.shiftKey, alt: event.altKey };
      draw(press);
      // Alt solo no debe llevar el foco al menú de la ventana.
      if (event.key === "Alt") event.preventDefault();
    }
  };

  const onClick = (event: MouseEvent) => {
    // Con una herramienta de forma, el clic y el doble clic no seleccionan ni entran en grupos.
    if (shapeTool()) consume(event);
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["pointercancel", cancel],
    ["click", onClick as EventListener],
    ["dblclick", onClick as EventListener],
    ["keydown", onKey as EventListener],
    ["keyup", onKey as EventListener],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });
  return () => {
    cancel();
    for (const [type, listener] of listeners) {
      target.removeEventListener(type, listener, { capture: true });
    }
  };
}

/** Crea el elemento de una forma con el estilo dado, como atributos de presentación. */
export function createShape(
  page: Document,
  tag: string,
  kind: ShapeKind,
  style: ShapeStyle,
): Element {
  const element = page.createElementNS(SVG_NS, tag);
  const paint = kind.paint?.(style) ?? {
    fill: style.fill,
    stroke: style.stroke,
    "stroke-width": formatNumber(style.strokeWidth),
  };
  for (const [name, value] of Object.entries(paint)) element.setAttribute(name, value);
  return element;
}
