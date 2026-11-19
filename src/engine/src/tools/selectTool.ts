import { containsRect, rectFromCorners, type Point, type Rect } from "../geometry";
import {
  isContainer,
  pickAt,
  screenBounds,
  selectableChildren,
  type Selection,
} from "../selection";
import { isPressed } from "./modifiers";

/** Distancia en píxeles a partir de la cual pulsar y mover es un arrastre y no un clic. */
const DRAG_THRESHOLD = 3;

/** Lo que la herramienta necesita del motor. */
export interface SelectToolHost {
  /** Documento visible con su selección, o `null` si no hay ninguno. */
  active(): { readonly root: SVGSVGElement; readonly selection: Selection } | null;
  /** Muestra u oculta el marco de selección (coordenadas de pantalla). */
  showMarquee(marquee: Rect | null): void;
}

type Press =
  | {
      /** Pulsación sobre un objeto ya seleccionado: al soltar sin mover, queda solo él. */
      readonly kind: "item";
      readonly start: Point;
      readonly element: Element;
      readonly scope: Element;
      moved: boolean;
    }
  | {
      /** Pulsación sobre el fondo: arrastrar dibuja un marco; soltar sin mover deselecciona. */
      readonly kind: "marquee";
      readonly start: Point;
      readonly additive: boolean;
      marquee: Rect | null;
    };

/**
 * Herramienta Selección.
 *
 * - Clic: selecciona el objeto del grupo actual bajo el puntero (en un SVG exportado, la capa o el
 *   grupo). `Ctrl`+clic selecciona el elemento más profundo; `Mayús`+clic lo añade o lo quita.
 * - Doble clic sobre un grupo: entra en él. `Esc`: deselecciona y, si no hay nada seleccionado,
 *   sale del grupo.
 * - Arrastrar desde el fondo: selecciona los objetos que quedan enteros dentro del marco.
 * - `Ctrl+A`: selecciona todos los objetos del grupo actual.
 *
 * Devuelve una función que la desinstala.
 */
export function installSelectTool(target: Document, host: SelectToolHost): () => void {
  let press: Press | null = null;

  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (event: PointerEvent) => {
    const active = host.active();
    if (event.button !== 0 || !active) return;
    const { root, selection } = active;
    // El documento está en un shadow root: el destino real es el primero de composedPath().
    const pick = pickAt(event.composedPath()[0] ?? null, root, {
      scope: selection.scope,
      deep: isPressed(event, "Control") || isPressed(event, "Meta"),
    });

    const shift = isPressed(event, "Shift");
    if (!pick) {
      press = { kind: "marquee", start: point(event), additive: shift, marquee: null };
      // El arrastre sigue aunque el puntero salga del lienzo.
      target.documentElement.setPointerCapture(event.pointerId);
      return;
    }
    if (shift) {
      selection.toggle(pick.element, pick.scope);
    } else if (selection.items.includes(pick.element) && pick.scope === selection.scope) {
      // Se mantiene la selección múltiple por si el usuario arrastra para moverla (issue #28).
      press = { kind: "item", start: point(event), ...pick, moved: false };
    } else {
      selection.set([pick.element], pick.scope);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!press) return;
    if (press.kind === "item") {
      press.moved ||= distance(press.start, point(event)) > DRAG_THRESHOLD;
      return;
    }
    if (!press.marquee && distance(press.start, point(event)) <= DRAG_THRESHOLD) return;
    press.marquee = rectFromCorners(press.start, point(event));
    host.showMarquee(press.marquee);
  };

  const onPointerUp = () => {
    const current = press;
    press = null;
    const active = host.active();
    if (!current || !active) return;
    const { root, selection } = active;

    if (current.kind === "item") {
      if (!current.moved) selection.set([current.element], current.scope);
      return;
    }
    host.showMarquee(null);
    const { marquee } = current;
    if (!marquee) {
      // Clic en el fondo: deselecciona y vuelve al nivel superior.
      if (!current.additive) selection.set([], root);
      return;
    }
    const inside = selectableChildren(selection.scope).filter((element) => {
      const bounds = screenBounds(element);
      return bounds !== null && containsRect(marquee, bounds);
    });
    if (current.additive) selection.add(inside);
    else selection.set(inside);
  };

  const onDoubleClick = (event: MouseEvent) => {
    const active = host.active();
    if (event.button !== 0 || !active) return;
    const { root, selection } = active;
    const path = event.composedPath()[0] ?? null;
    const pick = pickAt(path, root, { scope: selection.scope });
    if (!pick || !isContainer(pick.element)) return;
    selection.enter(pick.element);
    const inner = pickAt(path, root, { scope: pick.element });
    if (inner) selection.set([inner.element], inner.scope);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const active = host.active();
    if (!active) return;
    if (event.key === "Escape") {
      if (press?.kind === "marquee") {
        press = null;
        host.showMarquee(null);
      } else {
        active.selection.escape();
      }
      event.preventDefault();
    } else if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
      // La aplicación también envía selection.selectAll desde su menú; seleccionar todo dos veces
      // no cambia nada.
      active.selection.selectAll();
      event.preventDefault();
    }
  };

  const onPointerCancel = () => {
    if (press?.kind === "marquee") host.showMarquee(null);
    press = null;
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerCancel);
  target.addEventListener("dblclick", onDoubleClick);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerCancel);
    target.removeEventListener("dblclick", onDoubleClick);
    target.removeEventListener("keydown", onKeyDown);
  };
}
