import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, openWithFakeHost, sent } from "./host";

/** Herramienta Degradado (issue #110) sobre el SVG de ejemplo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

interface Point {
  x: number;
  y: number;
}

let counter = 0;

async function send(page: Page, name: string, payload: object) {
  const id = `c-h${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId: "d1", ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

const tarjeta = (page: Page) => page.locator("#workspace #tarjeta");

/** Punto del documento (viewBox 400 × 300) en pantalla. */
const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  tarjeta(page).evaluate(
    (element, p) => {
      const m = (element as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
      if (!m) throw new Error("Sin CTM");
      return new DOMPoint(p.x, p.y).matrixTransform(m);
    },
    { x, y },
  );

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

const attributes = (page: Page, selector: string, names: string[]) =>
  page
    .locator(`#workspace ${selector}`)
    .evaluate((g, list) => list.map((name) => Number(g.getAttribute(name))), names);

const undoAction = async (page: Page) =>
  (
    (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
      { undoAction: string | null } | undefined
  )?.undoAction;

/** Elige la herramienta con su atajo y le pone a la tarjeta un degradado de 60 a 180 (y = 100). */
async function withGradient(page: Page) {
  await page.locator("#workspace").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("d");
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.name === "tool.changed").at(-1)?.payload)
    .toEqual({ tool: "gradient" });
  await drag(page, await toScreen(page, 60, 100), await toScreen(page, 180, 100));
  await expect(page.locator("#workspace #degradado")).toHaveCount(1);
}

test("arrastrar sobre un objeto le pone un degradado entre los dos puntos", async ({ page }) => {
  await withGradient(page);
  const [x1, y1, x2, y2] = await attributes(page, "#degradado", ["x1", "y1", "x2", "y2"]);
  expect(x1).toBeCloseTo(60, 0);
  expect(y1).toBeCloseTo(100, 0);
  expect(x2).toBeCloseTo(180, 0);
  expect(y2).toBeCloseTo(100, 0);
  expect(await tarjeta(page).getAttribute("fill")).toBe("url(#degradado)");
  await expect(page.locator(".overlay .overlay-gradient-start")).toHaveCount(1);
  await expect(page.locator(".overlay .overlay-gradient-end")).toHaveCount(1);
  await expect(page.locator(".overlay .overlay-gradient-stop")).toHaveCount(2);
  await expect.poll(() => undoAction(page)).toBe("gradient");

  // Todo es un paso: deshacer quita el degradado.
  await send(page, "history.undo", {});
  expect(await tarjeta(page).getAttribute("fill")).toBe("#ffffff");
});

test("arrastrar el extremo lo mueve; con Mayús, de 15° en 15°", async ({ page }) => {
  await withGradient(page);
  await drag(page, await toScreen(page, 180, 100), await toScreen(page, 150, 130));
  const [x2, y2] = await attributes(page, "#degradado", ["x2", "y2"]);
  expect(x2).toBeCloseTo(150, 0);
  expect(y2).toBeCloseTo(130, 0);

  await page.keyboard.down("Shift");
  await drag(page, await toScreen(page, 150, 130), await toScreen(page, 170, 104));
  await page.keyboard.up("Shift");
  const [, y1, , y2Snapped] = await attributes(page, "#degradado", ["x1", "y1", "x2", "y2"]);
  expect(y2Snapped).toBeCloseTo(y1 ?? NaN, 0);
});

test("doble clic en la línea añade una parada, se arrastra y Supr la quita", async ({ page }) => {
  await withGradient(page);
  const middle = await toScreen(page, 120, 100);
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(page.locator("#workspace #degradado stop")).toHaveCount(3);

  // Arrastrar la parada nueva hacia la derecha.
  await drag(page, middle, await toScreen(page, 150, 100));
  const offsets = await page
    .locator("#workspace #degradado stop")
    .evaluateAll((stops) => stops.map((s) => Number(s.getAttribute("offset"))));
  expect(offsets[1]).toBeCloseTo(0.75, 1);
  await expect(page.locator(".overlay .overlay-gradient-stop-selected")).toHaveCount(1);

  await page.keyboard.press("Delete");
  await expect(page.locator("#workspace #degradado stop")).toHaveCount(2);
  // Con dos paradas, Supr no borra ninguna ni borra el objeto.
  await page.keyboard.press("Delete");
  await expect(page.locator("#workspace #degradado stop")).toHaveCount(2);
  await expect(tarjeta(page)).toHaveCount(1);
});

test("un radial se mueve por el centro y cambia de tamaño por su radio", async ({ page }) => {
  await withGradient(page);
  await send(page, "selection.setGradient", { property: "fill", kind: "radial" });
  // Al pasar a radial cubre la tarjeta: centro (123, 102) y radio 75.
  await expect(page.locator(".overlay .overlay-gradient-center")).toHaveCount(1);
  await drag(page, await toScreen(page, 123, 102), await toScreen(page, 113, 92));
  await drag(page, await toScreen(page, 188, 92), await toScreen(page, 153, 92));
  const [cx, cy, r] = await attributes(page, "#degradado", ["cx", "cy", "r"]);
  expect(cx).toBeCloseTo(113, 0);
  expect(cy).toBeCloseTo(92, 0);
  expect(r).toBeCloseTo(40, 0);
});

test("un clic sin arrastrar no deja paso; con Alt, el degradado va al trazo", async ({ page }) => {
  await withGradient(page);
  const before = (await sent(page)).filter((m) => m.name === "history.changed").length;
  const start = await toScreen(page, 60, 100);
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(100);
  expect((await sent(page)).filter((m) => m.name === "history.changed").length).toBe(before);

  await page.keyboard.down("Alt");
  await drag(page, await toScreen(page, 100, 70), await toScreen(page, 100, 140));
  await page.keyboard.up("Alt");
  expect(await tarjeta(page).getAttribute("stroke")).toBe("url(#degradado-2)");
  await expect(page.locator(".overlay .overlay-gradient-line")).toHaveCount(2);
  await expect(page.locator(".overlay .overlay-gradient-line.overlay-gradient-stroke")).toHaveCount(
    1,
  );
});
