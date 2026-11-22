import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Transformar texto y accesibilidad de la edición (issue #98). */

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <text id="normal" x="40" y="60" font-family="sans-serif" font-size="20"><tspan x="40" y="60">uno</tspan><tspan x="40" y="84">dos</tspan></text>
  <text id="girado" x="200" y="120" font-family="sans-serif" font-size="20" transform="rotate(30 200 120)">girado</text>
  <text id="hebreo" x="40" y="220" font-family="sans-serif" font-size="24">שלום</text>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "transformar", svg: DOC }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-act2"))
    .toMatchObject({ ok: true });
});

let counter = 0;

async function send(page: Page, name: string, payload: object) {
  const id = `c-t${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId: "d2", ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

/** Punto de la pantalla de un carácter de un texto (mitad horizontal, sobre la línea base). */
const charPoint = (page: Page, id: string, index: number) =>
  page.locator(`#workspace #${id}`).evaluate((t, i) => {
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

const attribute = (page: Page, selector: string, name: string) =>
  page.locator(`#workspace ${selector}`).evaluate((e, n) => e.getAttribute(n), name);

async function select(page: Page, id: string) {
  const p = await charPoint(page, id, 0);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.name === "selection.changed").at(-1))
    .toMatchObject({ payload: { items: [{ id }] } });
}

async function useTextTool(page: Page) {
  await page.keyboard.press("t");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "text" } });
}

test("escalar un texto en proporción cambia su tamaño de fuente, sin transform", async ({
  page,
}) => {
  await select(page, "normal");
  const bounds = (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)
    ?.payload as {
    bounds: { width: number; height: number };
  };
  await send(page, "selection.setGeometry", {
    x: null,
    y: null,
    width: bounds.bounds.width * 2,
    height: bounds.bounds.height * 2,
    rotation: null,
  });
  expect(await attribute(page, "#normal", "transform")).toBeNull();
  expect(Number(await attribute(page, "#normal", "font-size"))).toBeCloseTo(40, 1);
  // Las líneas conservan su interlineado proporcional.
  const ys = await page
    .locator("#workspace #normal tspan")
    .evaluateAll((spans) => spans.map((s) => Number(s.getAttribute("y"))));
  expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBeCloseTo(48, 1);
});

test("escalar un texto sin proporción escribe un transform", async ({ page }) => {
  await select(page, "normal");
  const bounds = (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)
    ?.payload as {
    bounds: { width: number };
  };
  await send(page, "selection.setGeometry", {
    x: null,
    y: null,
    width: bounds.bounds.width * 2,
    height: null,
    rotation: null,
  });
  expect(await attribute(page, "#normal", "transform")).toMatch(/^matrix/);
  expect(await attribute(page, "#normal", "font-size")).toBe("20");
});

test("un texto girado se edita en el lienzo; el campo de texto tiene nombre", async ({ page }) => {
  await useTextTool(page);
  const end = await charPoint(page, "girado", 5);
  await page.mouse.click(end.x, end.y);
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(1);
  // El campo que recibe el teclado es un cuadro de texto con nombre para el lector de pantalla.
  await expect(page.getByRole("textbox", { name: "Texto" })).toHaveCount(1);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  expect(await page.locator("#workspace #girado").textContent()).toBe("girado!");
  expect(await attribute(page, "#girado", "transform")).toBe("rotate(30 200 120)");
});

test("en un texto de derecha a izquierda, el clic coloca el cursor en el carácter correcto", async ({
  page,
}) => {
  await useTextTool(page);
  // Hebreo: el primer carácter del texto se dibuja a la derecha.
  const first = await charPoint(page, "hebreo", 0);
  const last = await charPoint(page, "hebreo", 3);
  expect(first.x).toBeGreaterThan(last.x);
  await page.mouse.click(first.x + 4, first.y);
  const caret = () =>
    page.locator(".text-input").evaluate((input) => (input as HTMLTextAreaElement).selectionStart);
  expect(await caret()).toBe(0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.mouse.click(last.x - 4, last.y);
  expect(await caret()).toBe(4);
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(1);
});
