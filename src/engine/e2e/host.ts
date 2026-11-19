import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** SVG de ejemplo del motor. */
export const sample = readFileSync(new URL("../src/sample.svg", import.meta.url), "utf8");

/** Versión del protocolo del contrato (contracts/catalog.json). */
export const PROTOCOL = 3;

/**
 * Simula el objeto chrome.webview que WebView2 inyecta en la página, para probar el motor con el
 * bundle real: guarda lo que el motor envía y permite enviarle mensajes como lo haría la aplicación.
 * Después carga el SVG de ejemplo como documento d1 y lo activa.
 */
export async function openWithFakeHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Listener = (event: { data: unknown }) => void;
    const listeners: Listener[] = [];
    const host = window as unknown as Record<string, unknown>;
    host.__sent = [];
    host.__hostSend = (data: unknown) => {
      listeners.forEach((listener) => {
        listener({ data });
      });
    };
    host.chrome = {
      webview: {
        postMessage: (message: unknown) => {
          (host.__sent as unknown[]).push(JSON.parse(JSON.stringify(message)));
        },
        addEventListener: (_: string, listener: Listener) => listeners.push(listener),
        removeEventListener: () => undefined,
      },
    };
  });
  await page.goto("/");
  // Con aplicación, el motor espera a que esta le entregue los documentos.
  await hostSend(
    page,
    command("c-load", "document.load", { documentId: "d1", name: "Ejemplo", svg: sample }),
  );
  await hostSend(page, command("c-activate", "document.activate", { documentId: "d1" }));
  await expect(page.locator("#workspace svg").first()).toBeVisible();
}

export const command = (id: string, name: string, payload: unknown) => ({
  kind: "command",
  id,
  name,
  protocolVersion: PROTOCOL,
  payload,
});

/** Mensajes que el motor ha enviado a la aplicación. */
export const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: Record<string, unknown>[] }).__sent);

/** Envía un mensaje al motor como la aplicación. */
export const hostSend = (page: Page, data: unknown) =>
  page.evaluate((d) => {
    (window as unknown as { __hostSend: (d: unknown) => void }).__hostSend(d);
  }, data);

export const lastSent = async (page: Page) => (await sent(page)).at(-1);
