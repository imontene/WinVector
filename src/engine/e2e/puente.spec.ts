import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, PROTOCOL, sample, sent } from "./host";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

test("anuncia engine.ready al cargar", async ({ page }) => {
  const [first] = await sent(page);
  expect(first).toMatchObject({
    kind: "event",
    name: "engine.ready",
    protocolVersion: PROTOCOL,
    payload: { engineVersion: version, protocolVersion: PROTOCOL },
  });
});

test("al hacer clic en un elemento envía selection.changed con su caja", async ({ page }) => {
  // Un clic selecciona el grupo de nivel superior que contiene el punto (ver seleccion.spec.ts).
  await page.locator("#sol").click();
  expect(await lastSent(page)).toMatchObject({
    name: "selection.changed",
    payload: {
      documentId: "d1",
      items: [{ id: "fondo", tagName: "g" }],
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      scope: null,
    },
  });

  await page.locator("#titulo").click({ modifiers: ["Control"] });
  expect(await lastSent(page)).toMatchObject({
    payload: { items: [{ id: "titulo", tagName: "text" }] },
  });
});

test("al hacer clic fuera del documento vacía la selección", async ({ page }) => {
  await page.locator("#sol").click();
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
    protocolVersion: PROTOCOL,
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

test("los archivos soltados sobre el lienzo se pasan a la aplicación con el mensaje", async ({
  page,
}) => {
  await page.evaluate(() => {
    const host = window as unknown as {
      chrome: { webview: Record<string, unknown> };
      __withObjects: unknown[];
    };
    host.__withObjects = [];
    host.chrome.webview.postMessageWithAdditionalObjects = (
      message: unknown,
      objects: unknown[],
    ) => {
      host.__withObjects.push({ message, names: [...objects].map((f) => (f as File).name) });
    };
  });

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["<svg/>"], "dibujo.svg", { type: "image/svg+xml" }));
    const workspace = document.getElementById("workspace");
    const over = new DragEvent("dragover", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    workspace?.dispatchEvent(over);
    if (!over.defaultPrevented) throw new Error("dragover no se canceló");
    workspace?.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  });

  const sent = await page.evaluate(
    () => (window as unknown as { __withObjects: unknown[] }).__withObjects,
  );
  expect(sent).toMatchObject([
    {
      message: { kind: "event", name: "files.dropped", payload: { count: 1 } },
      names: ["dibujo.svg"],
    },
  ]);
});
