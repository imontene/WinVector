import { isContainer, selectableChildren } from "./hitTest";

/** Estado de la selección de un documento. */
export interface SelectionState {
  /** Elementos seleccionados, en orden de documento. */
  readonly items: readonly Element[];
  /** Grupo en el que está el usuario, o `null` en el nivel superior. */
  readonly scope: Element | null;
}

/**
 * Selección de un documento: qué elementos están seleccionados y en qué grupo ha entrado el
 * usuario. No forma parte del documento ni de su historial.
 */
export class Selection {
  readonly #root: SVGSVGElement;
  readonly #onChange: ((state: SelectionState) => void) | undefined;
  #items: Element[] = [];
  #scope: Element;

  constructor(root: SVGSVGElement, onChange?: (state: SelectionState) => void) {
    this.#root = root;
    this.#scope = root;
    this.#onChange = onChange;
  }

  get items(): readonly Element[] {
    return this.#items;
  }

  /** Grupo en el que está el usuario; el elemento raíz en el nivel superior. */
  get scope(): Element {
    return this.#scope;
  }

  get state(): SelectionState {
    return { items: this.#items, scope: this.#scope === this.#root ? null : this.#scope };
  }

  /** Sustituye la selección. Con `scope`, cambia también el grupo en el que está el usuario. */
  set(items: Iterable<Element>, scope: Element = this.#scope): void {
    this.#update([...items], scope);
  }

  /** Añade o quita un elemento (`Mayús`+clic). */
  toggle(element: Element, scope: Element = this.#scope): void {
    const items = this.#items.includes(element)
      ? this.#items.filter((item) => item !== element)
      : [...this.#items, element];
    this.#update(items, scope);
  }

  /** Añade elementos sin quitar los que ya están. */
  add(items: Iterable<Element>): void {
    this.#update([...this.#items, ...items], this.#scope);
  }

  clear(): void {
    this.#update([], this.#scope);
  }

  /** Selecciona todos los objetos del grupo actual. */
  selectAll(): void {
    this.#update(selectableChildren(this.#scope), this.#scope);
  }

  /** Entra en un grupo: a partir de ahora un clic elige entre sus hijos. */
  enter(group: Element): boolean {
    if (!isContainer(group) || !this.#root.contains(group) || group === this.#root) return false;
    this.#update([], group);
    return true;
  }

  /**
   * `Esc`: si hay algo seleccionado, lo deselecciona; si no, sale del grupo actual y lo selecciona.
   * Devuelve `false` si no había nada que hacer.
   */
  escape(): boolean {
    if (this.#items.length > 0) {
      this.clear();
      return true;
    }
    if (this.#scope === this.#root) return false;
    const group = this.#scope;
    this.#update([group], group.parentElement ?? this.#root);
    return true;
  }

  /**
   * Vuelve a seleccionar `items` cambiando los que se han sustituido por otros (un círculo por una
   * elipse). Se pasan los elementos de antes porque, al quitar los sustituidos del documento, la
   * selección ya se ha podado.
   */
  replace(items: readonly Element[], replaced: ReadonlyMap<Element, Element>): void {
    if (replaced.size === 0) return;
    this.set(
      items.map((item) => replaced.get(item) ?? item),
      this.#scope,
    );
  }

  /**
   * Quita los elementos que ya no están en el documento (por ejemplo, al deshacer su creación) y sale
   * de un grupo que ya no existe. Devuelve `true` si la selección ha cambiado.
   */
  prune(): boolean {
    const items = this.#items.filter((item) => this.#root.contains(item) && item !== this.#root);
    let scope = this.#scope;
    while (scope !== this.#root && !this.#root.contains(scope)) scope = this.#root;
    if (items.length === this.#items.length && scope === this.#scope) return false;
    this.#update(items, scope);
    return true;
  }

  #update(items: Element[], scope: Element): void {
    const unique = [...new Set(items)].sort(documentOrder);
    const scopeValue = this.#root.contains(scope) ? scope : this.#root;
    const same =
      scopeValue === this.#scope &&
      unique.length === this.#items.length &&
      unique.every((item, index) => item === this.#items[index]);
    if (same) return;
    this.#items = unique;
    this.#scope = scopeValue;
    this.#onChange?.(this.state);
  }
}

function documentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
