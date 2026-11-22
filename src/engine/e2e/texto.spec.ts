import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Herramienta de texto con edición en el lienzo (issue #93). */

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect id="papel" width="400" height="300" fill="#eef"/>
  <text id="saludo" x="40" y="60" font-family="sans-serif" font-size="20">Hola</text>
  <path id="curva" d="M40 200 C120 140 200 260 300 200" fill="none" stroke="#999"/>
  <text id="sobre" font-size="16"><textPath href="#curva">sobre la curva</textPath></text>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "texto", svg: DOC }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-act2"))
    .toMatchObject({ ok: true });
});

interface Point {
  x: number;
  y: number;
}

const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  page.locator("#workspace #papel").evaluate(
    (element, p) => {
      const m = (element as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
      if (!m) throw new Error("Sin CTM");
      return new DOMPoint(p.x, p.y).matrixTransform(m);
    },
    { x, y },
  );

async function clickAt(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const serialize = async (page: Page, id: string) => {
  await hostSend(page, command(id, "document.serialize", { documentId: "d2" }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return ((await sent(page)).find((m) => m.id === id)?.payload as { svg: string }).svg;
};

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const lastSelection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    { items: { id: string | null; tagName: string }[] } | undefined;

/** Textos nuevos: los que no tienen identificador. */
const newTexts = (page: Page) =>
  page
    .locator("#workspace svg")
    .last()
    .evaluate((svg) =>
      [...svg.querySelectorAll("text:not([id])")].map((t) => ({
        text: t.textContent,
        lines: [...t.querySelectorAll("tspan")].map((s) => s.textContent),
        font: t.getAttribute("font-family"),
      })),
    );

async function useTextTool(page: Page) {
  await page.keyboard.press("t");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "text" } });
}

test("clic con Texto crea un texto que se escribe con tildes y se deshace en un paso", async ({
  page,
}) => {
  const original = await serialize(page, "c-s0");
  await useTextTool(page);
  await clickAt(page, 60, 140);
  // Mientras se edita se ve el cursor.
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(1);
  // Las letras de los atajos (v, a, t…) y el espacio van al texto, no a las herramientas.
  await page.keyboard.type("Canción vía año");
  await expect
    .poll(() => newTexts(page))
    .toEqual([{ text: "Canción vía año", lines: [], font: "Segoe UI, sans-serif" }]);
  expect((await sent(page)).filter((m) => m.name === "tool.changed").at(-1)).toMatchObject({
    payload: { tool: "text" },
  });

  await page.keyboard.press("Escape");
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "edit-text" });
  await expect.poll(() => lastSelection(page)).toMatchObject({ items: [{ tagName: "text" }] });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page, "c-s1")).toBe(original);
});

test("Intro empieza otra línea; el IME y pegar escriben en el texto", async ({ page }) => {
  await useTextTool(page);
  await clickAt(page, 60, 140);
  await page.keyboard.type("uno");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("日本語");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => newTexts(page))
    .toEqual([{ text: "uno日本語", lines: ["uno", "日本語"], font: "Segoe UI, sans-serif" }]);
});

test("un clic sin escribir no deja nada; Supr y las flechas no tocan el documento", async ({
  page,
}) => {
  const original = await serialize(page, "c-s0");
  await useTextTool(page);
  await clickAt(page, 60, 140);
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  expect(await newTexts(page)).toEqual([]);
  expect(await serialize(page, "c-s1")).toBe(original);
  expect((await lastHistory(page))?.canUndo ?? false).toBe(false);
});

test("doble clic con Selección edita un texto; Ctrl+Z dentro deshace lo escrito", async ({
  page,
}) => {
  const original = await serialize(page, "c-s0");
  // El final de "Hola": el cursor va donde se hace doble clic.
  const end = await page.locator("#workspace #saludo").evaluate((t) => {
    const text = t as SVGTextElement;
    const p = text.getEndPositionOfChar(text.getNumberOfChars() - 1);
    const m = text.getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const s = new DOMPoint(p.x - 1, p.y - 6).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.dblclick(end.x, end.y);
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.name === "tool.changed").at(-1))
    .toMatchObject({ payload: { tool: "text" } });
  await page.keyboard.press("End");
  await page.keyboard.type(" mundo");
  await expect.poll(() => page.locator("#workspace #saludo").textContent()).toBe("Hola mundo");
  // Ctrl+Z dentro de la edición es el deshacer del campo de texto, no el del documento; Ctrl+A
  // selecciona el texto, no los objetos.
  await page.keyboard.press("Control+Z");
  await expect.poll(() => page.locator("#workspace #saludo").textContent()).not.toBe("Hola mundo");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Adiós");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator("#workspace #saludo").textContent()).toBe("Adiós");
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "edit-text" });

  // Fuera de la edición, Ctrl+Z deshace la edición entera y el archivo vuelve a ser el mismo.
  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page, "c-s1")).toBe(original);
});

test("clic con Texto en el texto que se edita coloca el cursor; un clic fuera termina", async ({
  page,
}) => {
  await useTextTool(page);
  const start = await page.locator("#workspace #saludo").evaluate((t) => {
    const text = t as SVGTextElement;
    const p = text.getStartPositionOfChar(0);
    const m = text.getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const s = new DOMPoint(p.x + 0.5, p.y - 6).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(start.x, start.y);
  await page.keyboard.type("¡");
  await expect.poll(() => page.locator("#workspace #saludo").textContent()).toBe("¡Hola");
  // Mayús+flecha selecciona: se ve la selección y no el cursor.
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".overlay .overlay-text-selection")).toHaveCount(1);
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(0);

  await clickAt(page, 300, 60);
  await expect(page.locator(".overlay .overlay-text-selection")).toHaveCount(0);
  expect(await newTexts(page)).toEqual([]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "edit-text" });
});

test("un texto sobre un trazado no se edita: se avisa de por qué", async ({ page }) => {
  await useTextTool(page);
  const on = await page.locator("#workspace #sobre").evaluate((t) => {
    const text = t as SVGTextElement;
    const p = text.getStartPositionOfChar(3);
    const m = text.getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    const s = new DOMPoint(p.x, p.y - 4).matrixTransform(m);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(on.x, on.y);
  await expect
    .poll(async () => (await sent(page)).find((m) => m.name === "text.locked"))
    .toMatchObject({ payload: { documentId: "d2", reason: "text-path" } });
  await expect(page.locator(".overlay .overlay-text-caret")).toHaveCount(0);
});
