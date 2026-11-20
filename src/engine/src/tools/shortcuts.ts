import type { ArrangeAction, KeyboardShortcut, ZoomAction } from "../bridge";

/** Lo que hacen los atajos que atiende el propio motor. */
export interface ShortcutHost {
  undo(): void;
  redo(): void;
  zoom(action: ZoomAction): void;
  arrange(action: ArrangeAction): void;
  group(): void;
  ungroup(): void;
  /** Envía a la aplicación un atajo que el motor no atiende (Ctrl+S, Ctrl+N…). */
  forward(shortcut: KeyboardShortcut): void;
}

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "altgraph"]);

/**
 * Atajos de teclado con el lienzo enfocado.
 *
 * Con el lienzo enfocado, WebView2 entrega el teclado a la página y los aceleradores de la ventana
 * (menús) no se disparan. El motor atiende los atajos que puede resolver por sí mismo (deshacer y
 * rehacer, zoom, agrupar, orden de apilado) y envía los demás atajos con Ctrl y las teclas de función a la aplicación. Con la
 * ventana enfocada pasa lo contrario: los atiende la aplicación y la página no los recibe, así que
 * nunca se ejecutan dos veces.
 *
 * Los atajos que ya ha atendido una herramienta (por ejemplo Ctrl+A) llegan cancelados y se ignoran.
 */
export function installShortcuts(target: Window, host: ShortcutHost): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    const functionKey = /^f\d{1,2}$/.test(key);
    // Alt+letra abre los menús y Alt+F4 cierra la ventana: de eso se ocupa Windows.
    if ((!ctrl && !functionKey) || event.altKey || MODIFIER_KEYS.has(key)) return;

    if (ctrl && !functionKey) {
      const handled = handleOwn(key, event.shiftKey, host);
      if (handled) {
        event.preventDefault();
        return;
      }
    }
    host.forward({ key, ctrlKey: ctrl, shiftKey: event.shiftKey, altKey: false });
    event.preventDefault();
  };

  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
}

function handleOwn(key: string, shift: boolean, host: ShortcutHost): boolean {
  switch (key) {
    case "z":
      if (shift) host.redo();
      else host.undo();
      return true;
    case "y":
      host.redo();
      return true;
    case "g":
      if (shift) host.ungroup();
      else host.group();
      return true;
    case "pageup":
      host.arrange(shift ? "front" : "forward");
      return true;
    case "pagedown":
      host.arrange(shift ? "back" : "backward");
      return true;
    case "0":
      host.zoom("fit");
      return true;
    case "1":
      host.zoom("actual");
      return true;
    case "+":
    case "=":
      host.zoom("in");
      return true;
    case "-":
    case "_":
      host.zoom("out");
      return true;
    default:
      return false;
  }
}
