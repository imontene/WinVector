import { containsRect, rectFromCorners, type Point, type Rect } from "../geometry";
import type { History } from "../history";
import {
  handleAt,
  isContainer,
  pickAt,
  screenBounds,
  screenToRoot,
  selectableChildren,
  selectionBounds,
  selectionScreenRect,
  thinElementAt,
  type HandleId,
  type Selection,
} from "../selection";
import { moveBy, rotateAround, scaleAround, transformItems, TransformSession } from "../transform";
import { shapeHandleAt, shapeHandles, type HandleDrag } from "./shapeHandles";
import { isPressed } from "./modifiers";
import { vertexEditKind } from "./vertices";

/** Distancia en píxeles a partir de la cual pulsar y mover es un arrastre y no un clic. */
const DRAG_THRESHOLD = 3;
/** Paso del giro con Mayús, en grados. */
const ROTATE_STEP = 15;
/** Escala mínima al arrastrar un manejador, para que un objeto no desaparezca ni se invierta sin querer. */
const MIN_SCALE = 0.001;

/** Lo que la herramienta necesita del motor. */
export interface SelectToolHost {
  /** Documento visible con su selección y su historial, o `null` si no hay ninguno. */
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  /** Muestra u oculta el marco de selección (coordenadas de pantalla). */
  showMarquee(marquee: Rect | null): void;
  /** Separación de la cuadrícula en unidades del documento si está activo el ajuste, o `null`. */
  snapSpacing(): number | null;
  /** Doble clic en una forma de segmentos rectos: pasa a editar sus vértices. */
  editVertices?(element: Element): void;
  /** Doble clic en un texto: pasa a editarlo con la herramienta Texto, con el cursor en `at`. */
  editText?(text: SVGTextElement, at: Point): void;
}

type Press =
  | {
      /** Pulsación sobre un objeto: arrastrar lo mueve; soltar sin mover deja solo él seleccionado. */
      readonly kind: "item";
      readonly start: Point;
      readonly element: Element;
      readonly scope: Element;
      readonly bounds: Rect | null;
      session: TransformSession | null;
    }
  | {
      /** Pulsación sobre un manejador: escala o gira la selección. */
      readonly kind: "handle";
      readonly handle: HandleId;
      readonly start: Point;
      readonly bounds: Rect;
      session: TransformSession | null;
    }
  | {
      /** Pulsación sobre un manejador propio de la forma: radio de las esquinas, extremo de línea. */
      readonly kind: "shape";
      readonly drag: HandleDrag;
      readonly history: History;
    }
  | {
      /** Pulsación sobre el fondo: arrastrar dibuja un marco; soltar sin mover deselecciona. */
      readonly kind: "marquee";
      readonly start: Point;
      readonly additive: boolean;
      marquee: Rect | null;
    };

const snap = (value: number, spacing: number | null) =>
  spacing ? Math.round(value / spacing) * spacing : value;

/** Ángulo en grados del punto `p` visto desde `center` (positivo en el sentido de las agujas del reloj). */
const angle = (p: Point, center: Point) =>
  (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;

/**
 * Herramienta Selección.
 *
 * - Clic: selecciona el objeto del grupo actual bajo el puntero (en un SVG exportado, la capa o el
 *   grupo). `Ctrl`+clic selecciona el elemento más profundo; `Mayús`+clic lo añade o lo quita.
 * - Doble clic sobre un grupo: entra en él; sobre un polígono, una línea, una estrella o un
 *   rectángulo, pasa a editar sus vértices (herramienta Vértices). `Esc`: deselecciona y, si no hay nada seleccionado,
 *   sale del grupo. Durante un arrastre, `Esc` lo cancela.
 * - Arrastrar desde el fondo: selecciona los objetos que quedan enteros dentro del marco.
 * - `Ctrl+A`: selecciona todos los objetos del grupo actual.
 * - Arrastrar un objeto mueve la selección; las flechas la mueven 1 unidad (10 con `Mayús`).
 * - Los manejadores escalan (`Mayús`: proporcional; `Alt`: desde el centro) y el de arriba gira
 *   (`Mayús`: de 15° en 15°). Algunas formas tienen manejadores propios (ver
 *   shapeHandles.ts): el radio de las esquinas de un rectángulo, los extremos de una línea.
 *
 * Cada transformación es un paso del historial. Devuelve una función que desinstala la herramienta.
 */
export function installSelectTool(target: Document, host: SelectToolHost): () => void {
  let press: Press | null = null;

  const point = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const setHandleCursor = (value: string | null) => {
    if (value) target.body.dataset.handle = value;
    else delete target.body.dataset.handle;
  };

  const onPointerDown = (event: PointerEvent) => {
    const active = host.active();
    if (event.button !== 0 || !active) return;
    const { root, selection } = active;
    const shift = isPressed(event, "Shift");

    // Los manejadores tienen prioridad: están por encima de los objetos.
    const own = shapeHandles(selection.items);
    const ownIndex = own ? shapeHandleAt(own, point(event)) : -1;
    if (own && ownIndex !== -1) {
      event.preventDefault();
      active.history.begin(own.action);
      press = { kind: "shape", drag: own.start(ownIndex, point(event)), history: active.history };
      target.documentElement.setPointerCapture(event.pointerId);
      return;
    }
    const screenRect =
      selection.items.length > 0 && !own?.replacesBox
        ? selectionScreenRect(selection.items, root)
        : null;
    // Con Mayús también: es la tecla de escalar en proporción y de girar de 15 en 15 grados.
    const handle = screenRect ? handleAt(point(event), screenRect) : null;
    const bounds = selectionBounds(selection.items, root);
    if (handle && bounds) {
      event.preventDefault();
      press = { kind: "handle", handle, start: point(event), bounds, session: null };
      target.documentElement.setPointerCapture(event.pointerId);
      return;
    }

    // El documento está en un shadow root: el destino real es el primero de composedPath(). Una
    // línea fina cercana que esté por encima cuenta como tocada.
    const hit = event.composedPath()[0] ?? null;
    const pick = pickAt(thinElementAt(point(event), root, hit) ?? hit, root, {
      scope: selection.scope,
      deep: isPressed(event, "Control") || isPressed(event, "Meta"),
    });

    if (!pick) {
      press = { kind: "marquee", start: point(event), additive: shift, marquee: null };
      // El arrastre sigue aunque el puntero salga del lienzo.
      target.documentElement.setPointerCapture(event.pointerId);
      return;
    }
    if (shift) {
      selection.toggle(pick.element, pick.scope);
      return;
    }
    // Un objeto que no estaba seleccionado se selecciona y se puede arrastrar en el mismo gesto. En
    // una selección múltiple, arrastrar uno de sus objetos los mueve todos.
    if (!selection.items.includes(pick.element) || pick.scope !== selection.scope) {
      selection.set([pick.element], pick.scope);
    }
    press = {
      kind: "item",
      start: point(event),
      element: pick.element,
      scope: pick.scope,
      bounds: selectionBounds(selection.items, root),
      session: null,
    };
    // Sin capturar el puntero todavía: con la captura, el navegador enviaría el clic y el doble clic
    // al elemento que captura y no al objeto. Se captura al empezar a arrastrar. Sí se cancela la
    // acción por defecto, para que el navegador no empiece su propio gesto (que acabaría en
    // pointercancel); click y dblclick siguen llegando.
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent) => {
    const active = host.active();
    if (!press) {
      // Cursor sobre los manejadores.
      const own = active ? shapeHandles(active.selection.items) : null;
      if (own && shapeHandleAt(own, point(event)) !== -1) {
        setHandleCursor(own.cursor);
        return;
      }
      const rect =
        active && active.selection.items.length > 0 && !own?.replacesBox
          ? selectionScreenRect(active.selection.items, active.root)
          : null;
      setHandleCursor(rect ? handleAt(point(event), rect) : null);
      return;
    }
    if (press.kind === "shape") {
      press.drag.update(point(event), isPressed(event, "Shift"));
      return;
    }
    if (!active) return;
    const { root, selection, history } = active;

    if (press.kind === "marquee") {
      if (!press.marquee && distance(press.start, point(event)) <= DRAG_THRESHOLD) return;
      press.marquee = rectFromCorners(press.start, point(event));
      host.showMarquee(press.marquee);
      return;
    }

    if (!press.session && distance(press.start, point(event)) <= DRAG_THRESHOLD) return;
    if (!press.session && event.type === "pointermove") {
      // El arrastre sigue aunque el puntero salga del lienzo.
      try {
        target.documentElement.setPointerCapture(event.pointerId);
      } catch {
        // El puntero ya no está activo (por ejemplo, se soltó fuera de la ventana).
      }
    }
    const start = screenToRoot(press.start, root);
    const current = screenToRoot(point(event), root);
    if (!start || !current) return;

    if (press.kind === "item") {
      press.session ??= new TransformSession(selection.items, root, history, "move");
      setHandleCursor("move");
      let dx = current.x - start.x;
      let dy = current.y - start.y;
      if (isPressed(event, "Shift")) {
        // Con Mayús, solo en horizontal o en vertical.
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const spacing = host.snapSpacing();
      if (spacing && press.bounds) {
        // Se ajusta la esquina superior izquierda de la selección a la cuadrícula.
        dx = snap(press.bounds.x + dx, spacing) - press.bounds.x;
        dy = snap(press.bounds.y + dy, spacing) - press.bounds.y;
      }
      press.session.update(moveBy(dx, dy));
      return;
    }

    const { bounds, handle } = press;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    if (handle === "rotate") {
      press.session ??= new TransformSession(selection.items, root, history, "rotate");
      let degrees = angle(current, center) - angle(start, center);
      if (isPressed(event, "Shift")) degrees = Math.round(degrees / ROTATE_STEP) * ROTATE_STEP;
      press.session.update(rotateAround(degrees, center));
      return;
    }

    press.session ??= new TransformSession(selection.items, root, history, "scale");
    const fromCenter = isPressed(event, "Alt");
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    // Para cada eje: el punto fijo y el borde que se arrastra.
    const axis = (moving: number, opposite: number, value: number, middle: number) => {
      const anchor = fromCenter ? middle : opposite;
      const span = moving - anchor;
      return { anchor, factor: Math.abs(span) < 1e-9 ? 1 : (value - anchor) / span };
    };
    const horizontal = handle.includes("e")
      ? axis(right, left, current.x, center.x)
      : handle.includes("w")
        ? axis(left, right, current.x, center.x)
        : { anchor: center.x, factor: 1 };
    const vertical = handle.includes("s")
      ? axis(bottom, top, current.y, center.y)
      : handle.startsWith("n")
        ? axis(top, bottom, current.y, center.y)
        : { anchor: center.y, factor: 1 };
    let sx = horizontal.factor;
    let sy = vertical.factor;
    if (isPressed(event, "Shift")) {
      // Proporcional: manda el eje que más ha cambiado; en un lateral, el que se arrastra.
      const corner = handle.length === 2;
      const uniform = corner
        ? Math.max(Math.abs(sx), Math.abs(sy))
        : Math.abs(handle === "e" || handle === "w" ? sx : sy);
      sx = Math.sign(sx || 1) * uniform;
      sy = Math.sign(sy || 1) * uniform;
    }
    const clamp = (value: number) =>
      Math.abs(value) < MIN_SCALE ? Math.sign(value || 1) * MIN_SCALE : value;
    press.session.update(
      scaleAround(clamp(sx), clamp(sy), { x: horizontal.anchor, y: vertical.anchor }),
    );
  };

  const onPointerUp = (event: PointerEvent) => {
    // La posición final llega siempre con el pointerup, aunque se hayan perdido movimientos.
    onPointerMove(event);
    const current = press;
    press = null;
    const active = host.active();
    if (!current || !active) return;
    const { root, selection } = active;

    if (current.kind === "shape") {
      current.history.commit();
      return;
    }
    if (current.kind === "item" || current.kind === "handle") {
      if (current.session) {
        const items = selection.items;
        selection.replace(items, current.session.commit());
        setHandleCursor(null);
      } else if (current.kind === "item") {
        selection.set([current.element], current.scope);
      }
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
    let hit = event.composedPath()[0] ?? null;
    // Con el puntero capturado por el primer clic, el doble clic llega a la página entera: lo que se
    // pulsó es lo que hay bajo el puntero.
    if (!(hit instanceof Node && root.contains(hit))) {
      const owner = root.getRootNode() as Document | ShadowRoot;
      hit = owner.elementFromPoint(event.clientX, event.clientY);
    }
    const path = thinElementAt(point(event), root, hit) ?? hit;
    const pick = pickAt(path, root, { scope: selection.scope });
    if (pick?.element instanceof SVGTextElement && host.editText) {
      host.editText(pick.element, point(event));
      return;
    }
    if (pick && !isContainer(pick.element) && vertexEditKind(pick.element) && host.editVertices) {
      host.editVertices(pick.element);
      return;
    }
    if (!pick || !isContainer(pick.element)) return;
    selection.enter(pick.element);
    const inner = pickAt(path, root, { scope: pick.element });
    if (inner) selection.set([inner.element], inner.scope);
  };

  const cancelPress = () => {
    if (press?.kind === "marquee") host.showMarquee(null);
    else if (press?.kind === "shape") press.history.rollback();
    else press?.session?.cancel();
    press = null;
    setHandleCursor(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const active = host.active();
    if (!active) return;
    const arrow = ARROWS[event.key];
    if (event.key === "Escape") {
      if (press) cancelPress();
      else active.selection.escape();
      event.preventDefault();
    } else if (event.key.toLowerCase() === "a" && (event.ctrlKey || event.metaKey)) {
      // La aplicación también envía selection.selectAll desde su menú; seleccionar todo dos veces
      // no cambia nada.
      active.selection.selectAll();
      event.preventDefault();
    } else if (arrow && !event.ctrlKey && !event.altKey && !event.metaKey && !press) {
      const items = active.selection.items;
      if (items.length === 0) return;
      const step = event.shiftKey ? 10 : 1;
      // Las pulsaciones seguidas se funden en un solo paso del historial.
      active.history.transact(
        "move",
        () => {
          transformItems(items, moveBy(arrow.x * step, arrow.y * step), active.root);
        },
        "nudge",
      );
      event.preventDefault();
    }
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", cancelPress);
  target.addEventListener("dblclick", onDoubleClick);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", cancelPress);
    target.removeEventListener("dblclick", onDoubleClick);
    target.removeEventListener("keydown", onKeyDown);
  };
}

const ARROWS: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
