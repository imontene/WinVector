import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const sample = readFileSync(new URL("../src/sample.svg", import.meta.url), "utf8");

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
  // Con aplicación, el motor espera a que esta le entregue los documentos.
  await hostSend(
    page,
    command("c-load", "document.load", { documentId: "d1", name: "Ejemplo", svg: sample }),
  );
  await hostSend(page, command("c-activate", "document.activate", { documentId: "d1" }));
  await expect(page.locator("#workspace svg").first()).toBeVisible();
});

const command = (id: string, name: string, payload: unknown) => ({
  kind: "command",
  id,
  name,
  protocolVersion: 2,
  payload,
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
    protocolVersion: 2,
    payload: { engineVersion: version, protocolVersion: 2 },
  });
});

test("al hacer clic en un elemento envía selection.changed", async ({ page }) => {
  await page.locator("#sol").click();
  expect(await lastSent(page)).toMatchObject({
    name: "selection.changed",
    payload: { documentId: "d1", items: [{ id: "sol", tagName: "circle" }] },
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
    protocolVersion: 2,
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

test("devuelve idéntico un documento sin cambios", async ({ page }) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      kind: "response",
      id: "c-ser",
      ok: true,
      payload: { documentId: "d1", svg: sample, revision: 0 },
    });
});

test("informa de la línea y la columna de un SVG no válido", async ({ page }) => {
  await hostSend(
    page,
    command("c-bad", "document.load", {
      documentId: "d2",
      name: "roto.svg",
      svg: "<svg>\n  <g>\n</svg>",
    }),
  );
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      id: "c-bad",
      ok: true,
      payload: { documentId: "d2", loaded: false, error: { line: 3 } },
    });
});

test("avisa con document.changed cuando el documento cambia", async ({ page }) => {
  await page.locator("#sol").evaluate((circle) => {
    circle.setAttribute("r", "60");
  });
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      name: "document.changed",
      payload: { documentId: "d1", revision: 1 },
    });
});

test("responde unknown-document a un documento que no existe", async ({ page }) => {
  await hostSend(page, command("c-x", "document.activate", { documentId: "nada" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      id: "c-x",
      ok: false,
      error: { code: "unknown-document" },
    });
});

test("al cambiar de documento solo se ve el activo", async ({ page }) => {
  await hostSend(
    page,
    command("c-d3", "document.load", {
      documentId: "d3",
      name: "otro.svg",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="otro" width="10" height="10"/></svg>',
    }),
  );
  await hostSend(page, command("c-act3", "document.activate", { documentId: "d3" }));
  await expect(page.locator("#otro")).toBeVisible();
  await expect(page.locator("#sol")).toBeHidden();
});
