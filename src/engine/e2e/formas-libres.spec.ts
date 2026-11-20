import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Formas libres de líneas rectas con la pluma (issue #62). */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(page, command("c-pen", "tool.select", { tool: "pen" }));
});

interface Point {
  x: number;
  y: number;
}

const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate(
      (svg, p) => {
        const m = (svg as SVGSVGElement).getScreenCTM();
        if (!m) throw new Error("Sin CTM");
        return new DOMPoint(p.x, p.y).matrixTransform(m);
      },
      { x, y },
    );

async function clickAt(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Formas creadas: polígonos y polilíneas sin identificador. */
const created = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) =>
      [...svg.querySelectorAll("polygon:not([id]), polyline:not([id])")].map((e) => ({
        tag: e.localName,
        points: e.getAttribute("points")?.split(" ").length ?? 0,
        fill: e.getAttribute("fill"),
        stroke: e.getAttribute("stroke"),
      })),
    );

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

test("un clic en el primer vértice cierra la forma: un polígono con el estilo", async ({
  page,
}) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 80, 20);
  await clickAt(page, 50, 70);
  // Cerca del primer vértice, el indicador avisa de que se cerrará.
  const first = await toScreen(page, 20, 20);
  await page.mouse.move(first.x + 2, first.y + 1);
  await expect(page.locator(".overlay .overlay-pen-closing")).toHaveCount(1);
  await page.mouse.click(first.x + 2, first.y + 1);

  expect(await created(page)).toEqual([
    { tag: "polygon", points: 3, fill: "#ffffff", stroke: "#000000" },
  ]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-polygon" });
  const selection = (await sent(page))
    .filter((m) => m.name === "selection.changed")
    .at(-1)?.payload;
  expect(selection).toMatchObject({ items: [{ tagName: "polygon" }] });
  await expect(page.locator(".overlay .overlay-pen-start")).toHaveCount(0);

  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page)).toBe(sample);
});

test("doble clic la termina abierta: una polilínea con trazo y sin relleno", async ({ page }) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 80, 20);
  const end = await toScreen(page, 80, 80);
  await page.mouse.dblclick(end.x, end.y);

  expect(await created(page)).toEqual([
    { tag: "polyline", points: 3, fill: "none", stroke: "#000000" },
  ]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-polyline" });
});

test("Retroceso quita el último vértice, Intro termina y Esc cancela", async ({ page }) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 80, 20);
  await clickAt(page, 80, 80);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  expect(await created(page)).toEqual([
    { tag: "polyline", points: 2, fill: "none", stroke: "#000000" },
  ]);

  await page.keyboard.press("Control+Z");
  await clickAt(page, 120, 120);
  await clickAt(page, 160, 120);
  await page.keyboard.press("Escape");
  expect(await created(page)).toHaveLength(0);
  expect((await lastHistory(page))?.canUndo).toBe(false);
  expect(await serialize(page)).toBe(sample);
});

test("con Mayús el segmento va de 15° en 15°", async ({ page }) => {
  await clickAt(page, 20, 100);
  const p = await toScreen(page, 100, 104);
  await page.keyboard.down("Shift");
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Shift");
  await page.keyboard.press("Enter");
  const points = await page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) => svg.querySelector("polyline:not([id])")?.getAttribute("points") ?? "");
  const [[, y1], [, y2]] = points.split(" ").map((xy) => xy.split(",").map(Number)) as [
    number[],
    number[],
  ];
  expect(y2).toBe(y1);
});

test("cambiar de herramienta termina la forma a medias y P elige la pluma", async ({ page }) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 80, 20);
  await page.keyboard.press("v");
  await expect.poll(async () => (await created(page)).length).toBe(1);

  await page.keyboard.press("p");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "pen" } });
});
