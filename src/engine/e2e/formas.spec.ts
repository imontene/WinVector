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

/** Elementos creados de un tipo (los que no tienen identificador). */
const createdOf = (page: Page, tag: string) =>
  page
    .locator("#workspace svg")
    .first()
    .evaluate(
      (svg, t) =>
        [...svg.querySelectorAll(`${t}:not([id])`)].map((element) =>
          Object.fromEntries([...element.attributes].map((a) => [a.name, a.value])),
        ),
      tag,
    ) as Promise<Record<string, string>[]>;

test("la elipse se inscribe en el arrastre; con Mayús es un círculo", async ({ page }) => {
  await selectTool(page, "ellipse");
  await drawDrag(page, { x: 20, y: 20 }, { x: 80, y: 50 });
  const [ellipse] = await createdOf(page, "ellipse");
  expect(number(ellipse?.cx)).toBeCloseTo(50, 0);
  expect(number(ellipse?.cy)).toBeCloseTo(35, 0);
  expect(number(ellipse?.rx)).toBeCloseTo(30, 0);
  expect(number(ellipse?.ry)).toBeCloseTo(15, 0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-ellipse" });

  // Mayús a mitad del arrastre: la elipse pasa a ser un círculo, sin dejar la elipse.
  const a = await toScreen(page, 200, 200);
  const b = await toScreen(page, 260, 220);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await expect.poll(async () => (await createdOf(page, "ellipse")).length).toBe(2);
  await page.keyboard.down("Shift");
  await expect.poll(async () => (await createdOf(page, "circle")).length).toBe(1);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await createdOf(page, "ellipse")).toHaveLength(1);
  const [circle] = await createdOf(page, "circle");
  expect(number(circle?.r)).toBeCloseTo(30, 0);
  expect(circle).toMatchObject({ fill: "#ffffff", stroke: "#000000" });

  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page)).toBe(sample);
});

test("E elige la elipse", async ({ page }) => {
  await page.locator("#sol").click();
  await page.keyboard.press("e");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "ellipse" } });
});

test("el manejador de la esquina redondea un rectángulo; Esc lo deja como estaba", async ({
  page,
}) => {
  await selectTool(page, "rectangle");
  await drawDrag(page, { x: 20, y: 160 }, { x: 120, y: 220 });
  await selectTool(page, "select");
  const handle = page.locator(".overlay .overlay-shape-handle");
  await expect(handle).toHaveCount(1);
  const box = await handle.boundingBox();
  if (!box) throw new Error("Sin manejador");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const k = await scale(page);

  // Esc a mitad del arrastre: sin cambios ni paso del historial.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 10 * k, start.y + 10 * k, { steps: 4 });
  await expect.poll(async () => (await createdOf(page, "rect"))[0]?.rx).toBeDefined();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await createdOf(page, "rect"))[0]?.rx).toBeUndefined();
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-rectangle" });

  // Hacia dentro 10 unidades en diagonal: el radio crece 10 (rx y ry iguales).
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 10 * k, start.y + 10 * k, { steps: 4 });
  await page.mouse.up();
  const [rounded] = await createdOf(page, "rect");
  const tolerance = 1 / k + 0.01;
  const initial = 14 / k; // el manejador empieza a 14 px de la esquina, con radio 0
  expect(Math.abs(number(rounded?.rx) - 10)).toBeLessThan(tolerance + initial);
  expect(rounded?.ry).toBe(rounded?.rx);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "corner-radius" });

  await page.keyboard.press("Control+Z");
  await expect.poll(async () => (await createdOf(page, "rect"))[0]?.rx).toBeUndefined();
});

test("un círculo escalado de forma desigual pasa a ser una elipse con su id y su estilo", async ({
  page,
}) => {
  await page.locator("#sol").dblclick();
  const handles = page.locator('.overlay [data-handle="e"]');
  await expect(handles).toHaveCount(1);
  const box = await handles.boundingBox();
  if (!box) throw new Error("Sin manejador");
  const k = await scale(page);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40 * k, from.y, { steps: 5 });
  await page.mouse.up();

  const sun = page.locator("#sol");
  await expect.poll(() => sun.evaluate((e) => e.localName)).toBe("ellipse");
  const attributes = await sun.evaluate((e) =>
    Object.fromEntries([...e.attributes].map((a) => [a.name, a.value])),
  );
  expect(attributes).toMatchObject({ id: "sol", fill: "#ffb547", cy: "96", ry: "52" });
  expect(attributes.transform).toBeUndefined();
  expect(number(attributes.rx)).toBeGreaterThan(70);
  // Sigue seleccionado.
  const selection = (await sent(page)).filter((m) => m.name === "selection.changed").at(-1);
  expect(selection?.payload).toMatchObject({ items: [{ tagName: "ellipse", id: "sol" }] });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page)).toBe(sample);
});

test("cambiar solo el ancho de un círculo en el panel lo convierte en elipse seleccionada", async ({
  page,
}) => {
  await page.locator("#sol").dblclick();
  await hostSend(
    page,
    command("c-geo", "selection.setGeometry", {
      documentId: "d1",
      x: null,
      y: null,
      width: 150,
      height: null,
      rotation: null,
    }),
  );
  const sun = page.locator("#sol");
  await expect.poll(() => sun.evaluate((e) => e.localName)).toBe("ellipse");
  const [rx, ry] = await sun.evaluate((e) => [e.getAttribute("rx"), e.getAttribute("ry")]);
  // La caja del navegador tiene precisión simple: 75.00001 es 75.
  expect(number(rx ?? undefined)).toBeCloseTo(75, 3);
  expect(ry).toBe("52");
  await expect
    .poll(
      async () => (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload,
    )
    .toMatchObject({ items: [{ tagName: "ellipse", id: "sol" }] });
});

test("la línea va de un punto a otro; Mayús fija el ángulo y Alt la centra", async ({ page }) => {
  await selectTool(page, "line");
  await drawDrag(page, { x: 20, y: 20 }, { x: 80, y: 50 });
  await drawDrag(page, { x: 20, y: 100 }, { x: 80, y: 104 }, ["Shift"]);
  await drawDrag(page, { x: 200, y: 200 }, { x: 230, y: 210 }, ["Alt"]);

  const [free, level, centered] = await createdOf(page, "line");
  expect(number(free?.x1)).toBeCloseTo(20, 0);
  expect(number(free?.y2)).toBeCloseTo(50, 0);
  // La línea nace con trazo y sin relleno.
  expect(free).toMatchObject({ stroke: "#000000", "stroke-width": "1" });
  expect(free?.fill).toBeUndefined();
  // Con Mayús, casi horizontal pasa a horizontal.
  expect(level?.y2).toBe(level?.y1);
  // Con Alt, el punto inicial es el centro.
  expect((number(centered?.x1) + number(centered?.x2)) / 2).toBeCloseTo(200, 0);
  expect((number(centered?.y1) + number(centered?.y2)) / 2).toBeCloseTo(200, 0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "create-line" });
});

test("sin trazo en el último estilo, la línea toma el color del relleno", async ({ page }) => {
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
  await selectTool(page, "line");
  await drawDrag(page, { x: 20, y: 200 }, { x: 60, y: 240 });
  expect((await createdOf(page, "line"))[0]).toMatchObject({ stroke: "#ff0000" });
});

test("los extremos de una línea se arrastran; sin manejadores de escalar", async ({ page }) => {
  await selectTool(page, "line");
  await drawDrag(page, { x: 20, y: 160 }, { x: 100, y: 200 });
  await selectTool(page, "select");
  await expect(page.locator(".overlay .overlay-shape-handle")).toHaveCount(2);
  await expect(page.locator(".overlay [data-handle]")).toHaveCount(0);

  const end = await toScreen(page, 100, 200);
  const target = await toScreen(page, 140, 150);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  const [line] = await createdOf(page, "line");
  expect(number(line?.x2)).toBeCloseTo(140, 0);
  expect(number(line?.y2)).toBeCloseTo(150, 0);
  expect(number(line?.x1)).toBeCloseTo(20, 0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "line-end" });

  await page.keyboard.press("Control+Z");
  await expect.poll(async () => number((await createdOf(page, "line"))[0]?.x2)).toBeCloseTo(100, 0);
});

test("una línea fina se selecciona aunque el clic caiga unos píxeles al lado", async ({ page }) => {
  await selectTool(page, "line");
  await drawDrag(page, { x: 20, y: 160 }, { x: 120, y: 160 });
  await selectTool(page, "select");
  // Clic en el fondo para deseleccionar y después a 3 píxeles de la línea.
  await page.mouse.click(5, 5);
  const middle = await toScreen(page, 70, 160);
  await page.mouse.click(middle.x, middle.y + 3);
  await expect
    .poll(
      async () => (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload,
    )
    .toMatchObject({ items: [{ tagName: "line" }] });
});

test("L elige la línea", async ({ page }) => {
  await page.locator("#sol").click();
  await page.keyboard.press("l");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "line" } });
});

test("un rectángulo pequeño no tiene manejador del radio y se puede arrastrar", async ({
  page,
}) => {
  const k = await scale(page);
  await selectTool(page, "rectangle");
  // 10 unidades: menos de 42 píxeles de pantalla con el zoom de la prueba.
  const size = Math.min(10, 30 / k);
  await drawDrag(page, { x: 20, y: 200 }, { x: 20 + size, y: 200 + size });
  await selectTool(page, "select");
  await expect(page.locator(".overlay .overlay-shape-handle")).toHaveCount(0);

  const center = await toScreen(page, 20 + size / 2, 200 + size / 2);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y, { steps: 4 });
  await page.mouse.up();
  const [rect] = await createdOf(page, "rect");
  expect(number(rect?.x)).toBeGreaterThan(25);
  expect(rect?.rx).toBeUndefined();
});
