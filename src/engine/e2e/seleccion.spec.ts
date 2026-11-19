import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/**
 * Herramienta Selección con el ratón y el teclado reales, sobre el SVG de ejemplo:
 * `g#fondo` (cielo, sol y olas) y `g#contenido` (tarjeta, título y dos líneas).
 */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

interface SelectionPayload {
  items: { id: string | null; tagName: string }[];
  scope: { id: string | null } | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

async function selection(page: Page): Promise<{ ids: (string | null)[]; scope: string | null }> {
  const messages = await sent(page);
  const last = messages.filter((m) => m.name === "selection.changed").at(-1);
  const payload = last?.payload as SelectionPayload | undefined;
  return {
    ids: payload?.items.map((item) => item.id) ?? [],
    scope: payload?.scope?.id ?? null,
  };
}

const expectSelection = (page: Page, ids: string[], scope: string | null = null) =>
  expect.poll(() => selection(page)).toEqual({ ids, scope });

test("un clic selecciona el grupo de nivel superior y lo marca en la capa", async ({ page }) => {
  await page.locator("#sol").click();
  await expectSelection(page, ["fondo"]);
  await expect(page.locator(".overlay .overlay-item")).toHaveCount(1);
});

test("doble clic entra en el grupo y Esc sale", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await expectSelection(page, ["sol"], "fondo");
  await expect(page.locator(".overlay .overlay-scope")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expectSelection(page, [], "fondo");
  await page.keyboard.press("Escape");
  await expectSelection(page, ["fondo"]);
  await expect(page.locator(".overlay .overlay-scope")).toHaveCount(0);
});

test("dentro de un grupo, un clic en otro grupo vuelve al nivel superior", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await page.locator("#tarjeta").click();
  await expectSelection(page, ["contenido"]);
});

test("Mayús+clic añade y quita", async ({ page }) => {
  await page.locator("#sol").click();
  await page.locator("#titulo").click({ modifiers: ["Shift"] });
  await expectSelection(page, ["fondo", "contenido"]);
  await expect(page.locator(".overlay .overlay-bounds")).toHaveCount(1);

  await page.locator("#sol").click({ modifiers: ["Shift"] });
  await expectSelection(page, ["contenido"]);
});

test("Ctrl+clic selecciona el objeto más profundo", async ({ page }) => {
  await page.locator("#linea-1").click({ modifiers: ["Control"] });
  await expectSelection(page, ["linea-1"]);
});

test("el marco selecciona los objetos que quedan enteros dentro", async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Sin tamaño de ventana");
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 4 });
  await expect(page.locator(".overlay .overlay-marquee")).toHaveCount(1);
  await page.mouse.move(viewport.width - 2, viewport.height - 2, { steps: 4 });
  await page.mouse.up();

  await expectSelection(page, ["fondo", "contenido"]);
  await expect(page.locator(".overlay .overlay-marquee")).toHaveCount(0);
});

test("dentro de un grupo, el marco elige entre sus hijos", async ({ page }) => {
  await page.locator("#titulo").dblclick();
  const line1 = await page.locator("#linea-1").boundingBox();
  const line2 = await page.locator("#linea-2").boundingBox();
  if (!line1 || !line2) throw new Error("Las líneas no se ven");
  // El cielo cubre toda la mesa de trabajo: el marco empieza fuera de ella. Termina justo después
  // de las líneas, así que la tarjeta, más grande, queda fuera.
  await page.mouse.move(2, 2);
  await page.mouse.down();
  await page.mouse.move(line1.x + line1.width + 3, line2.y + line2.height + 3, { steps: 5 });
  await page.mouse.up();
  await expectSelection(page, ["titulo", "linea-1", "linea-2"], "contenido");
});

test("Ctrl+A selecciona todo el grupo actual", async ({ page }) => {
  await page.locator("#sol").click();
  await page.keyboard.press("Control+A");
  await expectSelection(page, ["fondo", "contenido"]);

  await page.locator("#titulo").dblclick();
  await page.keyboard.press("Control+A");
  await expectSelection(page, ["tarjeta", "titulo", "linea-1", "linea-2"], "contenido");
});

test("la aplicación puede pedir seleccionar todo", async ({ page }) => {
  await hostSend(page, command("c-all", "selection.selectAll", { documentId: "d1" }));
  await expectSelection(page, ["fondo", "contenido"]);
});

test("un clic en el fondo vacía la selección y vuelve al nivel superior", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await page.mouse.click(2, 2);
  await expectSelection(page, []);
});

test("la capa de superposición nunca se guarda con el documento", async ({ page }) => {
  await page.keyboard.press("Control+A");
  await page.locator("#sol").dblclick();
  await expect(page.locator(".overlay .overlay-item")).toHaveCount(1);

  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-ser", ok: true, payload: { svg: sample, revision: 0 } });
});

test("la caja de la selección está en unidades del documento", async ({ page }) => {
  await page.locator("#sol").dblclick();
  const messages = await sent(page);
  const last = messages.filter((m) => m.name === "selection.changed").at(-1);
  expect((last?.payload as SelectionPayload).bounds).toEqual({
    x: 248,
    y: 44,
    width: 104,
    height: 104,
  });
});
