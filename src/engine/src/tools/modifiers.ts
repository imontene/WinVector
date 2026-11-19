/**
 * Teclas modificadoras pulsadas, según los eventos de teclado de la página.
 *
 * En WebView2, el control de WinUI reenvía el ratón a la página y los eventos pueden llegar sin
 * `ctrlKey` aunque Ctrl esté pulsado. Por eso las herramientas consultan también las teclas que la
 * página ha visto pulsar.
 */
export type Modifier = "Control" | "Shift" | "Alt" | "Meta";

const MODIFIERS: ReadonlySet<string> = new Set<Modifier>(["Control", "Shift", "Alt", "Meta"]);
const pressed = new Set<string>();

/** Empieza a seguir las teclas modificadoras. Devuelve una función que deja de seguirlas. */
export function trackModifiers(target: Window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (MODIFIERS.has(event.key)) pressed.add(event.key);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    pressed.delete(event.key);
  };
  // Si la página pierde el foco con una tecla pulsada, no recibirá cuando se suelta.
  const onBlur = () => {
    pressed.clear();
  };
  target.addEventListener("keydown", onKeyDown, { capture: true });
  target.addEventListener("keyup", onKeyUp, { capture: true });
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onKeyDown, { capture: true });
    target.removeEventListener("keyup", onKeyUp, { capture: true });
    target.removeEventListener("blur", onBlur);
    pressed.clear();
  };
}

/** True si la tecla está pulsada según el evento o según el teclado de la página. */
export function isPressed(event: MouseEvent, modifier: Modifier): boolean {
  return event.getModifierState(modifier) || pressed.has(modifier);
}
