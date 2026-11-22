import { pickAt, selectionScreenRect, type Selection } from "../selection";
import { isTextEntry } from "./modifiers";
import { vertexEditKind } from "./vertices";

/** Lo que el menú contextual necesita del motor. */
export interface ContextMenuHost {
  active(): { readonly root: SVGSVGElement; readonly selection: Selection } | null;
  /** Pide a la aplicación que abra su menú en un punto de la página. */
  open(request: { x: number; y: number; keyboard: boolean; canEditVertices: boolean }): void;
}

/**
 * Menú contextual del lienzo (issue #73). El motor no dibuja el menú: la aplicación abre uno nativo
 * de Windows en el punto que le indica.
 *
 * - Clic derecho sobre un objeto que no está seleccionado: lo selecciona (como un clic, dentro del
 *   grupo en el que se ha entrado). Sobre un objeto seleccionado, la selección no cambia, para poder
 *   actuar sobre varios. Sobre el fondo, deselecciona.
 * - `Mayús+F10` o la tecla de menú: el menú se abre junto a la selección (o en el centro del lienzo).
 *
 * Devuelve una función que lo desinstala.
 */
export function installContextMenu(target: Window, host: ContextMenuHost): () => void {
  const canEditVertices = (selection: Selection) => {
    const [only] = selection.items;
    return selection.items.length === 1 && only !== undefined && vertexEditKind(only) !== null;
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const active = host.active();
    if (!active) return;
    const { root, selection } = active;
    const pick = pickAt(event.composedPath()[0] ?? null, root, { scope: selection.scope });
    if (!pick) selection.set([], selection.scope);
    else if (!selection.items.includes(pick.element)) selection.set([pick.element], pick.scope);
    host.open({
      x: event.clientX,
      y: event.clientY,
      keyboard: false,
      canEditVertices: canEditVertices(selection),
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Mientras se escribe en un texto, Mayús+F10 y la tecla de menú son del campo de texto.
    if (isTextEntry(event)) return;
    const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (!menuKey || event.ctrlKey || event.altKey || event.metaKey) return;
    // Sin esto, el navegador enviaría también un contextmenu.
    event.preventDefault();
    event.stopPropagation();
    const active = host.active();
    if (!active) return;
    const { root, selection } = active;
    const rect = selection.items.length > 0 ? selectionScreenRect(selection.items, root) : null;
    const page = target.document.documentElement;
    host.open({
      x: rect ? rect.x + rect.width : page.clientWidth / 2,
      y: rect ? rect.y + rect.height / 2 : page.clientHeight / 2,
      keyboard: true,
      canEditVertices: canEditVertices(selection),
    });
  };

  target.addEventListener("contextmenu", onContextMenu, { capture: true });
  target.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    target.removeEventListener("contextmenu", onContextMenu, { capture: true });
    target.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
