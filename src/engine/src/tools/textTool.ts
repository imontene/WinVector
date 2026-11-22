import type { TextLock, ToolName } from "../bridge";
import { applyToPoint, invert, type Matrix, type Point } from "../geometry";
import type { History } from "../history";
import type { Selection } from "../selection";
import { SVG_NS, TextEditor, textEditability, type TextEditScene } from "../text";
import { formatNumber } from "../transform";
import type { ShapeStyle } from "./shapes";

/** Tamaño de la fuente de un texto nuevo, en unidades del documento. */
export const NEW_TEXT_SIZE = 16;
/** Familia de un texto nuevo, con una genérica de reserva para los equipos sin ella. */
export const NEW_TEXT_FONT = "Segoe UI, sans-serif";

export interface TextToolHost {
  tool(): ToolName;
  active(): {
    readonly root: SVGSVGElement;
    readonly selection: Selection;
    readonly history: History;
  } | null;
  style(): ShapeStyle;
  /** Ha cambiado lo que se dibuja en la capa de superposición. */
  changed(): void;
  /** Se ha intentado editar un texto que no se puede editar en el lienzo. */
  locked(reason: TextLock): void;
}

interface Editing {
  readonly editor: TextEditor;
  readonly history: History;
  readonly selection: Selection;
  /** El texto se ha creado al empezar: si se queda vacío, desaparece. */
  readonly created: boolean;
}

const toMatrix = (m: DOMMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });

/** El `<text>` de un punto del lienzo (también desde uno de sus `tspan`), o `null`. */
function textAt(event: Event, root: SVGSVGElement): SVGTextElement | null {
  for (const node of event.composedPath()) {
    if (node === root) return null;
    if (node instanceof SVGTextElement) return node;
  }
  return null;
}

/**
 * Herramienta Texto (atajo `T`, issue #93): clic en el lienzo crea un texto y empieza a editarlo;
 * clic en un texto lo edita. Con la herramienta Selección, doble clic en un texto también lo edita.
 *
 * Mientras se edita:
 * - Las teclas van al texto (no a los atajos de las herramientas), con tildes, IME, portapapeles y
 *   deshacer del sistema. `Intro` empieza otra línea.
 * - Clic en el texto coloca el cursor (arrastrar selecciona, `Mayús` amplía la selección).
 * - `Esc` o un clic fuera terminan la edición; el texto queda seleccionado. Un texto vacío desaparece.
 *
 * Toda la edición es un solo paso del historial ("edit-text"); si no cambia nada, no deja ninguno.
 * Los textos que no se pueden editar en el lienzo (sobre un trazado, con posiciones por carácter…)
 * no se tocan: se avisa con `locked` de por qué.
 */
export function installTextTool(target: Window, host: TextToolHost, label: () => string) {
  let editing: Editing | null = null;
  let dragging = false;

  const isActive = () => host.tool() === "text";
  const consume = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  /** Empieza a editar un texto (que ya está en el paso del historial abierto). */
  const start = (
    text: SVGTextElement,
    created: boolean,
    history: History,
    selection: Selection,
  ) => {
    const editor = new TextEditor(
      text,
      {
        changed: () => {
          host.changed();
        },
        finish: () => {
          finish();
        },
      },
      label(),
    );
    editing = { editor, history, selection, created };
    selection.set([text], selection.scope);
    host.changed();
    return editor;
  };

  /** Edita un texto existente, o avisa de por qué no se puede. Devuelve el editor, o `null`. */
  const edit = (text: SVGTextElement): TextEditor | null => {
    const active = host.active();
    if (!active) return null;
    if (editing?.editor.text === text) return editing.editor;
    finish();
    const editability = textEditability(text);
    if (!editability.editable) {
      host.locked(editability.reason);
      active.selection.set([text], active.selection.scope);
      return null;
    }
    active.history.begin("edit-text");
    return start(text, false, active.history, active.selection);
  };

  /** Crea un texto vacío en un punto de la pantalla y empieza a editarlo. */
  const create = (screen: Point) => {
    const active = host.active();
    if (!active) return;
    const parent = active.selection.scope;
    const ctm = parent instanceof SVGGraphicsElement ? parent.getScreenCTM() : null;
    const toParent = ctm ? invert(toMatrix(ctm)) : null;
    if (!toParent) return;
    const at = applyToPoint(toParent, screen);
    active.history.begin("edit-text");
    const text = target.document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", formatNumber(Math.round(at.x * 100) / 100));
    text.setAttribute("y", formatNumber(Math.round(at.y * 100) / 100));
    const fill = host.style().fill;
    text.setAttribute("fill", fill === "none" ? "#000000" : fill);
    text.setAttribute("font-family", NEW_TEXT_FONT);
    text.setAttribute("font-size", String(NEW_TEXT_SIZE));
    parent.append(text);
    start(text, true, active.history, active.selection);
  };

  /**
   * Termina la edición. El paso del historial se confirma si cambió algo; si no, o si el texto nuevo
   * se quedó vacío, se anula (y el documento queda exactamente como estaba).
   */
  const finish = () => {
    const current = editing;
    if (!current) return;
    editing = null;
    dragging = false;
    const { editor, history, selection, created } = current;
    const value = editor.value;
    editor.close();
    const empty = value.replace(/\s/g, "") === "";
    if ((created && empty) || (!created && value === editor.initial)) {
      history.rollback();
      if (created) selection.set([], selection.scope);
    } else if (!created && empty) {
      // Un texto que se ha vaciado desaparece, en el mismo paso.
      editor.text.remove();
      history.commit();
      selection.set([], selection.scope);
    } else {
      history.commit();
    }
    host.changed();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isActive()) return;
    consume(event);
    if (event.button !== 0) return;
    const active = host.active();
    if (!active) return;
    const text = textAt(event, active.root);
    if (text && text === editing?.editor.text) {
      editing.editor.pointerDown(event.clientX, event.clientY, event.shiftKey);
      dragging = true;
      target.document.documentElement.setPointerCapture(event.pointerId);
      return;
    }
    if (editing) {
      // Un clic fuera termina la edición; otro clic ya crea o edita.
      finish();
      if (!text) return;
    }
    if (text) {
      const editor = edit(text);
      editor?.pointerDown(event.clientX, event.clientY, false);
      return;
    }
    create({ x: event.clientX, y: event.clientY });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isActive()) return;
    event.stopImmediatePropagation();
    if (dragging && editing) editing.editor.pointerMove(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isActive()) return;
    consume(event);
    if (dragging) editing?.editor.pointerUp();
    dragging = false;
    editing?.editor.focus();
  };

  const onOther = (event: Event) => {
    if (isActive()) consume(event);
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerup", onPointerUp as EventListener],
    ["click", onOther],
    ["dblclick", onOther],
  ];
  for (const [type, listener] of listeners)
    target.addEventListener(type, listener, { capture: true });

  return {
    /** Cursor y selección del texto que se edita, en pantalla, o `null`. */
    scene(): TextEditScene | null {
      return editing?.editor.scene() ?? null;
    },
    /** Edita un texto (doble clic con Selección). */
    edit(text: SVGTextElement, at?: Point) {
      const editor = edit(text);
      if (editor && at) editor.pointerDown(at.x, at.y, false);
    },
    /** True mientras se edita un texto. */
    isEditing: () => editing !== null,
    /** Termina la edición (al cambiar de herramienta o de documento, o antes de deshacer). */
    finish,
    dispose() {
      finish();
      for (const [type, listener] of listeners) {
        target.removeEventListener(type, listener, { capture: true });
      }
    },
  };
}
