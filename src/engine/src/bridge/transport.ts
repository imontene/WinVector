import type { BridgeMessage } from "./generated/contracts";

/** Respuesta a un comando cuyo nombre no está en el contrato: no encaja en los tipos generados. */
export interface UnknownCommandResponse {
  readonly kind: "response";
  readonly id: string;
  readonly name: string;
  readonly protocolVersion: number;
  readonly ok: false;
  readonly error: {
    readonly code: "unknown-message";
    readonly message: string;
    readonly relatedId: string | null;
  };
}

export type OutgoingMessage = BridgeMessage | UnknownCommandResponse;

/** Canal por el que el motor habla con la aplicación. */
export interface BridgeTransport {
  /**
   * Envía un mensaje. `additionalObjects` (por ejemplo, objetos `File`) llega a la aplicación con
   * el mensaje si el anfitrión lo admite; WebView2 entrega así la ruta real de los archivos.
   */
  send(message: OutgoingMessage, additionalObjects?: readonly unknown[]): void;
  /** Registra un receptor de mensajes entrantes (sin validar). Devuelve la función para anularlo. */
  onMessage(handler: (data: unknown) => void): () => void;
}

/** Parte de la API de WebView2 que usa el motor. */
export interface WebViewHost {
  postMessage(message: unknown): void;
  postMessageWithAdditionalObjects?(message: unknown, additionalObjects: readonly unknown[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewHost };
  }
}

/** Transporte real: la aplicación envía con PostWebMessageAsJson y el motor con postMessage. */
export function webViewTransport(host: WebViewHost): BridgeTransport {
  return {
    send: (message, additionalObjects) => {
      if (additionalObjects?.length && host.postMessageWithAdditionalObjects) {
        host.postMessageWithAdditionalObjects(message, additionalObjects);
      } else {
        host.postMessage(message);
      }
    },
    onMessage: (handler) => {
      const listener = (event: { data: unknown }): void => {
        handler(event.data);
      };
      host.addEventListener("message", listener);
      return () => {
        host.removeEventListener("message", listener);
      };
    },
  };
}

/**
 * Sustituto para el navegador en `npm run dev`, donde no hay aplicación: escribe en la consola lo
 * que el motor enviaría y no recibe nada.
 */
export function consoleTransport(
  log: (...data: unknown[]) => void = console.debug,
): BridgeTransport {
  return {
    send: (message) => {
      log("[puente] →", message);
    },
    onMessage: () => () => undefined,
  };
}

/** Elige el transporte según dónde se ejecuta el motor. */
export function detectTransport(target: Window = window): BridgeTransport {
  const host = target.chrome?.webview;
  return host ? webViewTransport(host) : consoleTransport();
}
