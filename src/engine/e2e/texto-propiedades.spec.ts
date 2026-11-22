import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Propiedades tipográficas de los textos (issue #95). */

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect id="papel" width="400" height="300" fill="#eef"/>
  <text id="saludo" x="40" y="60" font-family="sans-serif" font-size="20">Hola</text>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "propiedades", svg: DOC }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-act2"))
    .toMatchObject({ ok: true });
});

let counter = 0;

async function send(page: Page, name: string, payload: object) {
  const id = `c-p${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId: "d2", ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

const lastSelection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    { items: unknown[]; text?: Record<string, unknown> } | undefined;

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

const attribute = (page: Page, selector: string, name: string) =>
  page.locator(`#workspace ${selector}`).evaluate((e, n) => e.getAttribute(n), name);

async function clickText(page: Page) {
  const p = await page.locator("#workspace #saludo").evaluate((t) => {
    const text = t as SVGTextElement;
    const q = text.getStartPositionOfChar(1);
    const m = text.getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const s = new DOMPoint(q.x, q.y - 6).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(p.x, p.y);
}

test("la selección anuncia las propiedades del texto y la aplicación las cambia", async ({
  page,
}) => {
  await clickText(page);
  await expect
    .poll(() => lastSelection(page))
    .toMatchObject({
      text: {
        fontFamily: "sans-serif",
        fontSize: 20,
        fontWeight: 400,
        italic: false,
        anchor: "start",
        lineHeight: 1.2,
      },
    });

  expect(
    await send(page, "selection.setText", { fontFamily: "Georgia", fontSize: 30, fontWeight: 700 }),
  ).toMatchObject({ payload: { changed: true } });
  expect(await attribute(page, "#saludo", "font-family")).toBe("Georgia, serif");
  expect(await attribute(page, "#saludo", "font-size")).toBe("30");
  await expect
    .poll(() => lastSelection(page))
    .toMatchObject({
      text: { fontFamily: "Georgia", fontSize: 30, fontWeight: 700 },
    });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "text-style" });

  await send(page, "history.undo", {});
  expect(await attribute(page, "#saludo", "font-family")).toBe("sans-serif");
});

test("mientras se edita, el cambio va al texto y la edición sigue en un solo paso", async ({
  page,
}) => {
  await page.keyboard.press("t");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "text" } });
  await clickText(page);
  await page.keyboard.type("!");
  await send(page, "selection.setText", { italic: true, anchor: "middle" });
  // Se sigue escribiendo en el mismo texto, que ahora está en cursiva.
  await page.keyboard.type("?");
  await page.keyboard.press("Escape");
  expect(await page.locator("#workspace #saludo").textContent()).toContain("?");
  expect(await attribute(page, "#saludo", "font-style")).toBe("italic");
  expect(await attribute(page, "#saludo", "text-anchor")).toBe("middle");
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "edit-text" });
});

test("un texto nuevo usa la última fuente y el último tamaño elegidos", async ({ page }) => {
  await clickText(page);
  await send(page, "selection.setText", { fontFamily: "Consolas", fontSize: 12 });
  await page.keyboard.press("t");
  const p = await page.locator("#workspace #papel").evaluate((e) => {
    const m = (e as SVGGraphicsElement).getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const s = new DOMPoint(60, 200).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("nuevo");
  await page.keyboard.press("Escape");
  expect(await attribute(page, "text:not([id])", "font-family")).toBe("Consolas, monospace");
  expect(await attribute(page, "text:not([id])", "font-size")).toBe("12");
});
