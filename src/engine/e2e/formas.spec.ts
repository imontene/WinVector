import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Herramientas de forma (issue #55): crear arrastrando, con modificadores, cancelar y deshacer. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

interface Point {
  x: number;
  y: number;
}

/** Punto de la pantalla de unas coordenadas del documento (las del viewBox). */
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

/** Píxeles de pantalla por unidad del documento. */
const scale = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) => (svg as SVGSVGElement).getScreenCTM()?.a ?? 1);

const selectTool = (page: Page, tool: string) =>
  hostSend(page, command(`c-tool-${tool}`, "tool.select", { tool }));

/** Arrastra entre dos puntos del documento, con las teclas indicadas pulsadas. */
async function drawDrag(page: Page, from: Point, to: Point, keys: string[] = []) {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  for (const key of keys) await page.keyboard.up(key);
}

/** Rectángulos creados: los que no estaban en el ejemplo. */
const created = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) =>
      [...svg.querySelectorAll("rect:not([id])")].map((rect) => ({
        parent: rect.parentElement?.id ?? "",
        ...Object.fromEntries([...rect.attributes].map((a) => [a.name, a.value])),
      })),
    ) as Promise<Record<string, string>[]>;

const number = (value: string | undefined) => Number(value ?? NaN);

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

test("arrastrar con el rectángulo lo crea seleccionado, en un paso que se deshace", async ({
  page,
}) => {
  // Tolerancia de un píxel de pantalla en unidades del documento.
  const tolerance = 1 / (await scale(page)) + 0.01;
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 20, y: 20 }, { x: 60, y: 50 });

  const [rect] = await created(page);
  expect(rect).toBeDefined();
  expect(Math.abs(number(rect?.x) - 20)).toBeLessThan(tolerance);
  expect(Math.abs(number(rect?.y) - 20)).toBeLessThan(tolerance);
  expect(Math.abs(number(rect?.width) - 40)).toBeLessThan(tolerance);
  expect(Math.abs(number(rect?.height) - 30)).toBeLessThan(tolerance);
  // Último estilo usado: al principio, relleno blanco y trazo negro.
  expect(rect).toMatchObject({
    parent: "",
    fill: "#ffffff",
    stroke: "#000000",
    "stroke-width": "1",
  });

  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-rectangle" });
  const selection = (await sent(page)).filter((m) => m.name === "selection.changed").at(-1);
  expect(selection?.payload).toMatchObject({ items: [{ tagName: "rect" }] });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => created(page)).toHaveLength(0);
  expect(await serialize(page)).toBe(sample);
});

test("con Mayús es un cuadrado y con Alt se dibuja desde el centro", async ({ page }) => {
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 20, y: 20 }, { x: 60, y: 30 }, ["Shift"]);
  await drawDrag(page, { x: 200, y: 200 }, { x: 220, y: 210 }, ["Alt"]);

  const [square, centered] = await created(page);
  expect(number(square?.width)).toBe(number(square?.height));
  expect(number(square?.width)).toBeGreaterThan(35);
  // Desde el centro: el punto inicial queda en medio.
  expect(number(centered?.x) + number(centered?.width) / 2).toBeCloseTo(200, 0);
  expect(number(centered?.y) + number(centered?.height) / 2).toBeCloseTo(200, 0);
  expect(number(centered?.width)).toBeGreaterThan(38);
});

test("Esc cancela el arrastre y un clic sin arrastrar no crea nada", async ({ page }) => {
  await selectTool(page, "rectangle");
  const a = await toScreen(page, 20, 20);
  const b = await toScreen(page, 80, 80);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect.poll(() => created(page)).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => created(page)).toHaveLength(0);
  await page.mouse.up();

  await page.mouse.click(b.x, b.y);
  expect(await created(page)).toHaveLength(0);
  expect((await lastHistory(page))?.canUndo ?? false).toBe(false);
  expect(await serialize(page)).toBe(sample);
});

test("la forma nace dentro del grupo en el que se ha entrado", async ({ page }) => {
  // Doble clic en la tarjeta: entra en g#contenido.
  await page.locator("#tarjeta").dblclick();
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 60, y: 160 }, { x: 120, y: 200 });

  const [rect] = await created(page);
  expect(rect?.parent).toBe("contenido");
});

test("la forma nace con el último estilo usado", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await hostSend(
    page,
    command("c-style", "selection.setStyle", {
      documentId: "d1",
      fill: "#ff0000",
      stroke: "none",
      strokeWidth: null,
      opacity: null,
    }),
  );
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 20, y: 200 }, { x: 60, y: 240 });

  const [rect] = await created(page);
  expect(rect).toMatchObject({ fill: "#ff0000", stroke: "none", "stroke-width": "1" });
});

test("con el ajuste a la cuadrícula, las esquinas caen en la cuadrícula", async ({ page }) => {
  await hostSend(
    page,
    command("c-opt", "view.setOptions", { showRulers: false, showGrid: true, snapToGrid: true }),
  );
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 21.3, y: 22.7 }, { x: 63.6, y: 48.2 });

  const [rect] = await created(page);
  for (const name of ["x", "y", "width", "height"]) {
    expect(Number.isInteger(number(rect?.[name])), `${name} = ${String(rect?.[name])}`).toBe(true);
  }
});

test("R elige el rectángulo y lo anuncia; con él, el clic no selecciona", async ({ page }) => {
  await page.locator("#sol").click();
  await page.keyboard.press("r");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "rectangle" } });
  const before = (await sent(page)).filter((m) => m.name === "selection.changed").length;
  await page.locator("#tarjeta").click();
  await page.locator("#tarjeta").dblclick();
  expect((await sent(page)).filter((m) => m.name === "selection.changed")).toHaveLength(before);
});
