import { expect, test, type Page } from "@playwright/test";
import { parsePath } from "../src/paths";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Pluma con curvas (issue #78). */

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

/** Pulsa en `from` y arrastra hasta `to` (coordenadas del documento). */
async function dragAt(page: Page, from: Point, to: Point) {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

/** Formas creadas por la pluma: las que no tienen identificador. */
const created = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) =>
      [...svg.querySelectorAll("path:not([id]), polygon:not([id]), polyline:not([id])")].map(
        (e) => ({
          tag: e.localName,
          d: e.getAttribute("d"),
          points: e.getAttribute("points"),
          fill: e.getAttribute("fill"),
        }),
      ),
    );

const segments = async (page: Page) => {
  const [shape] = await created(page);
  return parsePath(shape?.d ?? "").data[0]?.segments ?? [];
};

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const lastSelection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload;

const serialize = async (page: Page) => {
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

const near = (actual: Point | undefined, expected: Point, tolerance = 0.6) => {
  expect(actual, "punto").toBeDefined();
  expect(Math.abs((actual?.x ?? NaN) - expected.x)).toBeLessThan(tolerance);
  expect(Math.abs((actual?.y ?? NaN) - expected.y)).toBeLessThan(tolerance);
};

test("arrastrar crea un nodo suave: un trazado con curvas en un paso que se deshace", async ({
  page,
}) => {
  await clickAt(page, 20, 100);
  // Mientras se arrastra se ven los dos manejadores del nodo.
  const a = await toScreen(page, 100, 100);
  const b = await toScreen(page, 130, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect(page.locator(".overlay .overlay-path-handle")).toHaveCount(2);
  await page.mouse.up();
  const end = await toScreen(page, 180, 60);
  await page.mouse.dblclick(end.x, end.y);

  const [shape] = await created(page);
  expect(shape).toMatchObject({ tag: "path", fill: "none" });
  const [first, second] = await segments(page);
  expect(first?.kind).toBe("cubic");
  expect(second?.kind).toBe("cubic");
  if (first?.kind !== "cubic" || second?.kind !== "cubic") return;
  near(first.to, { x: 100, y: 100 });
  near(first.c2, { x: 70, y: 100 });
  near(second.c1, { x: 130, y: 100 });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-path" });
  expect(await lastSelection(page)).toMatchObject({ items: [{ tagName: "path" }] });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page)).toBe(sample);
});

test("con Alt solo se mueve el manejador que sale; con Mayús va de 15° en 15°", async ({
  page,
}) => {
  await clickAt(page, 20, 100);
  await page.keyboard.down("Alt");
  await dragAt(page, { x: 100, y: 100 }, { x: 130, y: 70 });
  await page.keyboard.up("Alt");
  await page.keyboard.down("Shift");
  // Unos 5° por debajo de la horizontal: con Mayús, horizontal.
  await dragAt(page, { x: 180, y: 100 }, { x: 220, y: 103.5 });
  await page.keyboard.up("Shift");
  await page.keyboard.press("Enter");

  const [first, second, third] = await segments(page);
  // Sin manejador que llegue al nodo, el primer segmento sigue siendo recto.
  expect(first?.kind).toBe("line");
  expect(second?.kind).toBe("cubic");
  if (second?.kind !== "cubic") return;
  near(second.c1, { x: 130, y: 70 });
  near(second.c2, { x: 140, y: 100 });
  // Enter termina sin otro segmento: el manejador que sale del último nodo no dibuja nada.
  expect(third).toBeUndefined();
});

test("cerrar arrastrando desde el primer nodo curva el último segmento", async ({ page }) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 100, 20);
  await clickAt(page, 60, 80);
  await dragAt(page, { x: 20, y: 20 }, { x: 0, y: 40 });

  const [shape] = await created(page);
  expect(shape).toMatchObject({ tag: "path", fill: "#ffffff" });
  expect(shape?.d).toMatch(/Z$/);
  const all = await segments(page);
  const closing = all.at(-1);
  expect(closing?.kind).toBe("cubic");
  if (closing?.kind !== "cubic") return;
  near(closing.to, { x: 20, y: 20 });
  near(closing.c2, { x: 40, y: 0 });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-path" });
});

test("con curvas se pueden cerrar dos nodos; sin curvas, hacen falta tres", async ({ page }) => {
  await clickAt(page, 20, 20);
  await dragAt(page, { x: 100, y: 20 }, { x: 100, y: 60 });
  await clickAt(page, 20, 20);
  expect(await created(page)).toMatchObject([{ tag: "path" }]);
});

test("empezar en un extremo de la polilínea seleccionada la continúa", async ({ page }) => {
  await clickAt(page, 20, 20);
  const end = await toScreen(page, 80, 20);
  await page.mouse.dblclick(end.x, end.y);
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20" }]);

  // Por el final: los nodos nuevos van detrás.
  await clickAt(page, 80, 20);
  await clickAt(page, 80, 80);
  await page.keyboard.press("Enter");
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20 80,80" }]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "continue-path" });

  // Por el principio: los nodos nuevos van delante y el sentido no cambia.
  await clickAt(page, 20, 20);
  await clickAt(page, 20, 80);
  await page.keyboard.press("Enter");
  expect(await created(page)).toMatchObject([
    { tag: "polyline", points: "20,80 20,20 80,20 80,80" },
  ]);

  // Cada continuación se deshace en un paso.
  await page.keyboard.press("Control+Z");
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20 80,80" }]);
});

test("continuar con una curva convierte la polilínea en un trazado y cerrar la cierra", async ({
  page,
}) => {
  await clickAt(page, 20, 20);
  await clickAt(page, 80, 20);
  const end = await toScreen(page, 80, 80);
  await page.mouse.dblclick(end.x, end.y);

  await clickAt(page, 80, 80);
  await dragAt(page, { x: 20, y: 80 }, { x: 0, y: 60 });
  await clickAt(page, 20, 20);

  const shapes = await created(page);
  expect(shapes).toHaveLength(1);
  expect(shapes[0]).toMatchObject({ tag: "path", fill: "none" });
  expect(shapes[0]?.d).toMatch(/^M20 20.*Z$/);
  expect(await lastSelection(page)).toMatchObject({ items: [{ tagName: "path" }] });

  await page.keyboard.press("Control+Z");
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20 80,80" }]);
});

test("al continuar, Retroceso solo quita los nodos nuevos y Esc lo deja como estaba", async ({
  page,
}) => {
  await clickAt(page, 20, 20);
  const end = await toScreen(page, 80, 20);
  await page.mouse.dblclick(end.x, end.y);

  await clickAt(page, 80, 20);
  await clickAt(page, 80, 80);
  await clickAt(page, 140, 80);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20 80,80" }]);

  await clickAt(page, 80, 80);
  await clickAt(page, 140, 140);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  expect(await created(page)).toMatchObject([{ tag: "polyline", points: "20,20 80,20 80,80" }]);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "continue-path" });
});

test("un arrastre sin movimientos intermedios también saca los manejadores", async ({ page }) => {
  // En WebView2, los pointermove de un arrastre rápido pueden no llegar; el pointerup sí.
  await clickAt(page, 20, 100);
  const from = await toScreen(page, 100, 100);
  const to = await toScreen(page, 130, 100);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.evaluate((p) => {
    document.getElementById("workspace")?.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: p.x,
        clientY: p.y,
        button: 0,
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
        composed: true,
      }),
    );
  }, to);
  await page.mouse.up();
  await page.keyboard.press("Enter");

  const [first] = await segments(page);
  expect(first?.kind).toBe("cubic");
  if (first?.kind !== "cubic") return;
  near(first.c2, { x: 70, y: 100 });
});
