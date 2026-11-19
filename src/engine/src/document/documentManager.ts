import type { HistoryState } from "../history";
import { Selection, type SelectionState } from "../selection";
import { SvgDocument } from "./svgDocument";

/** No hay ningún documento abierto con ese identificador. */
export class UnknownDocumentError extends Error {
  readonly documentId: string;

  constructor(documentId: string) {
    super(`No hay ningún documento abierto con el identificador ${documentId}.`);
    this.name = "UnknownDocumentError";
    this.documentId = documentId;
  }
}

export interface OpenDocument {
  readonly id: string;
  readonly name: string;
  readonly document: SvgDocument;
  /** Selección del documento; cada documento conserva la suya al cambiar de pestaña. */
  readonly selection: Selection;
}

interface Entry extends OpenDocument {
  readonly host: HTMLElement;
}

export interface DocumentManagerOptions {
  /** Se llama cuando cambia cualquier documento abierto. */
  readonly onChanged?: (documentId: string, revision: number) => void;
  /** Se llama cuando cambia el historial de deshacer de cualquier documento abierto. */
  readonly onHistoryChanged?: (documentId: string, state: HistoryState) => void;
  /** Se llama cuando cambia la selección de cualquier documento abierto. */
  readonly onSelectionChanged?: (documentId: string, state: SelectionState) => void;
}

/**
 * Documentos abiertos en el motor (ADR 0004: un motor compartido por todas las pestañas).
 *
 * Cada documento vive en su propio contenedor con shadow root dentro de `container`. Solo el
 * documento activo se muestra; los demás están ocultos y no se pintan.
 */
export class DocumentManager {
  readonly #container: HTMLElement;
  readonly #options: DocumentManagerOptions;
  readonly #entries = new Map<string, Entry>();
  #activeId: string | null = null;

  constructor(container: HTMLElement, options: DocumentManagerOptions = {}) {
    this.#container = container;
    this.#options = options;
  }

  /** El documento visible, o `null` si no hay ninguno activo. */
  get active(): OpenDocument | null {
    return this.#activeId === null ? null : (this.#entries.get(this.#activeId) ?? null);
  }

  get ids(): readonly string[] {
    return [...this.#entries.keys()];
  }

  /**
   * Carga un documento. Si ya había uno con el mismo identificador, lo sustituye.
   * @throws {SvgParseError} si el texto no es un SVG válido; en ese caso no se abre nada.
   */
  load(id: string, name: string, svg: string): SvgDocument {
    const host = this.#container.ownerDocument.createElement("div");
    host.className = "winvector-document";
    host.hidden = true;
    this.#container.append(host);

    let document: SvgDocument;
    try {
      document = SvgDocument.load(svg, host, {
        onChange: (revision) => {
          // Un cambio puede quitar elementos seleccionados (por ejemplo, al deshacer su creación).
          this.#entries.get(id)?.selection.prune();
          this.#options.onChanged?.(id, revision);
        },
        onHistoryChange: (state) => this.#options.onHistoryChanged?.(id, state),
      });
    } catch (error) {
      host.remove();
      throw error;
    }
    const selection = new Selection(document.root, (state) => {
      this.#options.onSelectionChanged?.(id, state);
    });

    const wasActive = this.#activeId === id;
    if (this.#entries.has(id)) this.close(id);
    this.#entries.set(id, { id, name, document, selection, host });
    if (wasActive) this.activate(id);
    return document;
  }

  /** @throws {UnknownDocumentError} */
  get(id: string): SvgDocument {
    return this.#entry(id).document;
  }

  /** Documento abierto con su selección. @throws {UnknownDocumentError} */
  open(id: string): OpenDocument {
    return this.#entry(id);
  }

  /** Muestra un documento y oculta los demás. */
  activate(id: string): SvgDocument {
    const entry = this.#entry(id);
    for (const other of this.#entries.values()) other.host.hidden = other !== entry;
    this.#activeId = id;
    return entry.document;
  }

  close(id: string): void {
    const entry = this.#entry(id);
    entry.document.dispose();
    entry.host.remove();
    this.#entries.delete(id);
    if (this.#activeId === id) this.#activeId = null;
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (!entry) throw new UnknownDocumentError(id);
    return entry;
  }
}
