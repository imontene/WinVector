import { mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { expect, test, type Page } from "@playwright/test";
import type { Case } from "./texto/casos";

/**
 * Prototipo de edición de texto (issue #35): comprueba lo que cada enfoque sabe hacer y mide su
 * precisión con varias fuentes y transformaciones. Los resultados van a
 * prototipos/texto/resultados/<sistema>.json y a la consola; el ADR 0006 los resume.
 */

type Mode = "propio" | "superpuesto";

interface Prototype {
  cases: Case[];
  start(id: string, mode: Mode): void;
  stop(): void;
  value(): string;
  charPoint(id: string, index: number, fraction: number): { x: number; y: number };
  measureOverlay(id: string): { maxX: number; maxY: number; endX: number; scale: number };
  measureOwn(id: string): { hits: number; total: number; maxCaret: number };
  caretScreenX(): number | undefined;
}

const MODES: Mode[] = ["propio", "superpuesto"];
const EDIT = "t-editar";
const results: Record<string, unknown> = { browser: "", checks: {}, accuracy: [] };
const checks = results.checks as Record<string, Record<string, boolean>>;

const svgText = (page: Page, id = EDIT) =>
  page.locator(`#${id}`).evaluate((element) =>
    Array.from(element.querySelectorAll("tspan"))
      .map((span) => span.textContent)
      .join("\n"),
  );

async function open(page: Page) {
  await page.goto("/prototipos/texto/");
  await page.waitForFunction(() => "__prototipo" in window);
  const browser = page.context().browser();
  const channel = process.env.PROTOTYPE_BROWSER_CHANNEL;
  results.browser = `${channel ?? browser?.browserType().name() ?? "chromium"} ${browser?.version() ?? ""} en ${platform()}`;
}

async function startEditing(page: Page, mode: Mode) {
  await page.evaluate(
    ({ id, mode }) => {
      (window as unknown as { __prototipo: Prototype }).__prototipo.start(id, mode);
    },
    { id: EDIT, mode },
  );
}

function record(mode: Mode, name: string, ok: boolean) {
  checks[mode] ??= {};
  checks[mode][name] = ok;
}

/** Comprueba algo sin detener la prueba, y lo anota en los resultados. */
async function check(mode: Mode, name: string, body: () => Promise<void>) {
  try {
    await body();
    record(mode, name, true);
  } catch (error) {
    record(mode, name, false);
    test
      .info()
      .annotations.push({ type: `${mode}: ${name}`, description: String(error).slice(0, 300) });
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  const folder = new URL("./texto/resultados/", import.meta.url);
  mkdirSync(folder, { recursive: true });
  writeFileSync(new URL(`${platform()}.json`, folder), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results.checks, null, 2));
  console.table(results.accuracy);
});

for (const mode of MODES) {
  test(`funcionamiento: ${mode}`, async ({ page }) => {
    await open(page);
    const expectText = async (expected: string) => {
      await expect.poll(() => svgText(page)).toBe(expected);
    };

    await check(mode, "escribir con tildes y eñes", async () => {
      await startEditing(page, mode);
      await page.keyboard.press("End");
      await page.keyboard.type(" ñandú ÁÉÍÓÚ ü ¿?");
      await expectText("Hola mundo ñandú ÁÉÍÓÚ ü ¿?");
    });

    await check(mode, "borrar", async () => {
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await expectText("Hola mundo ñandú ÁÉÍÓÚ ü");
    });

    await check(mode, "seleccionar con el teclado", async () => {
      await startEditing(page, mode);
      await page.keyboard.press("Home");
      for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.type("Adiós");
      await expectText("Adiós mundo ñandú ÁÉÍÓÚ ü");
    });

    await check(mode, "seleccionar con el ratón", async () => {
      await startEditing(page, mode);
      // De la primera letra de "mundo" (6) a la última (10), arrastrando.
      const [from, to] = await page.evaluate(
        ({ id }) => {
          const p = (window as unknown as { __prototipo: Prototype }).__prototipo;
          return [p.charPoint(id, 6, 0.1), p.charPoint(id, 10, 0.95)];
        },
        { id: EDIT },
      );
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.type("gente");
      await expectText("Adiós gente ñandú ÁÉÍÓÚ ü");
    });

    await check(mode, "varias líneas (Intro y flechas)", async () => {
      await startEditing(page, mode);
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Segunda línea");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Cuarta");
      await expectText("Adiós gente ñandú ÁÉÍÓÚ ü\nSegunda línea\n\nCuarta");
      // Subir dos líneas desde el final de "Cuarta" deja el cursor en "Segunda línea".
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.type("·");
      const lines = (await svgText(page)).split("\n");
      expect(lines[1]).toContain("·");
      // Las líneas vacías conservan su sitio: cada tspan tiene su propia y.
      const ys = await page
        .locator(`#${EDIT} tspan`)
        .evaluateAll((spans) => spans.map((span) => Number(span.getAttribute("y"))));
      expect(ys).toHaveLength(4);
      expect((ys[3] ?? 0) - (ys[2] ?? 0)).toBeCloseTo((ys[1] ?? 0) - (ys[0] ?? 0));
    });

    await check(mode, "IME (composición en japonés)", async () => {
      await startEditing(page, mode);
      await page.keyboard.press("Control+End");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", {
        text: "にほんご",
        selectionStart: 4,
        selectionEnd: 4,
      });
      // Mientras se compone, el texto provisional se ve en el lienzo.
      await expect.poll(() => svgText(page)).toContain("にほんご");
      await cdp.send("Input.insertText", { text: "日本語" });
      await expect.poll(() => svgText(page)).toMatch(/Cuarta日本語$/);
      await expect.poll(() => svgText(page)).not.toContain("にほんご");
    });

    await check(mode, "lector de pantalla (árbol de accesibilidad)", async () => {
      await startEditing(page, mode);
      await expect(page.getByRole("textbox", { name: `Texto ${EDIT}` })).toBeFocused();
      // El árbol de accesibilidad del propio Chromium, que es lo que WebView2 entrega a UI Automation.
      const cdp = await page.context().newCDPSession(page);
      const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
        nodes: {
          role?: { value?: string };
          name?: { value?: string };
          value?: { value?: string };
        }[];
      };
      const box = nodes.find(
        (node) => node.role?.value === "textbox" && node.name?.value === `Texto ${EDIT}`,
      );
      console.log(`${mode}: ${JSON.stringify(box?.value)}`);
      expect(box?.value?.value).toContain("Adiós gente");
    });

    await check(mode, "deshacer del navegador (Ctrl+Z)", async () => {
      await startEditing(page, mode);
      await page.keyboard.press("Control+End");
      await page.keyboard.type("XYZ");
      await page.keyboard.press("Control+z");
      await expect.poll(() => svgText(page)).not.toContain("XYZ");
    });

    await page.evaluate(() => {
      (window as unknown as { __prototipo: Prototype }).__prototipo.stop();
    });
  });
}

test("precisión con fuentes y transformaciones", async ({ page }) => {
  await open(page);
  const cases = await page.evaluate(
    () => (window as unknown as { __prototipo: Prototype }).__prototipo.cases,
  );
  const accuracy = results.accuracy as Record<string, unknown>[];
  for (const item of cases) {
    await page.locator(`#${item.id}`).scrollIntoViewIfNeeded();
    const overlay = await page.evaluate(
      (id) => (window as unknown as { __prototipo: Prototype }).__prototipo.measureOverlay(id),
      item.id,
    );
    const own = await page.evaluate(
      (id) => (window as unknown as { __prototipo: Prototype }).__prototipo.measureOwn(id),
      item.id,
    );

    // Con el ratón de verdad: un clic en cada carácter coloca ahí el cursor propio.
    await page.evaluate((id) => {
      (window as unknown as { __prototipo: Prototype }).__prototipo.start(id, "propio");
    }, item.id);
    let clicks = 0;
    const length = item.text.length;
    for (let index = 0; index < length; index += 3) {
      const point = await page.evaluate(
        ({ id, index }) =>
          (window as unknown as { __prototipo: Prototype }).__prototipo.charPoint(id, index, 0.4),
        { id: item.id, index },
      );
      await page.mouse.click(point.x, point.y);
      const caret = await page.evaluate(
        () => document.querySelector<HTMLTextAreaElement>(".entrada-oculta")?.selectionStart,
      );
      if (caret === index) clicks++;
    }
    await page.evaluate(() => {
      (window as unknown as { __prototipo: Prototype }).__prototipo.stop();
    });

    accuracy.push({
      fuente: item.fontName,
      tamaño: item.size,
      transformación:
        item.transformName +
        (item.letterSpacing ? `, espaciado ${String(item.letterSpacing)}` : ""),
      "A: desvío máx. x (px)": overlay.maxX,
      "A: desvío máx. y (px)": overlay.maxY,
      "A: desvío al final (px)": overlay.endX,
      "B: aciertos (cálculo)": `${String(own.hits)}/${String(own.total)}`,
      "B: aciertos (clic)": `${String(clicks)}/${String(Math.ceil(length / 3))}`,
    });
  }
  expect(accuracy.length).toBe(cases.length);
});
