import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, openWithFakeHost, sent } from "./host";

/** Menú contextual del lienzo (issue #73): lo abre la aplicación con lo que le dice el motor. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

interface MenuRequest {
  x: number;
  y: number;
  keyboard: boolean;
  canEditVertices: boolean;
}

const lastMenu = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "canvas.contextMenu").at(-1)?.payload as
    MenuRequest | undefined;

const lastSelection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    { items: { id: string | null; tagName: string }[] } | undefined;

const center = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} no se ve`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("clic derecho sobre un objeto lo selecciona y pide el menú en ese punto", async ({ page }) => {
  const sun = await center(page, "#sol");
  await page.mouse.click(sun.x, sun.y, { button: "right" });

  await expect
    .poll(() => lastMenu(page))
    .toMatchObject({ keyboard: false, canEditVertices: false });
  const menu = await lastMenu(page);
  // El ratón va en píxeles enteros.
  expect(Math.abs((menu?.x ?? 0) - sun.x)).toBeLessThan(1);
  expect(Math.abs((menu?.y ?? 0) - sun.y)).toBeLessThan(1);
  // Como un clic: el objeto de nivel superior (el sol está dentro de g#fondo).
  expect((await lastSelection(page))?.items).toEqual([{ id: "fondo", tagName: "g" }]);
});

test("sobre un objeto ya seleccionado no cambia la selección", async ({ page }) => {
  await hostSend(page, command("c-all", "selection.selectAll", { documentId: "d1" }));
  await expect.poll(async () => (await lastSelection(page))?.items.length).toBe(2);
  const card = await center(page, "#tarjeta");
  await page.mouse.click(card.x, card.y, { button: "right" });
  await expect.poll(() => lastMenu(page)).toBeDefined();
  expect((await lastSelection(page))?.items).toHaveLength(2);
});

test("fuera del documento deselecciona", async ({ page }) => {
  await page.locator("#sol").click();
  await expect.poll(async () => (await lastSelection(page))?.items.length).toBe(1);
  await page.mouse.click(5, 5, { button: "right" });
  await expect.poll(() => lastMenu(page)).toBeDefined();
  await expect.poll(async () => (await lastSelection(page))?.items.length).toBe(0);
});

test("Mayús+F10 abre el menú junto a la selección", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await page.keyboard.press("Shift+F10");
  await expect.poll(() => lastMenu(page)).toMatchObject({ keyboard: true });
  const box = await page.locator("#sol").boundingBox();
  const menu = await lastMenu(page);
  expect(menu?.x).toBeCloseTo((box?.x ?? 0) + (box?.width ?? 0), -1);
});

test("una forma de segmentos rectos se puede editar por vértices desde el menú", async ({
  page,
}) => {
  await hostSend(page, command("c-tool", "tool.select", { tool: "polygon" }));
  const svg = page.locator("#workspace svg").first();
  const at = await svg.evaluate((element) => {
    const m = (element as SVGSVGElement).getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    return [new DOMPoint(30, 250).matrixTransform(m), new DOMPoint(30, 230).matrixTransform(m)];
  });
  const [from, to] = at;
  if (!from || !to) throw new Error("Sin puntos");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await hostSend(page, command("c-sel", "tool.select", { tool: "select" }));
  await page.mouse.click(from.x, from.y, { button: "right" });
  await expect.poll(() => lastMenu(page)).toMatchObject({ canEditVertices: true });
});

test("pegar desde el menú contextual pega donde se hizo clic derecho", async ({ page }) => {
  const card = await center(page, "#tarjeta");
  await page.mouse.click(card.x, card.y, { button: "right" });
  await expect.poll(() => lastMenu(page)).toBeDefined();
  // El puntero se va al menú (fuera de la página).
  await page.mouse.move(-10, -10);
  await hostSend(
    page,
    command("c-paste", "clipboard.paste", {
      documentId: "d1",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="pegado" width="10" height="10"/></svg>',
    }),
  );
  await expect(page.locator("#workspace [id^='pegado']")).toHaveCount(1);
  const pasted = await center(page, "#workspace [id^='pegado']");
  expect(Math.abs(pasted.x - card.x)).toBeLessThan(15);
  expect(Math.abs(pasted.y - card.y)).toBeLessThan(15);
});
