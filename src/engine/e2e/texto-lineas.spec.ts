import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Varias líneas, navegación y selección de texto (issue #94). */

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect id="papel" width="400" height="300" fill="#eef"/>
  <text id="tres" x="40" y="60" font-family="sans-serif" font-size="20" xml:space="preserve"><tspan x="40" y="60">hola mundo</tspan><tspan x="40" y="84"></tspan><tspan x="40" y="108">pulgar 👍🏽 arriba</tspan></text>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "lineas", svg: DOC }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-act2"))
    .toMatchObject({ ok: true });
  await page.keyboard.press("t");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "text" } });
});

/**
 * Punto de la pantalla en la mitad del carácter `index` del texto, con la numeración del SVG: en
 * unidades UTF-16 y sin saltos de línea (la del campo de texto sí los cuenta).
 */
const charPoint = (page: Page, index: number) =>
  page.locator("#workspace #tres").evaluate((t, i) => {
    const text = t as SVGTextElement;
    const extent = text.getExtentOfChar(i);
    const m = text.getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const p = new DOMPoint(
      extent.x + extent.width / 2,
      extent.y + extent.height / 2,
    ).matrixTransform(m);
    return { x: p.x, y: p.y };
  }, index);

/** Selección del campo de texto de la edición (índices con saltos de línea). */
const selection = (page: Page) =>
  page.locator(".text-input").evaluate((input) => {
    const area = input as HTMLTextAreaElement;
    return [area.selectionStart, area.selectionEnd];
  });

const lines = (page: Page) =>
  page
    .locator("#workspace #tres")
    .evaluate((t) => [...t.querySelectorAll("tspan")].map((s) => s.textContent));

// En el campo de texto, "hola mundo\n\npulgar 👍🏽 arriba": la tercera línea empieza en 12 y el
// emoji con su tono de piel son 4 unidades UTF-16 (de 19 a 23). En el SVG, sin saltos de línea,
// la tercera línea empieza en 10 y el emoji va de 17 a 21.
const THIRD = 12;
const SVG_THIRD = 10;

test("las flechas pasan por la línea vacía y Mayús+Inicio selecciona hasta el principio", async ({
  page,
}) => {
  const p = await charPoint(page, SVG_THIRD + 3);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("ArrowUp");
  // La línea vacía solo tiene un sitio para el cursor.
  expect(await selection(page)).toEqual([11, 11]);
  await page.keyboard.press("ArrowUp");
  const [onFirst] = await selection(page);
  expect(onFirst).toBeGreaterThanOrEqual(0);
  expect(onFirst).toBeLessThanOrEqual(10);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  expect(await selection(page)).toEqual([0, 10]);
  await expect(page.locator(".overlay .overlay-text-selection")).toHaveCount(1);

  // Escribir sustituye la selección, y las líneas (también la vacía) se conservan.
  await page.keyboard.type("adiós");
  await page.keyboard.press("Escape");
  expect(await lines(page)).toEqual(["adiós", "", "pulgar 👍🏽 arriba"]);
});

test("doble clic selecciona una palabra y triple clic la línea", async ({ page }) => {
  const p = await charPoint(page, 6);
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  expect(await selection(page)).toEqual([5, 10]);
  await page.mouse.click(p.x, p.y);
  expect(await selection(page)).toEqual([0, 10]);
});

test("Mayús+flechas abajo seleccionan varias líneas, con un rectángulo por línea", async ({
  page,
}) => {
  const p = await charPoint(page, 2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  const [start, end] = await selection(page);
  expect(start).toBeLessThanOrEqual(3);
  expect(end).toBeGreaterThan(THIRD);
  // La primera y la tercera línea tienen texto seleccionado; la vacía no dibuja nada.
  await expect(page.locator(".overlay .overlay-text-selection")).toHaveCount(2);
});

test("el cursor nunca queda en medio de un emoji", async ({ page }) => {
  // Clic en cada mitad de cada unidad UTF-16 del emoji: el cursor va antes o después, no dentro.
  for (const unit of [17, 18, 19, 20]) {
    const p = await charPoint(page, unit);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    const [caret] = await selection(page);
    expect([19, 23]).toContain(caret);
  }
  // Las flechas tampoco: el campo de texto avanza por grafemas.
  const before = await charPoint(page, 17);
  await page.mouse.click(before.x - 8, before.y);
  await page.waitForTimeout(600);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect((await selection(page))[0]).toBe(23);
  await page.keyboard.press("ArrowLeft");
  expect((await selection(page))[0]).toBe(19);
});
