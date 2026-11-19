import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Orden de apilado y grupos desde el lienzo y desde la aplicación, sobre el SVG de ejemplo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

/** Hijos de un elemento, por id. */
const childIds = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => [...element.children].map((child) => child.id || child.localName));

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

test("Ctrl+Mayús+RePág trae al frente y Ctrl+RePág/AvPág suben y bajan un nivel", async ({
  page,
}) => {
  await page.locator("#sol").dblclick();
  await page.keyboard.press("Control+Shift+PageUp");
  await expect
    .poll(() => childIds(page, "#fondo"))
    .toEqual(["cielo-fondo", "ola-1", "ola-2", "sol"]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "arrange" });
  await page.keyboard.press("Control+PageDown");
  await expect
    .poll(() => childIds(page, "#fondo"))
    .toEqual(["cielo-fondo", "ola-1", "sol", "ola-2"]);
  await page.keyboard.press("Control+Shift+PageDown");
  await expect
    .poll(() => childIds(page, "#fondo"))
    .toEqual(["sol", "cielo-fondo", "ola-1", "ola-2"]);
  while ((await lastHistory(page))?.undoAction) await page.keyboard.press("Control+Z");
  expect(await serialize(page)).toBe(sample);
});

test("Ctrl+G agrupa y Ctrl+Mayús+G desagrupa", async ({ page }) => {
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+G");
  await expect
    .poll(async () => (await childIds(page, "#workspace svg")).filter((id) => id === "g"))
    .toHaveLength(1);
  const selection = async () =>
    (
      (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as {
        items: { tagName: string }[];
      }
    ).items.map((item) => item.tagName);
  await expect.poll(selection).toEqual(["g"]);

  await page.keyboard.press("Control+Shift+G");
  await expect.poll(selection).toEqual(["g", "g"]);
  await page.keyboard.press("Control+Shift+G");
  // Los dos grupos del ejemplo se desagrupan: quedan sus ocho objetos.
  await expect.poll(async () => (await selection()).length).toBe(8);

  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+Z");
  expect(await serialize(page)).toBe(sample);
});

test("la aplicación ordena, agrupa y desagrupa con comandos", async ({ page }) => {
  // Un rectángulo no es un grupo: no hay nada que desagrupar.
  await page.locator("#tarjeta").click({ modifiers: ["Control"] });
  await hostSend(page, command("c-un0", "object.ungroup", { documentId: "d1" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-un0", payload: { changed: false } });

  await page.locator("#sol").click();
  await hostSend(page, command("c-front", "object.arrange", { documentId: "d1", action: "front" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-front", payload: { changed: true } });
  expect((await childIds(page, "#workspace svg")).slice(-1)).toEqual(["fondo"]);

  await hostSend(page, command("c-group", "object.group", { documentId: "d1" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-group", payload: { changed: true } });
  await hostSend(page, command("c-un", "object.ungroup", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-un", payload: { changed: true } });
});
