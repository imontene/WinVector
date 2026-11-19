import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Mover, escalar y girar con la herramienta Selección, sobre el SVG de ejemplo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

const attribute = (page: Page, id: string, name: string) =>
  page.locator(`#${id}`).evaluate((element, n) => element.getAttribute(n), name);

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const center = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} no se ve`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Píxeles de pantalla por unidad del documento. */
const scale = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) => (svg as SVGSVGElement).getScreenCTM()?.a ?? 1);

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Selecciona el sol: doble clic entra en g#fondo y selecciona el círculo. */
async function selectSun(page: Page) {
  await page.locator("#sol").dblclick();
  await expect(page.locator(".overlay .overlay-handle")).toHaveCount(9);
}

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

test("arrastrar un objeto lo mueve en un solo paso que se deshace", async ({ page }) => {
  await selectSun(page);
  const k = await scale(page);
  const sun = await center(page, "#sol");
  await drag(page, sun, { x: sun.x - 50 * k, y: sun.y + 20 * k });

  expect(Number(await attribute(page, "sol", "cx"))).toBeCloseTo(250, 0);
  expect(Number(await attribute(page, "sol", "cy"))).toBeCloseTo(116, 0);
  expect(await attribute(page, "sol", "transform")).toBeNull();
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "move" });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => attribute(page, "sol", "cx")).toBe("300");
  expect(await serialize(page)).toBe(sample);
});

test("al arrastrar un objeto sin seleccionar, se selecciona y se mueve", async ({ page }) => {
  const k = await scale(page);
  // Un clic en el sol selecciona g#fondo; arrastrarlo mueve el grupo entero.
  const sun = await center(page, "#sol");
  await drag(page, sun, { x: sun.x + 10 * k, y: sun.y });
  const [dx, dy] =
    /^translate\(([^ ]+) ([^ )]+)\)$/
      .exec((await attribute(page, "fondo", "transform")) ?? "")
      ?.slice(1)
      .map(Number) ?? [];
  // El ratón se mueve en píxeles enteros: el desplazamiento en unidades puede tener decimales.
  expect(dx).toBeCloseTo(10, 1);
  expect(dy).toBe(0);
});

test("las flechas mueven 1 unidad, 10 con Mayús, y las pulsaciones seguidas son un paso", async ({
  page,
}) => {
  await selectSun(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await attribute(page, "sol", "cx")).toBe("303");
  expect(await attribute(page, "sol", "cy")).toBe("106");

  await page.keyboard.press("Control+Z");
  await expect.poll(() => attribute(page, "sol", "cx")).toBe("300");
  expect(await attribute(page, "sol", "cy")).toBe("96");
});

test("el manejador de una esquina escala; con Mayús, de forma proporcional", async ({ page }) => {
  await selectSun(page);
  const k = await scale(page);
  const corner = await center(page, '.overlay [data-handle="se"]');
  await page.keyboard.down("Shift");
  await drag(page, corner, { x: corner.x + 52 * k, y: corner.y + 10 * k });
  await page.keyboard.up("Shift");

  // El sol (r=52, caja de 104) crece hasta 156 de ancho con la esquina opuesta fija.
  expect(Number(await attribute(page, "sol", "r"))).toBeCloseTo(78, 0);
  expect(Number(await attribute(page, "sol", "cx"))).toBeCloseTo(326, 0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "scale" });
});

test("con Alt, se escala desde el centro", async ({ page }) => {
  await selectSun(page);
  const k = await scale(page);
  const side = await center(page, '.overlay [data-handle="e"]');
  await page.keyboard.down("Alt");
  await drag(page, side, { x: side.x + 52 * k, y: side.y });
  await page.keyboard.up("Alt");
  // Escala desigual: el círculo pasa a transform, con el centro en su sitio.
  const box = await page.locator("#sol").evaluate((circle) => {
    const root = (circle as SVGGraphicsElement).ownerSVGElement;
    const m = root
      ?.getScreenCTM()
      ?.inverse()
      .multiply((circle as SVGGraphicsElement).getScreenCTM() ?? new DOMMatrix());
    const b = (circle as SVGGraphicsElement).getBBox();
    const p1 = new DOMPoint(b.x, b.y).matrixTransform(m);
    const p2 = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
    return { x: p1.x, width: p2.x - p1.x };
  });
  expect(box.width).toBeCloseTo(208, 0);
  expect(box.x + box.width / 2).toBeCloseTo(300, 0);
});

test("el manejador de giro gira la selección; con Mayús, de 15 en 15 grados", async ({ page }) => {
  await selectSun(page);
  const rotate = await center(page, ".overlay .overlay-handle-rotate");
  const sun = await center(page, "#sol");
  // Del punto de arriba al de la derecha: 90° en el sentido de las agujas del reloj (con un poco de
  // desvío que Mayús redondea).
  await page.keyboard.down("Shift");
  await drag(page, rotate, { x: sun.x + (sun.y - rotate.y), y: sun.y + 6 });
  await page.keyboard.up("Shift");
  const transform = await attribute(page, "sol", "transform");
  expect(transform).toMatch(/^matrix\(0 1 -1 0 /);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "rotate" });
});

test("Esc durante un arrastre lo cancela sin dejar ningún paso", async ({ page }) => {
  await selectSun(page);
  const sun = await center(page, "#sol");
  await page.mouse.move(sun.x, sun.y);
  await page.mouse.down();
  await page.mouse.move(sun.x + 80, sun.y + 40, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await attribute(page, "sol", "cx")).toBe("300");
  expect(await serialize(page)).toBe(sample);
  expect((await lastHistory(page))?.canUndo ?? false).toBe(false);
});

test("con el ajuste a la cuadrícula, mover deja la esquina sobre la cuadrícula", async ({
  page,
}) => {
  await hostSend(
    page,
    command("c-opt", "view.setOptions", { showRulers: true, showGrid: true, snapToGrid: true }),
  );
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-opt", ok: true });
  await selectSun(page);
  const k = await scale(page);
  const sun = await center(page, "#sol");
  await drag(page, sun, { x: sun.x + 13.3 * k, y: sun.y + 7.7 * k });
  const left = Number(await attribute(page, "sol", "cx")) - 52;
  const top = Number(await attribute(page, "sol", "cy")) - 52;
  // La separación de la cuadrícula depende del zoom: 5 o 10 unidades a este tamaño.
  const spacing = left % 10 === 0 && top % 10 === 0 ? 10 : 5;
  expect(left % spacing).toBe(0);
  expect(top % spacing).toBe(0);
});
