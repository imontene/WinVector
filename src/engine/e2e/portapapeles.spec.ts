import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Copiar, pegar, duplicar y eliminar con el bundle real y el puente simulado. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

const selection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    | {
        items: { id: string | null }[];
        bounds: { x: number; y: number; width: number; height: number } | null;
      }
    | undefined;

const respond = async (page: Page, id: string) => {
  await expect.poll(async () => (await lastSent(page))?.id).toBe(id);
  return (await lastSent(page))?.payload as Record<string, unknown>;
};

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  return ((await respond(page, "c-ser")) as { svg: string }).svg;
};

test("copiar y pegar desde la aplicación: desplazado si el puntero no está en el lienzo", async ({
  page,
}) => {
  await page.locator("#sol").dblclick();
  await hostSend(page, command("c-copy", "clipboard.copy", { documentId: "d1" }));
  const { svg } = (await respond(page, "c-copy")) as { svg: string };
  expect(svg).toContain('viewBox="248 44 104 104"');

  // El puntero sale de la página, como al usar el menú Editar.
  await page.mouse.move(-10, -10);
  await page.evaluate(() => {
    document.documentElement.dispatchEvent(new PointerEvent("pointerleave"));
  });
  await hostSend(page, command("c-paste", "clipboard.paste", { documentId: "d1", svg }));
  expect(await respond(page, "c-paste")).toMatchObject({ count: 1 });
  await expect
    .poll(async () => (await selection(page))?.items)
    .toEqual([{ id: "sol-2", tagName: "circle" }]);
  expect((await selection(page))?.bounds).toMatchObject({ x: 258, y: 54 });

  // Un segundo pegado del mismo contenido se desplaza otra vez.
  await hostSend(page, command("c-paste2", "clipboard.paste", { documentId: "d1", svg }));
  await respond(page, "c-paste2");
  await expect.poll(async () => (await selection(page))?.bounds).toMatchObject({ x: 268, y: 64 });
});

test("con el puntero sobre el lienzo, se pega centrado en él", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await hostSend(page, command("c-copy", "clipboard.copy", { documentId: "d1" }));
  const { svg } = (await respond(page, "c-copy")) as { svg: string };
  const box = await page.locator("#tarjeta").boundingBox();
  if (!box) throw new Error("La tarjeta no se ve");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await hostSend(page, command("c-paste", "clipboard.paste", { documentId: "d1", svg }));
  await respond(page, "c-paste");
  const bounds = (await selection(page))?.bounds;
  // La tarjeta va de (48, 58) a (198, 146): su centro es (123, 102).
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0) / 2).toBeCloseTo(123, 0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0) / 2).toBeCloseTo(102, 0);
});

test("Ctrl+D duplica, Supr elimina, y todo se deshace", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await page.keyboard.press("Control+D");
  await expect
    .poll(async () => (await selection(page))?.items)
    .toEqual([{ id: "sol-2", tagName: "circle" }]);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await selection(page))?.items).toEqual([]);
  expect(await page.locator("#sol-2").count()).toBe(0);
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  expect(await serialize(page)).toBe(sample);
});

test("Ctrl+C, Ctrl+X y Ctrl+V se envían a la aplicación, que es la dueña del portapapeles", async ({
  page,
}) => {
  await page.locator("#sol").click();
  for (const key of ["c", "x", "v"]) await page.keyboard.press(`Control+${key.toUpperCase()}`);
  const forwarded = (await sent(page))
    .filter((m) => m.name === "keyboard.shortcut")
    .map((m) => (m.payload as { key: string }).key);
  expect(forwarded).toEqual(["c", "x", "v"]);
});

test("la aplicación duplica y elimina con comandos", async ({ page }) => {
  await page.locator("#sol").click();
  await hostSend(page, command("c-dup", "selection.duplicate", { documentId: "d1" }));
  expect(await respond(page, "c-dup")).toMatchObject({ changed: true });
  await hostSend(page, command("c-del", "selection.delete", { documentId: "d1" }));
  expect(await respond(page, "c-del")).toMatchObject({ changed: true });
  await hostSend(page, command("c-del2", "selection.delete", { documentId: "d1" }));
  expect(await respond(page, "c-del2")).toMatchObject({ changed: false });
});
