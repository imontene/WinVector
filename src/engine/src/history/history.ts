/**
 * Historial de deshacer y rehacer de un documento.
 *
 * No hay un comando reversible por cada acción: el historial registra los cambios del DOM del
 * documento (los `MutationRecord` del observador de `SvgDocument`) y sabe invertirlos. Así,
 * cualquier edición se puede deshacer sin código adicional. Las herramientas agrupan los cambios de
 * una acción (un arrastre completo, por ejemplo) con `transact` o `begin`/`commit`; los cambios
 * hechos fuera de una transacción forman un paso cada vez que el observador los entrega.
 */

/** Estado del historial para la interfaz. */
export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Acción que se desharía, por ejemplo "move"; la interfaz la traduce ("Deshacer mover"). */
  readonly undoAction: string | null;
  readonly redoAction: string | null;
}

/** Lo que el historial necesita del documento. */
export interface HistoryHost {
  /** Revisión actual: identifica el estado del documento. */
  revision(): number;
  /** Entrega al historial los cambios pendientes del observador. */
  flush(): void;
  /**
   * Aplica cambios de deshacer o rehacer sin que generen pasos nuevos y deja el documento en la
   * revisión indicada.
   */
  applyHistory(apply: () => void, revision: number): void;
  /**
   * Últimos cambios de una acción antes de cerrarla, que van en su mismo paso (por ejemplo, borrar
   * las definiciones que ha dejado sin uso, issue #113).
   */
  beforeCommit?(): void;
}

interface AttributeOperation {
  readonly kind: "attribute";
  readonly target: Element;
  readonly namespace: string | null;
  readonly name: string;
  readonly qualifiedName: string;
  readonly before: string | null;
  after: string | null;
}

interface DataOperation {
  readonly kind: "data";
  readonly target: CharacterData;
  readonly before: string;
  after: string;
}

interface ChildrenOperation {
  readonly kind: "children";
  readonly target: Node;
  readonly added: readonly Node[];
  readonly removed: readonly Node[];
  readonly previousSibling: Node | null;
}

type Operation = AttributeOperation | DataOperation | ChildrenOperation;

interface Step {
  readonly action: string;
  /** Pasos seguidos con la misma clave se funden en uno (escribir en un campo, mover con flechas). */
  readonly mergeKey: string | null;
  readonly operations: Operation[];
  readonly revisionBefore: number;
  revisionAfter: number;
}

/** Acción de los cambios hechos fuera de una transacción. */
export const DEFAULT_ACTION = "edit";

export class History {
  readonly #host: HistoryHost;
  readonly #onChange: ((state: HistoryState) => void) | undefined;
  readonly #undo: Step[] = [];
  readonly #redo: Step[] = [];
  #open: Step | null = null;
  #openDepth = 0;
  #openMerged = false;
  /** El último paso admite que se le fundan cambios; deshacer, rehacer o un paso distinto lo cierran. */
  #mergeable = false;

  constructor(host: HistoryHost, onChange?: (state: HistoryState) => void) {
    this.#host = host;
    this.#onChange = onChange;
  }

  get state(): HistoryState {
    this.#host.flush();
    return {
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undoAction: this.#undo.at(-1)?.action ?? null,
      redoAction: this.#redo.at(-1)?.action ?? null,
    };
  }

  /**
   * Empieza una acción; los cambios hasta `commit` forman un solo paso. Se puede anidar: solo cuenta
   * la acción exterior.
   *
   * Con `mergeKey`, si el paso anterior se hizo con la misma clave y no hubo nada entre medias, los
   * cambios se funden con él: un solo "Deshacer" devuelve el valor que había antes de empezar.
   */
  begin(action: string, mergeKey?: string): void {
    if (this.#openDepth++ > 0) return;
    this.#host.flush();
    const last = this.#undo.at(-1);
    if (mergeKey !== undefined && this.#mergeable && last?.mergeKey === mergeKey) {
      this.#undo.pop();
      this.#open = last;
      this.#openMerged = true;
      return;
    }
    this.#openMerged = false;
    this.#open = {
      action,
      mergeKey: mergeKey ?? null,
      operations: [],
      revisionBefore: this.#host.revision(),
      revisionAfter: 0,
    };
  }

  /** Termina la acción empezada con `begin`. Si no cambió nada, no crea ningún paso. */
  commit(): void {
    if (this.#openDepth === 0) return;
    if (this.#openDepth === 1) this.#host.beforeCommit?.();
    if (--this.#openDepth > 0) return;
    this.#host.flush();
    const step = this.#open;
    this.#open = null;
    if (step) this.#push(step, this.#openMerged);
  }

  /**
   * Anula la acción empezada con `begin`: deshace sus cambios y no deja ningún paso (`Esc` en mitad
   * de un gesto que crea elementos). Una acción que se estaba fundiendo con el paso anterior no se
   * puede separar de él: se cierra como con `commit`.
   */
  rollback(): void {
    if (this.#openDepth === 0) return;
    this.#host.flush();
    const step = this.#open;
    const merged = this.#openMerged;
    this.#open = null;
    this.#openDepth = 0;
    if (!step) return;
    if (merged) {
      this.#push(step, true);
      return;
    }
    finalize(step);
    this.#host.applyHistory(() => {
      revert(step);
    }, step.revisionBefore);
    this.#mergeable = false;
  }

  /** Ejecuta `change` como un solo paso con el nombre `action` (ver `begin`). */
  transact<T>(action: string, change: () => T, mergeKey?: string): T {
    this.begin(action, mergeKey);
    try {
      return change();
    } finally {
      this.commit();
    }
  }

  /**
   * Recibe los cambios del observador del documento. `revisionBefore` y `revisionAfter` son las
   * revisiones del documento antes y después de esos cambios.
   */
  record(records: readonly MutationRecord[], revisionBefore: number, revisionAfter: number): void {
    if (this.#open) {
      this.#add(this.#open, records);
      return;
    }
    const step: Step = {
      action: DEFAULT_ACTION,
      mergeKey: null,
      operations: [],
      revisionBefore,
      revisionAfter,
    };
    this.#add(step, records);
    this.#push(step);
  }

  /** Deshace el último paso. Devuelve `false` si no hay nada que deshacer. */
  undo(): boolean {
    this.commitAll();
    const step = this.#undo.pop();
    if (!step) return false;
    this.#host.applyHistory(() => {
      revert(step);
    }, step.revisionBefore);
    this.#redo.push(step);
    this.#mergeable = false;
    this.#notify();
    return true;
  }

  /** Rehace el último paso deshecho. Devuelve `false` si no hay nada que rehacer. */
  redo(): boolean {
    this.commitAll();
    const step = this.#redo.pop();
    if (!step) return false;
    this.#host.applyHistory(() => {
      reapply(step);
    }, step.revisionAfter);
    this.#undo.push(step);
    this.#mergeable = false;
    this.#notify();
    return true;
  }

  /** Cierra cualquier acción abierta, por ejemplo antes de deshacer en mitad de un arrastre. */
  commitAll(): void {
    while (this.#openDepth > 0) this.commit();
  }

  #add(step: Step, records: readonly MutationRecord[]): void {
    for (const record of records) {
      const operation = toOperation(record, step);
      if (operation) step.operations.push(operation);
    }
  }

  /** `merged`: el paso ya estaba en la pila y se sacó para fundirle cambios. */
  #push(step: Step, merged = false): void {
    finalize(step);
    if (step.operations.length === 0) {
      // Los cambios se anularon entre sí (un arrastre que vuelve al origen): el documento está como
      // antes del paso, así que recupera aquella revisión y no queda nada que deshacer.
      if (this.#host.revision() !== step.revisionBefore)
        this.#host.applyHistory(() => undefined, step.revisionBefore);
      this.#mergeable = false;
      if (merged) this.#notify();
      return;
    }
    step.revisionAfter = this.#host.revision();
    this.#undo.push(step);
    this.#redo.length = 0;
    this.#mergeable = step.mergeKey !== null;
    this.#notify();
  }

  #notify(): void {
    this.#onChange?.(this.state);
  }
}

/** Convierte un cambio en una operación; los cambios repetidos de un mismo valor se agrupan. */
function toOperation(record: MutationRecord, step: Step): Operation | null {
  switch (record.type) {
    case "attributes": {
      const target = record.target as Element;
      const name = record.attributeName ?? "";
      const namespace = record.attributeNamespace;
      const existing = step.operations.find(
        (op): op is AttributeOperation =>
          op.kind === "attribute" &&
          op.target === target &&
          op.name === name &&
          op.namespace === namespace,
      );
      if (existing) return null;
      return {
        kind: "attribute",
        target,
        namespace,
        name,
        qualifiedName: qualifiedAttributeName(target, namespace, name),
        before: record.oldValue,
        after: null,
      };
    }
    case "characterData": {
      const target = record.target as CharacterData;
      const existing = step.operations.some((op) => op.kind === "data" && op.target === target);
      return existing ? null : { kind: "data", target, before: record.oldValue ?? "", after: "" };
    }
    case "childList":
      return {
        kind: "children",
        target: record.target,
        added: [...record.addedNodes],
        removed: [...record.removedNodes],
        previousSibling: record.previousSibling,
      };
    default:
      return null;
  }
}

/** Anota el valor final de atributos y textos y descarta los que no cambiaron. */
function finalize(step: Step): void {
  for (const op of step.operations) {
    if (op.kind === "attribute") op.after = op.target.getAttributeNS(op.namespace, op.name);
    else if (op.kind === "data") op.after = op.target.data;
  }
  const changed = step.operations.filter((op) => op.kind === "children" || op.before !== op.after);
  step.operations.splice(0, step.operations.length, ...changed);
}

function revert(step: Step): void {
  for (const op of [...step.operations].reverse()) {
    if (op.kind === "children") {
      for (const node of op.added) {
        if (node.parentNode === op.target) node.parentNode.removeChild(node);
      }
      insertAfter(op.target, op.previousSibling, op.removed);
    }
  }
  for (const op of step.operations) {
    if (op.kind === "attribute") setAttribute(op, op.before);
    else if (op.kind === "data") op.target.data = op.before;
  }
}

function reapply(step: Step): void {
  for (const op of step.operations) {
    if (op.kind === "children") {
      for (const node of op.removed) {
        if (node.parentNode === op.target) node.parentNode.removeChild(node);
      }
      insertAfter(op.target, op.previousSibling, op.added);
    }
  }
  for (const op of step.operations) {
    if (op.kind === "attribute") setAttribute(op, op.after);
    else if (op.kind === "data") op.target.data = op.after;
  }
}

/** Inserta `nodes` en `parent` justo después de `previous` (o al principio si es null). */
function insertAfter(parent: Node, previous: Node | null, nodes: readonly Node[]): void {
  const reference = previous?.parentNode === parent ? previous.nextSibling : parent.firstChild;
  for (const node of nodes) parent.insertBefore(node, reference);
}

function setAttribute(op: AttributeOperation, value: string | null): void {
  if (value === null) op.target.removeAttributeNS(op.namespace, op.name);
  else op.target.setAttributeNS(op.namespace, op.qualifiedName, value);
}

/** Nombre con prefijo de un atributo con espacio de nombres (xlink:href), para poder restaurarlo. */
function qualifiedAttributeName(target: Element, namespace: string | null, name: string): string {
  if (!namespace) return name;
  const prefix =
    target.getAttributeNodeNS(namespace, name)?.prefix ?? target.lookupPrefix(namespace);
  return prefix ? `${prefix}:${name}` : name;
}
