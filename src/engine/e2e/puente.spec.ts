import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * Simula el objeto chrome.webview que WebView2 inyecta en la página, para probar el puente con el
 * bundle real: guarda lo que el motor envía y permite enviarle mensajes como lo haría la aplicación.
 */
test.beforeEach(async ({ page }) => {
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
  await expect(page.locator("#workspace svg").first()).toBeVisible();
});

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: Record<string, unknown>[] }).__sent);

const hostSend = (page: Page, data: unknown) =>
  page.evaluate((d) => {
    (window as unknown as { __hostSend: (d: unknown) => void }).__hostSend(d);
  }, data);

const lastSent = async (page: Page) => (await sent(page)).at(-1);

test("anuncia engine.ready al cargar", async ({ page }) => {
  const [first] = await sent(page);
  expect(first).toMatchObject({
    kind: "event",
    name: "engine.ready",
    protocolVersion: 1,
    payload: { engineVersion: version, protocolVersion: 1 },
  });
});

test("al hacer clic en un elemento envía selection.changed", async ({ page }) => {
  await page.locator("#sol").click();
  expect(await lastSent(page)).toMatchObject({
    name: "selection.changed",
    payload: { items: [{ id: "sol", tagName: "circle" }] },
  });

  await page.locator("#titulo").click();
  expect(await lastSent(page)).toMatchObject({
    payload: { items: [{ id: "titulo", tagName: "text" }] },
  });
});

test("al hacer clic fuera del documento vacía la selección", async ({ page }) => {
  await page.mouse.click(5, 5);
  expect(await lastSent(page)).toMatchObject({
    name: "selection.changed",
    payload: { items: [] },
  });
});

test("responde a app.ping", async ({ page }) => {
  await hostSend(page, {
    kind: "command",
    id: "c1",
    name: "app.ping",
    protocolVersion: 1,
    payload: { sentAt: 1000 },
  });
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      kind: "response",
      id: "c1",
      ok: true,
      payload: { sentAt: 1000 },
    });
});

test("ante un mensaje mal formado envía un evento error y sigue funcionando", async ({ page }) => {
  await hostSend(page, { kind: "command", id: "c2" });
  expect(await lastSent(page)).toMatchObject({
    name: "error",
    payload: { code: "invalid-message", relatedId: "c2" },
  });

  await page.locator("#sol").click();
  expect(await lastSent(page)).toMatchObject({ name: "selection.changed" });
});
