import { rectFromCorners, type Point, type Rect } from "../geometry";
import type { Viewport } from "../viewport";
import type { ToolName } from "../bridge";
import { isPressed } from "./modifiers";

/** Distancia en píxeles a partir de la cual pulsar y mover es un arrastre y no un clic. */
const DRAG_THRESHOLD = 3;

/** Atajos de teclado de las herramientas, sin modificadores, con el lienzo enfocado. */
const TOOL_KEYS: Readonly<Record<string, ToolName>> = { v: "select", h: "hand", z: "zoom" };

export interface NavigationHost {
  /** Viewport del documento visible, o `null` si no hay ninguno. */
  viewport(): Viewport | null;
  /** Herramienta activa. */
  tool(): ToolName;
  /** Cambia la herramienta desde el lienzo (atajo de teclado). */
  setTool(tool: ToolName): void;
  /** Muestra u oculta el rectángulo de la herramienta Zoom (coordenadas de pantalla). */
  showMarquee(marquee: Rect | null): void;
}

type Gesture =
  | { readonly kind: "pan"; last: Point }
  | { readonly kind: "zoom"; readonly start: Point; readonly out: boolean; marquee: Rect | null }
  | { readonly kind: "pinch"; last: { distance: number; center: Point } };

/** Normaliza el desplazamiento de la rueda a píxeles. */
function wheelPixels(event: WheelEvent): { dx: number; dy: number } {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

/**
 * Navegación por el lienzo: zoom y desplazamiento.
 *
 * - `Ctrl`+rueda (y el pellizco del panel táctil, que llega igual) acerca o aleja manteniendo fijo
 *   el punto bajo el puntero. La rueda sola desplaza; con `Mayús`, en horizontal.
 * - Pellizco con dos dedos en pantallas táctiles: zoom y desplazamiento a la vez.
 * - Arrastrar con la barra espaciadora pulsada, con el botón central o con la herramienta Mano
 *   desplaza el lienzo.
 * - Herramienta Zoom: clic acerca, `Alt`+clic aleja y arrastrar acerca hasta el rectángulo.
 * - `V`, `H` y `Z` cambian a Selección, Mano y Zoom.
 *
 * Escucha en la fase de captura de la ventana: cuando un gesto es de navegación, la herramienta
 * activa (Selección) no lo recibe.
 */
export function installNavigation(target: Window, host: NavigationHost): () => void {
  const page = target.document;
  let gesture: Gesture | null = null;
  let spaceDown = false;
  const touches = new Map<number, Point>();

  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const updateCursor = (altKey = false) => {
    const tool = host.tool();
    let cursor = "";
    if (gesture?.kind === "pan") cursor = "grabbing";
    else if (spaceDown || tool === "hand") cursor = "grab";
    else if (tool === "zoom") cursor = altKey ? "zoom-out" : "zoom-in";
    if (cursor) page.body.dataset.cursor = cursor;
    else delete page.body.dataset.cursor;
  };

  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const pinchState = () => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return null;
    return { distance: distance(a, b), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onWheel = (event: WheelEvent) => {
    const viewport = host.viewport();
    if (!viewport) return;
    event.preventDefault();
    const { dx, dy } = wheelPixels(event);
    // El pellizco del panel táctil llega como rueda con ctrlKey.
    if (event.ctrlKey || isPressed(event, "Control") || event.metaKey) {
      viewport.zoomBy(Math.exp(-dy * 0.002), point(event));
    } else if (isPressed(event, "Shift") && dx === 0) {
      viewport.panBy(-dy, 0);
    } else {
      viewport.panBy(-dx, -dy);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    const viewport = host.viewport();
    if (!viewport) return;

    if (event.pointerType === "touch") {
      touches.set(event.pointerId, point(event));
      if (touches.size === 2) {
        // El segundo dedo convierte el gesto en un pellizco: se cancela lo que hubiera empezado el
        // primero (por ejemplo, un marco de selección).
        page.dispatchEvent(new PointerEvent("pointercancel", { pointerId: -1 }));
        const state = pinchState();
        if (state) gesture = { kind: "pinch", last: state };
        consume(event);
        return;
      }
    }

    const tool = host.tool();
    const pan = event.button === 1 || (event.button === 0 && (spaceDown || tool === "hand"));
    if (pan) {
      gesture = { kind: "pan", last: point(event) };
    } else if (event.button === 0 && tool === "zoom") {
      gesture = { kind: "zoom", start: point(event), out: isPressed(event, "Alt"), marquee: null };
    } else {
      return;
    }
    page.documentElement.setPointerCapture(event.pointerId);
    updateCursor(isPressed(event, "Alt"));
    consume(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, point(event));
    }
    if (!gesture) {
      if (host.tool() === "zoom") updateCursor(isPressed(event, "Alt"));
      return;
    }
    const viewport = host.viewport();
    if (!viewport) return;
    switch (gesture.kind) {
      case "pan": {
        const current = point(event);
        viewport.panBy(current.x - gesture.last.x, current.y - gesture.last.y);
        gesture.last = current;
        break;
      }
      case "zoom":
        if (!gesture.marquee && distance(gesture.start, point(event)) <= DRAG_THRESHOLD) break;
        gesture.marquee = rectFromCorners(gesture.start, point(event));
        host.showMarquee(gesture.marquee);
        break;
      case "pinch": {
        const state = pinchState();
        if (!state) break;
        if (gesture.last.distance > 0) {
          viewport.zoomBy(state.distance / gesture.last.distance, state.center);
        }
        viewport.panBy(
          state.center.x - gesture.last.center.x,
          state.center.y - gesture.last.center.y,
        );
        gesture.last = state;
        break;
      }
    }
    consume(event);
  };

  const onPointerUp = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    const current = gesture;
    if (!current) return;
    if (current.kind === "pinch") {
      // El gesto termina cuando se levanta el primero de los dos dedos.
      gesture = null;
      consume(event);
      return;
    }
    gesture = null;
    const viewport = host.viewport();
    if (current.kind === "zoom" && viewport) {
      host.showMarquee(null);
      if (current.marquee) viewport.zoomToRect(current.marquee);
      else if (current.out) viewport.zoomOut(point(event));
      else viewport.zoomIn(point(event));
    }
    updateCursor(isPressed(event, "Alt"));
    consume(event);
  };

  const onPointerCancel = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (gesture?.kind === "zoom") host.showMarquee(null);
    gesture = null;
    updateCursor();
  };

  const onDoubleClick = (event: MouseEvent) => {
    // Con otra herramienta o con la barra espaciadora, el doble clic no entra en grupos.
    if (spaceDown || host.tool() !== "select") consume(event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === " ") {
      if (!event.repeat) {
        spaceDown = true;
        updateCursor();
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Alt") updateCursor(true);
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
    const tool = TOOL_KEYS[event.key.toLowerCase()];
    if (tool && host.viewport()) {
      host.setTool(tool);
      updateCursor();
      event.preventDefault();
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " ") {
      spaceDown = false;
      updateCursor();
    }
    if (event.key === "Alt") updateCursor(false);
  };

  const onBlur = () => {
    spaceDown = false;
    updateCursor();
  };

  const listeners: [string, EventListener, AddEventListenerOptions][] = [
    ["wheel", onWheel as EventListener, { capture: true, passive: false }],
    ["pointerdown", onPointerDown as EventListener, { capture: true }],
    ["pointermove", onPointerMove as EventListener, { capture: true }],
    ["pointerup", onPointerUp as EventListener, { capture: true }],
    ["pointercancel", onPointerCancel as EventListener, { capture: true }],
    ["dblclick", onDoubleClick as EventListener, { capture: true }],
    ["keydown", onKeyDown as EventListener, { capture: true }],
    ["keyup", onKeyUp as EventListener, { capture: true }],
    ["blur", onBlur, { capture: true }],
  ];
  for (const [type, listener, options] of listeners)
    target.addEventListener(type, listener, options);
  return () => {
    for (const [type, listener, options] of listeners) {
      target.removeEventListener(type, listener, options);
    }
    delete page.body.dataset.cursor;
  };
}

/** Exportado para que la herramienta activa refleje su cursor al cambiar desde la aplicación. */
export function cursorForTool(tool: ToolName): string {
  return tool === "hand" ? "grab" : tool === "zoom" ? "zoom-in" : "";
}
