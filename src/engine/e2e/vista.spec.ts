import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Zoom, desplazamiento, herramientas Mano y Zoom, reglas, cuadrícula y mesa de trabajo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

const artboard = (page: Page) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });

/** Punto del documento (unidades del viewBox) que está bajo un punto de la pantalla. */
const documentPointAt = (page: Page, x: number, y: number) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate(
      (svg, point) => {
        const ctm = (svg as SVGSVGElement).getScreenCTM();
        if (!ctm) return null;
        const p = new DOMPoint(point.x, point.y).matrixTransform(ctm.inverse());
        return { x: p.x, y: p.y };
      },
      { x, y },
    );

const lastZoom = async (page: Page) => {
  const messages = await sent(page);
  const event = messages.filter((m) => m.name === "viewport.changed").at(-1);
  return (event?.payload as { zoom: number } | undefined)?.zoom;
};

test("al abrir, la mesa de trabajo se ajusta al lienzo y se anuncia el zoom", async ({ page }) => {
  const box = await artboard(page);
  const viewport = page.viewportSize();
  expect(box.width).toBeLessThanOrEqual((viewport?.width ?? 0) - 20);
  expect(box.width / box.height).toBeCloseTo(800 / 600, 2);
  expect(await lastZoom(page)).toBeCloseTo(box.width / 800, 3);
});

test("Ctrl+rueda acerca manteniendo fijo el punto bajo el puntero", async ({ page }) => {
  const box = await artboard(page);
  const x = box.x + box.width * 0.7;
  const y = box.y + box.height * 0.3;
  const before = await documentPointAt(page, x, y);
  const zoomBefore = await lastZoom(page);

  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");

  await expect.poll(() => lastZoom(page)).toBeGreaterThan(zoomBefore ?? 0);
  const after = await documentPointAt(page, x, y);
  expect(after?.x).toBeCloseTo(before?.x ?? NaN, 0);
  expect(after?.y).toBeCloseTo(before?.y ?? NaN, 0);
});

test("la rueda sola desplaza el lienzo", async ({ page }) => {
  const before = await artboard(page);
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await artboard(page)).y).toBeCloseTo(before.y - 120, 0);
});

test("arrastrar con la barra espaciadora desplaza sin seleccionar", async ({ page }) => {
  const before = await artboard(page);
  await page.mouse.move(400, 300);
  await page.keyboard.down(" ");
  await page.mouse.down();
  await page.mouse.move(450, 330, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(" ");

  const after = await artboard(page);
  expect(after.x - before.x).toBeCloseTo(50, 0);
  expect(after.y - before.y).toBeCloseTo(30, 0);
  expect((await sent(page)).filter((m) => m.name === "selection.changed")).toHaveLength(1);
});

test("arrastrar con el botón central desplaza", async ({ page }) => {
  const before = await artboard(page);
  await page.mouse.move(400, 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(380, 260, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  const after = await artboard(page);
  expect(after.x - before.x).toBeCloseTo(-20, 0);
  expect(after.y - before.y).toBeCloseTo(-40, 0);
});

test("los comandos del menú Ver cambian el zoom", async ({ page }) => {
  await hostSend(page, command("c-actual", "view.zoom", { documentId: "d1", action: "actual" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-actual", payload: { zoom: 1 } });
  expect((await artboard(page)).width).toBeCloseTo(800, 0);

  await hostSend(page, command("c-in", "view.zoom", { documentId: "d1", action: "in" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-in", payload: { zoom: 1.5 } });

  await hostSend(page, command("c-out", "view.zoom", { documentId: "d1", action: "out" }));
  await hostSend(page, command("c-out2", "view.zoom", { documentId: "d1", action: "out" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-out2", payload: { zoom: 0.6667 } });

  await hostSend(page, command("c-fit", "view.zoom", { documentId: "d1", action: "fit" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-fit", ok: true });
});

test("la herramienta Mano desplaza y la herramienta Zoom acerca y aleja", async ({ page }) => {
  await hostSend(page, command("c-hand", "tool.select", { tool: "hand" }));
  const before = await artboard(page);
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(520, 300, { steps: 3 });
  await page.mouse.up();
  expect((await artboard(page)).x - before.x).toBeCloseTo(20, 0);

  await hostSend(page, command("c-zoom", "tool.select", { tool: "zoom" }));
  const zoom = (await lastZoom(page)) ?? 0;
  await page.mouse.click(500, 300);
  await expect.poll(() => lastZoom(page)).toBeGreaterThan(zoom);
  const zoomed = (await lastZoom(page)) ?? 0;
  await page.keyboard.down("Alt");
  await page.mouse.click(500, 300);
  await page.keyboard.up("Alt");
  await expect.poll(() => lastZoom(page)).toBeLessThan(zoomed);

  // Con otra herramienta, el clic no selecciona.
  expect((await sent(page)).filter((m) => m.name === "selection.changed")).toHaveLength(1);
});

test("V, H y Z cambian de herramienta y lo anuncian", async ({ page }) => {
  await page.locator("#sol").click();
  await page.keyboard.press("h");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "hand" } });
  await page.keyboard.press("z");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "zoom" } });
  await page.keyboard.press("v");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "select" } });
});

test("las reglas y la cuadrícula se muestran y se ocultan", async ({ page }) => {
  await expect(page.locator(".ruler-top")).toBeVisible();
  await expect(page.locator(".grid")).toBeHidden();
  await hostSend(
    page,
    command("c-opt", "view.setOptions", { showRulers: false, showGrid: true, snapToGrid: true }),
  );
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({
      id: "c-opt",
      payload: { showRulers: false, showGrid: true, snapToGrid: true },
    });
  await expect(page.locator(".ruler-top")).toBeHidden();
  await expect(page.locator(".grid")).toBeVisible();
});

test("la mesa de trabajo se anuncia al cargar y se cambia con artboard.set", async ({ page }) => {
  const announced = (await sent(page)).find((m) => m.name === "artboard.changed");
  expect(announced?.payload).toEqual({
    documentId: "d1",
    width: "800",
    height: "600",
    viewBox: { x: 0, y: 0, width: 400, height: 300 },
  });

  await hostSend(
    page,
    command("c-ab", "artboard.set", {
      documentId: "d1",
      width: "400",
      height: "400",
      viewBox: { x: 0, y: 0, width: 400, height: 400 },
    }),
  );
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ab", ok: true });
  const messages = await sent(page);
  expect(messages.filter((m) => m.name === "artboard.changed").at(-1)?.payload).toMatchObject({
    width: "400",
    viewBox: { height: 400 },
  });
  expect(messages.filter((m) => m.name === "history.changed").at(-1)?.payload).toMatchObject({
    undoAction: "artboard",
  });
  const box = await artboard(page);
  expect(box.width).toBeCloseTo(box.height, 0);
});

test("navegar no cambia el documento", async ({ page }) => {
  await page.mouse.move(400, 300);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await page.mouse.wheel(0, 100);
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-ser", payload: { svg: sample, revision: 0 } });
});

test("con el lienzo enfocado, el motor atiende el zoom y deshacer y envía los demás atajos", async ({
  page,
}) => {
  await page.locator("#sol").click();

  await page.keyboard.press("Control+1");
  await expect.poll(() => lastZoom(page)).toBe(1);
  await page.keyboard.press("Control+=");
  await expect.poll(() => lastZoom(page)).toBe(1.5);
  await page.keyboard.press("Control+-");
  await expect.poll(() => lastZoom(page)).toBe(1);

  await hostSend(
    page,
    command("c-ab", "artboard.set", {
      documentId: "d1",
      width: "100",
      height: "600",
      viewBox: null,
    }),
  );
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ab", ok: true });
  await page.keyboard.press("Control+Z");
  await expect
    .poll(
      async () => (await sent(page)).filter((m) => m.name === "artboard.changed").at(-1)?.payload,
    )
    .toMatchObject({ width: "800" });
  await page.keyboard.press("Control+Shift+Z");
  await expect
    .poll(
      async () => (await sent(page)).filter((m) => m.name === "artboard.changed").at(-1)?.payload,
    )
    .toMatchObject({ width: "100" });

  await page.keyboard.press("Control+S");
  await page.keyboard.press("Control+Shift+N");
  await page.keyboard.press("F1");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("s");
  const forwarded = (await sent(page))
    .filter((m) => m.name === "keyboard.shortcut")
    .map((m) => m.payload);
  expect(forwarded).toEqual([
    { key: "s", ctrlKey: true, shiftKey: false, altKey: false },
    { key: "n", ctrlKey: true, shiftKey: true, altKey: false },
    { key: "f1", ctrlKey: false, shiftKey: false, altKey: false },
  ]);
});

test("un arrastre sin movimientos intermedios termina en la posición del pointerup", async ({
  page,
}) => {
  // En WebView2, los pointermove de un arrastre rápido pueden no llegar; el pointerup sí.
  await hostSend(page, command("c-hand", "tool.select", { tool: "hand" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-hand", ok: true });
  const before = await artboard(page);
  await page.evaluate(() => {
    const target = document.getElementById("workspace");
    const event = (type: string, x: number) =>
      new PointerEvent(type, {
        clientX: x,
        clientY: 300,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
        composed: true,
      });
    target?.dispatchEvent(event("pointerdown", 500));
    target?.dispatchEvent(event("pointerup", 380));
  });
  expect((await artboard(page)).x - before.x).toBeCloseTo(-120, 0);
});
