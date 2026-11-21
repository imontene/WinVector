import type { ToolName } from "../bridge";
import { applyToPoint, invert, snapToGrid, type Matrix, type Point } from "../geometry";
import type { History } from "../history";
import { parsePath, serializePath, type PathData } from "../paths";
import type { Selection } from "../selection";
import { elementToRoot, formatNumber } from "../transform";
import { isPressed } from "./modifiers";
import {
  anchorsToSubpath,
  hasCurves,
  polylineSubpath,
  reverseAnchors,
  subpathToAnchors,
  type Anchor,
} from "./penPath";
import { LINE, snapAngle, type ShapeStyle } from "./shapes";
import { writeVertices } from "./vertices";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Distancia en píxeles al primer nodo para cerrar la forma, o a un extremo para continuarla. */
const CLOSE_DISTANCE = 6;
/** Dos clics a menos de esta distancia (los del doble clic) son el mismo nodo. */
const SAME_POINT = 3;
/** Píxeles que hay que mover el puntero con el botón pulsado para sacar los manejadores. */
const DRAG_THRESHOLD = 3;

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

/** Lo que dibuja la capa de superposición mientras se dibuja, en pantalla. */
export interface PenScene {
  /** El primer nodo, y si un clic cerraría la forma. */
  readonly start: Point;
  readonly closing: boolean;
  /** Manejadores del último nodo (y del primero al cerrar arrastrando): del nodo al control. */
  readonly handles?: readonly { readonly from: Point; readonly to: Point }[];
}

/** Trazado abierto que se sigue dibujando desde uno de sus extremos. */
interface Continuation {
  readonly element: Element;
  readonly data: PathData;
  readonly subpath: number;
  /** Se empezó por el principio: los nodos van al revés mientras se dibuja. */
  readonly reversed: boolean;
}

interface Drawing {
  readonly root: SVGSVGElement;
  readonly history: History;
  readonly selection: Selection;
  /** Donde va la forma nueva y el elemento cuyas coordenadas se usan. */
  readonly parent: Element;
  readonly space: Element;
  /** De la pantalla a esas coordenadas, y al revés. */
  readonly toParent: Matrix;
  readonly toScreen: Matrix;
  /** Trazado de vista previa: los segmentos nuevos y el que sigue al puntero. */
  readonly preview: Element;
  readonly anchors: Anchor[];
  /** Nodos que ya tenía el trazado que se continúa: Retroceso no los quita. */
  readonly fixed: number;
  readonly continuation: Continuation | null;
  pointer: Point | null;
  closing: boolean;
  /** Botón pulsado sobre un nodo: arrastrar saca sus manejadores. */
  press: {
    readonly anchor: number;
    readonly start: Point;
    dragged: boolean;
    readonly closing: boolean;
  } | null;
}

const toMatrix = (m: DOMMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
const mirror = (p: Point, about: Point): Point => ({ x: 2 * about.x - p.x, y: 2 * about.y - p.y });

/**
 * Pluma (atajo `P`): formas libres de rectas (issue #62) y de curvas Bézier (issue #78).
 *
 * - Clic: un nodo de esquina. Arrastrar: un nodo suave, con el manejador que sale bajo el puntero y
 *   el que llega reflejado. Con `Alt` solo se mueve el que sale (nodo de esquina con curvas); con
 *   `Mayús`, el manejador gira de 15° en 15°. `Mayús` al hacer clic fija el ángulo del segmento.
 * - Clic en el primer nodo cierra la forma; arrastrando desde él se curva el último segmento.
 * - Doble clic o `Intro`: la termina abierta. `Retroceso` quita el último nodo; `Esc` lo cancela todo.
 * - Empezar en un extremo del trazado o la polilínea seleccionados los continúa.
 *
 * Sin curvas, la forma es un `<polygon>` (cerrada, con el último estilo usado) o una `<polyline>`
 * (abierta, con trazo y sin relleno); con curvas, un `<path>`. Es un solo paso del historial y queda
 * seleccionada. Con la cuadrícula activa, los nodos se ajustan a ella.
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
  const near = (a: Point, b: Point, distance: number) =>
    Math.hypot(a.x - b.x, a.y - b.y) <= distance;

  /** Punto de la pantalla en las coordenadas del dibujo, con Mayús (ángulo) y la cuadrícula. */
  const place = (current: Drawing, screen: Point, shift: boolean): Point => {
    let p = applyToPoint(current.toParent, screen);
    const last = current.anchors.at(-1)?.p;
    if (shift && last) p = snapAngle(last, p);
    const spacing = host.snapSpacing();
    if (spacing && !shift) {
      const toRoot =
        current.space === current.root ? null : elementToRoot(current.space, current.root);
      const fromRoot = toRoot ? invert(toRoot) : null;
      const rootPoint = toRoot ? applyToPoint(toRoot, p) : p;
      const snapped = snapToGrid(rootPoint, spacing);
      p = fromRoot ? applyToPoint(fromRoot, snapped) : snapped;
    }
    return p;
  };

  const screenOf = (current: Drawing, p: Point) => applyToPoint(current.toScreen, p);

  /** Se puede cerrar: con tres nodos, o con dos si hay curvas. */
  const canClose = (current: Drawing) =>
    current.anchors.length >= 3 ||
    (current.anchors.length === 2 && hasCurves(current.anchors, true));

  const nearFirst = (current: Drawing, screen: Point) => {
    const first = current.anchors[0];
    return (
      first !== undefined &&
      canClose(current) &&
      near(screenOf(current, first.p), screen, CLOSE_DISTANCE)
    );
  };

  const redraw = (current: Drawing) => {
    // Al continuar un trazado, la vista previa empieza en el extremo: lo de antes ya se ve.
    const anchors = current.anchors.slice(Math.max(0, current.fixed - 1));
    const first = current.anchors[0];
    if (current.closing && first) anchors.push({ p: first.p, in: first.in, out: null });
    else if (current.pointer && !current.press)
      anchors.push({ p: current.pointer, in: null, out: null });
    const only = anchors[0];
    const shown = anchors.length === 1 && only ? [only, { ...only }] : anchors;
    current.preview.setAttribute("d", serializePath([anchorsToSubpath(shown, false)]));
    host.changed();
  };

  const begin = (
    action: string,
    parent: Element,
    space: Element,
    anchors: Anchor[],
    continuation: Continuation | null,
  ): Drawing | null => {
    const active = host.active();
    const ctm = space instanceof SVGGraphicsElement ? space.getScreenCTM() : null;
    const toScreen = ctm ? toMatrix(ctm) : null;
    const toParent = toScreen ? invert(toScreen) : null;
    if (!active || !toScreen || !toParent) return null;
    active.history.begin(action);
    const preview = page.createElementNS(SVG_NS, "path");
    for (const [name, value] of Object.entries(paintOf(host.style(), false)))
      preview.setAttribute(name, value);
    // La vista previa de un trazado que se continúa está en sus coordenadas.
    const transform = space !== parent ? space.getAttribute("transform") : null;
    if (transform) preview.setAttribute("transform", transform);
    parent.append(preview);
    return {
      root: active.root,
      history: active.history,
      selection: active.selection,
      parent,
      space,
      toParent,
      toScreen,
      preview,
      anchors,
      fixed: anchors.length,
      continuation,
      pointer: null,
      closing: false,
      press: null,
    };
  };

  /** Extremo del trazado o la polilínea seleccionados bajo el puntero, para continuarlos. */
  const continuationAt = (screen: Point): Continuation | null => {
    const active = host.active();
    const items = active?.selection.items ?? [];
    const [element] = items;
    if (items.length !== 1 || !(element instanceof SVGGraphicsElement)) return null;
    let data: PathData;
    if (element instanceof SVGPolylineElement) {
      data = polylineSubpath(Array.from(element.points, (p) => ({ x: p.x, y: p.y })));
    } else if (element instanceof SVGPathElement) {
      data = parsePath(element.getAttribute("d") ?? "").data;
    } else {
      return null;
    }
    const ctm = element.getScreenCTM();
    if (!ctm) return null;
    const m = toMatrix(ctm);
    for (const [index, subpath] of data.entries()) {
      const last = subpath.segments.at(-1);
      if (subpath.closed || !last) continue;
      if (near(applyToPoint(m, last.to), screen, CLOSE_DISTANCE)) {
        return { element, data, subpath: index, reversed: false };
      }
      if (near(applyToPoint(m, subpath.start), screen, CLOSE_DISTANCE)) {
        return { element, data, subpath: index, reversed: true };
      }
    }
    return null;
  };

  const start = (screen: Point, shift: boolean) => {
    const continuation = continuationAt(screen);
    if (continuation) {
      const subpath = continuation.data[continuation.subpath];
      const parent = continuation.element.parentElement;
      if (!subpath || !parent) return;
      const anchors = subpathToAnchors(subpath);
      drawing = begin(
        "continue-path",
        parent,
        continuation.element,
        continuation.reversed ? reverseAnchors(anchors) : anchors,
        continuation,
      );
      if (drawing)
        drawing.press = {
          anchor: drawing.anchors.length - 1,
          start: screen,
          dragged: false,
          closing: false,
        };
      return;
    }
    const active = host.active();
    if (!active) return;
    const scope = active.selection.scope;
    drawing = begin("create-polyline", scope, scope, [], null);
    if (drawing) add(drawing, screen, shift);
  };

  const add = (current: Drawing, screen: Point, shift: boolean) => {
    const p = place(current, screen, shift);
    current.anchors.push({ p, in: null, out: null });
    current.pointer = p;
    current.press = {
      anchor: current.anchors.length - 1,
      start: screen,
      dragged: false,
      closing: false,
    };
    redraw(current);
  };

  /** Arrastre con el botón pulsado: saca los manejadores del nodo. */
  const drag = (current: Drawing, event: PointerEvent) => {
    const press = current.press;
    if (!press) return;
    const screen = point(event);
    if (!press.dragged && !near(screen, press.start, DRAG_THRESHOLD)) press.dragged = true;
    if (!press.dragged) return;
    const anchor = current.anchors[press.anchor];
    if (!anchor) return;
    let handle = applyToPoint(current.toParent, screen);
    if (isPressed(event, "Shift")) handle = snapAngle(anchor.p, handle);
    if (press.closing) {
      // Cerrar arrastrando: el segmento que vuelve al primer nodo se curva.
      anchor.in = mirror(handle, anchor.p);
    } else {
      anchor.out = handle;
      // Con Alt, o en el extremo de un trazado que ya existía, el manejador que llega no se toca.
      const existing = press.anchor < current.fixed;
      if (!isPressed(event, "Alt") && !existing) anchor.in = mirror(handle, anchor.p);
    }
    redraw(current);
  };

  /**
   * Termina la forma: cerrada o abierta. La vista previa se anula y la forma final se crea (o el
   * trazado continuado se reescribe) en un paso propio, con el nombre de lo que es.
   */
  const finish = (closed: boolean) => {
    const current = drawing;
    if (!current) return;
    drawing = null;
    current.history.rollback();
    host.changed();
    const continuation = current.continuation;
    let anchors = current.anchors;
    if (anchors.length < 2 || (closed && !canClose(current))) return;
    if (continuation && !closed && anchors.length === current.fixed) return;
    if (continuation?.reversed) anchors = reverseAnchors(anchors);
    const subpath = anchorsToSubpath(anchors, closed);
    const curves = hasCurves(anchors, closed);

    if (continuation) {
      const data = continuation.data.map((s, i) => (i === continuation.subpath ? subpath : s));
      const tag =
        curves || data.length > 1 || continuation.element.localName === "path"
          ? "path"
          : closed
            ? "polygon"
            : "polyline";
      const element = current.history.transact("continue-path", () =>
        writeShape(continuation.element, tag, data, anchors),
      );
      if (element !== continuation.element) {
        current.selection.replace(
          [continuation.element],
          new Map([[continuation.element, element]]),
        );
      }
      current.selection.set([element], current.selection.scope);
      return;
    }

    const tag = curves ? "path" : closed ? "polygon" : "polyline";
    const action = curves ? "create-path" : closed ? "create-polygon" : "create-polyline";
    const element = current.history.transact(action, () => {
      const shape = page.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(paintOf(host.style(), closed)))
        shape.setAttribute(name, value);
      if (tag === "path") shape.setAttribute("d", serializePath([subpath]));
      else
        writeVertices(
          shape,
          anchors.map((anchor) => anchor.p),
        );
      current.parent.append(shape);
      return shape;
    });
    current.selection.set([element], current.parent);
  };

  /**
   * Escribe la geometría en el trazado continuado. Si cambia de tipo (una polilínea que se curva o
   * se cierra), lo sustituye por uno nuevo con los mismos atributos.
   */
  const writeShape = (element: Element, tag: string, data: PathData, anchors: Anchor[]) => {
    let shape = element;
    if (element.localName !== tag) {
      shape = page.createElementNS(SVG_NS, tag);
      for (const attribute of [...element.attributes]) {
        if (
          attribute.namespaceURI === null &&
          (attribute.name === "points" || attribute.name === "d")
        )
          continue;
        shape.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      }
      element.replaceWith(shape);
    }
    if (tag === "path") shape.setAttribute("d", serializePath(data));
    else
      writeVertices(
        shape,
        anchors.map((anchor) => anchor.p),
      );
    return shape;
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
    } else if (nearFirst(drawing, screen)) {
      drawing.press = { anchor: 0, start: screen, dragged: false, closing: true };
    } else {
      const last = drawing.anchors.at(-1);
      // El segundo clic de un doble clic cae en el mismo sitio: no es otro nodo.
      if (last && near(screenOf(drawing, last.p), screen, SAME_POINT)) return;
      add(drawing, screen, isPressed(event, "Shift"));
    }
    if (drawing?.press) target.document.documentElement.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isActive()) return;
    event.stopImmediatePropagation();
    if (!drawing) return;
    if (drawing.press) {
      drag(drawing, event);
      return;
    }
    const screen = point(event);
    drawing.closing = nearFirst(drawing, screen);
    drawing.pointer = place(drawing, screen, isPressed(event, "Shift"));
    redraw(drawing);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isActive()) return;
    consume(event);
    const press = drawing?.press;
    if (!drawing || !press) return;
    // En WebView2, los pointermove de un arrastre rápido pueden no llegar; el pointerup sí: su
    // posición también saca los manejadores.
    drag(drawing, event);
    drawing.press = null;
    if (press.closing) finish(true);
    else redraw(drawing);
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
      consume(event);
      if (drawing.press) return;
      if (drawing.anchors.length > drawing.fixed) drawing.anchors.pop();
      // Una forma nueva sin nodos se cancela. Al continuar un trazado se sigue en su extremo (y
      // Retroceso no llega a borrar el trazado seleccionado): Esc cancela.
      if (drawing.anchors.length === 0) cancel();
      else redraw(drawing);
    }
  };

  const onOther = (event: Event) => {
    if (isActive()) consume(event);
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["click", onOther],
    ["dblclick", onDoubleClick as EventListener],
    ["keydown", onKeyDown as EventListener],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });

  return {
    /** El primer nodo y los manejadores en pantalla mientras se dibuja, o `null`. */
    scene(): PenScene | null {
      const current = drawing;
      const first = current?.anchors[0];
      if (!current || !first) return null;
      const handles: { from: Point; to: Point }[] = [];
      const show = (anchor: Anchor | undefined, which: readonly ("in" | "out")[]) => {
        if (!anchor) return;
        for (const side of which) {
          const h = anchor[side];
          if (h && !near(h, anchor.p, 1e-9))
            handles.push({ from: screenOf(current, anchor.p), to: screenOf(current, h) });
        }
      };
      show(current.anchors.at(-1), ["in", "out"]);
      if (current.press?.closing) show(first, ["in"]);
      return {
        start: screenOf(current, first.p),
        closing: current.closing || !!current.press?.closing,
        handles,
      };
    },
    /** Al cambiar de herramienta: la forma a medias se termina abierta (si tiene dos nodos). */
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
