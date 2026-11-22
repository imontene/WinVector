// Diagnóstico temporal del issue #91 (no se fusiona): anota lo que la página ve de Mayús y de los
// clics en un elemento accesible que leen las pruebas de interfaz.
import { isPressed } from "./tools/modifiers";

export function installDiag91(target: Window): void {
  const doc = target.document;
  const element = doc.createElement("div");
  element.id = "diag91";
  element.setAttribute("role", "status");
  element.style.cssText =
    "position:fixed;left:0;bottom:0;font:9px monospace;background:#ff0;color:#000;z-index:9999;max-width:60%;pointer-events:none;white-space:pre-wrap";
  doc.body.append(element);
  const entries: string[] = [];
  let sequence = 0;
  const log = (text: string): void => {
    sequence += 1;
    entries.push(`${sequence}@${Math.round(performance.now())} ${text}`);
    while (entries.length > 24) entries.shift();
    const all = entries.join(" | ");
    element.setAttribute("aria-label", all);
    element.textContent = all;
  };
  const state = () =>
    `focus=${doc.hasFocus()} active=${doc.activeElement?.localName ?? "-"}`;
  const key = (kind: string) => (event: KeyboardEvent) => {
    if (event.key === "Shift" || event.shiftKey)
      log(`${kind} key=${event.key} shift=${event.shiftKey} rep=${event.repeat} ${state()}`);
  };
  const pointer = (kind: string) => (event: PointerEvent) => {
    log(
      `${kind} btn=${event.button} shift=${event.shiftKey} ms=${event.getModifierState("Shift")} pressed=${isPressed(event, "Shift")} type=${event.pointerType} ${state()}`,
    );
  };
  target.addEventListener("keydown", key("kd"), { capture: true });
  target.addEventListener("keyup", key("ku"), { capture: true });
  target.addEventListener("pointerdown", pointer("pd"), { capture: true });
  target.addEventListener("pointerup", pointer("pu"), { capture: true });
  target.addEventListener("focus", () => log(`win-focus ${state()}`));
  target.addEventListener("blur", () => log(`win-blur ${state()}`));
  log(`ready ${state()}`);
}
