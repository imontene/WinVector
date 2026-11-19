import {
  PROTOCOL_VERSION,
  type BridgeCommandName,
  type BridgeCommands,
  type BridgeError,
  type BridgeErrorCode,
  type BridgeEventName,
  type BridgeEvents,
} from "./generated/contracts";
import type { BridgeTransport, OutgoingMessage } from "./transport";

/**
 * Error que un manejador puede lanzar para responder con un código concreto del contrato en lugar
 * de `internal`.
 */
export class BridgeCommandError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeCommandError";
    this.code = code;
  }
}

export type CommandHandler<N extends BridgeCommandName> = (
  payload: BridgeCommands[N]["payload"],
) => BridgeCommands[N]["response"] | Promise<BridgeCommands[N]["response"]>;

type AnyCommandHandler = (payload: unknown) => unknown;

/** Comando entrante con el sobre ya validado. */
interface IncomingCommand {
  readonly id: string;
  readonly name: string;
  readonly protocolVersion: number;
  readonly payload: unknown;
}

export interface EngineBridgeOptions {
  readonly engineVersion: string;
  /** Genera los identificadores de los mensajes del motor. */
  readonly createId?: () => string;
}

/**
 * Lado del motor del puente: atiende los comandos de la aplicación y le envía eventos.
 *
 * Valida el sobre de cada mensaje entrante. El payload se confía al contrato, porque la aplicación
 * lo genera con los mismos tipos; si un manejador falla, se responde con un error `internal`.
 */
export class EngineBridge {
  readonly #transport: BridgeTransport;
  readonly #options: EngineBridgeOptions;
  readonly #handlers = new Map<string, AnyCommandHandler>();
  readonly #createId: () => string;
  #unsubscribe: (() => void) | undefined;

  constructor(transport: BridgeTransport, options: EngineBridgeOptions) {
    this.#transport = transport;
    this.#options = options;
    let counter = 0;
    this.#createId = options.createId ?? (() => `e${String(++counter)}`);
  }

  /** Empieza a escuchar y anuncia a la aplicación que el motor está listo. */
  start(): void {
    this.#unsubscribe ??= this.#transport.onMessage((data) => {
      void this.#receive(data);
    });
    this.emit("engine.ready", {
      engineVersion: this.#options.engineVersion,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  /** Registra el manejador de un comando. Solo puede haber uno por comando. */
  handle<N extends BridgeCommandName>(name: N, handler: CommandHandler<N>): void {
    if (this.#handlers.has(name)) {
      throw new Error(`El comando ${name} ya tiene manejador.`);
    }
    this.#handlers.set(name, handler as AnyCommandHandler);
  }

  /** Envía un evento; `additionalObjects` viaja con él (ver `BridgeTransport.send`). */
  emit<N extends BridgeEventName>(
    name: N,
    payload: BridgeEvents[N],
    additionalObjects?: readonly unknown[],
  ): void {
    this.#send(
      {
        kind: "event",
        id: this.#createId(),
        name,
        protocolVersion: PROTOCOL_VERSION,
        payload,
      } as OutgoingMessage,
      additionalObjects,
    );
  }

  async #receive(data: unknown): Promise<void> {
    const command = parseCommand(data);
    if (typeof command === "string") {
      this.#emitError("invalid-message", command, idOf(data));
      return;
    }

    if (command.protocolVersion !== PROTOCOL_VERSION) {
      this.#respondError(
        command,
        "protocol-mismatch",
        `El motor usa el protocolo ${String(PROTOCOL_VERSION)} y el comando el ${String(command.protocolVersion)}.`,
      );
      return;
    }

    const handler = this.#handlers.get(command.name);
    if (!handler) {
      this.#respondError(command, "unknown-message", `Comando desconocido: ${command.name}.`);
      return;
    }

    try {
      const result = await handler(command.payload);
      this.#send({
        kind: "response",
        id: command.id,
        name: command.name,
        protocolVersion: PROTOCOL_VERSION,
        ok: true,
        payload: result,
      } as OutgoingMessage);
    } catch (error) {
      if (error instanceof BridgeCommandError) {
        this.#respondError(command, error.code, error.message);
      } else {
        this.#respondError(
          command,
          "internal",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  #respondError(command: IncomingCommand, code: BridgeErrorCode, message: string): void {
    const error: BridgeError = { code, message, relatedId: command.id };
    this.#send({
      kind: "response",
      id: command.id,
      name: command.name,
      protocolVersion: PROTOCOL_VERSION,
      ok: false,
      error,
    } as OutgoingMessage);
  }

  #emitError(code: BridgeErrorCode, message: string, relatedId: string | null): void {
    this.emit("error", { code, message, relatedId });
  }

  #send(message: OutgoingMessage, additionalObjects?: readonly unknown[]): void {
    this.#transport.send(message, additionalObjects);
  }
}

/** Valida el sobre de un comando entrante. Devuelve el comando o la descripción del problema. */
function parseCommand(data: unknown): IncomingCommand | string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "El mensaje no es un objeto JSON.";
  }
  const message = data as Record<string, unknown>;
  if (message.kind !== "command") {
    return `El motor solo acepta comandos; se recibió kind=${JSON.stringify(message.kind)}.`;
  }
  if (typeof message.id !== "string" || message.id.length === 0) {
    return "Falta el id del comando.";
  }
  if (typeof message.name !== "string" || message.name.length === 0) {
    return "Falta el nombre del comando.";
  }
  if (typeof message.protocolVersion !== "number" || !Number.isInteger(message.protocolVersion)) {
    return "Falta protocolVersion o no es un entero.";
  }
  if (typeof message.payload !== "object" || message.payload === null) {
    return "Falta el payload del comando.";
  }
  return {
    id: message.id,
    name: message.name,
    protocolVersion: message.protocolVersion,
    payload: message.payload,
  };
}

function idOf(data: unknown): string | null {
  if (typeof data === "object" && data !== null && "id" in data) {
    const { id } = data;
    return typeof id === "string" ? id : null;
  }
  return null;
}
