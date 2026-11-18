/**
 * Módulo `bridge`.
 *
 * Comunicación con la aplicación a través de chrome.webview, según el contrato de contracts/.
 *
 * Los tipos de los mensajes se generan en `./generated` a partir de contracts/; no se editan a mano.
 * La implementación del puente llega con el issue #6.
 */
export type * from "./generated/contracts";
export { BRIDGE_COMMAND_NAMES, BRIDGE_EVENT_NAMES, PROTOCOL_VERSION } from "./generated/contracts";
