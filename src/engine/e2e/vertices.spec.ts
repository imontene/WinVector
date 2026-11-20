import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Edición por vértices (issue #61). */

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <polygon id="tri" points="40,40 140,40 90,120" fill="#3a7bd5"/>
  <polyline id="zig" points="200,40 240,100 280,40" fill="none" stroke="#000" stroke-width="3"/>
  <rect id="caja" x="40" y="170" width="100" height="80" fill="#e94b3c"/>
  <polygon id="estrella" points="300,190 312,226 350,226 319,248 331,284 300,262 269,284 281,248 250,226 288,226" fill="gold" data-winvector-shape="star" data-winvector-sides="5" data-winvector-inner="0.38" data-winvector-cx="300" data-winvector-cy="240" data-winvector-r="50" data-winvector-rotation="-90"/>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "formas", svg: SHAPES }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-act2", ok: true });
});

interface Point {
  x: number;
  y: number;
}

const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  page.locator("#workspace #tri").evaluate(
    (element, p) => {
      const svg = (element as SVGGraphicsElement).ownerSVGElement;
      const m = svg?.getScreenCTM();
      if (!m) throw new Error("Sin CTM");
      return new DOMPoint(p.x, p.y).matrixTransform(m);
    },
    { x, y },
  );

const attribute = (page: Page, id: string, name: string) =>
  page.locator(`#workspace #${id}`).evaluate((e, n) => e.getAttribute(n), name);

const tagOf = (page: Page, id: string) =>
  page.locator(`#workspace #${id}`).evaluate((e) => e.localName);

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

/** Selecciona una forma con un clic (herramienta Selección) y elige la herramienta Vértices. */
async function editVertices(page: Page, id: string) {
  await page.locator(`#workspace #${id}`).click();
  await page.keyboard.press("a");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "vertex" } });
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

test("arrastrar un vértice lo mueve en un paso que se deshace", async ({ page }) => {
  await editVertices(page, "tri");
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(3);
  await drag(page, await toScreen(page, 90, 120), await toScreen(page, 90, 160));

  expect(await attribute(page, "tri", "points")).toMatch(/^40,40 140,40 90,1(59|60|61)/);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "move-vertices" });
  await page.keyboard.press("Control+Z");
  await expect.poll(() => attribute(page, "tri", "points")).toBe("40,40 140,40 90,120");
});

test("Mayús+clic selecciona varios y se mueven juntos; las flechas también", async ({ page }) => {
  await editVertices(page, "tri");
  const a = await toScreen(page, 40, 40);
  const b = await toScreen(page, 140, 40);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(2);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => attribute(page, "tri", "points")).toBe("40,51 140,51 90,120");
  // Las dos pulsaciones son un solo paso.
  await page.keyboard.press("Control+Z");
  await expect.poll(() => attribute(page, "tri", "points")).toBe("40,40 140,40 90,120");
});

test("un marco desde el fondo selecciona los vértices que quedan dentro", async ({ page }) => {
  await editVertices(page, "tri");
  await drag(page, await toScreen(page, 20, 20), await toScreen(page, 160, 60));
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(0);
});

test("doble clic en un segmento añade un vértice y Supr lo quita, sin bajar del mínimo", async ({
  page,
}) => {
  await editVertices(page, "tri");
  const middle = await toScreen(page, 90, 40);
  await page.mouse.dblclick(middle.x, middle.y + 2);
  await expect
    .poll(() => attribute(page, "tri", "points"))
    .toMatch(/^40,40 (89|90)(\.\d+)?,40 140,40 90,120$/);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "add-vertex" });

  await page.keyboard.press("Delete");
  await expect.poll(() => attribute(page, "tri", "points")).toBe("40,40 140,40 90,120");
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "delete-vertices" });

  // Un triángulo no puede perder vértices, y Supr no borra la forma.
  const corner = await toScreen(page, 40, 40);
  await page.mouse.click(corner.x, corner.y);
  await page.keyboard.press("Delete");
  expect(await attribute(page, "tri", "points")).toBe("40,40 140,40 90,120");
});

test("un rectángulo y una estrella pasan a ser polígonos al editarlos, y se avisa", async ({
  page,
}) => {
  await editVertices(page, "caja");
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);
  await drag(page, await toScreen(page, 140, 250), await toScreen(page, 160, 270));
  await expect.poll(() => tagOf(page, "caja")).toBe("polygon");
  expect(await attribute(page, "caja", "fill")).toBe("#e94b3c");
  expect((await sent(page)).find((m) => m.name === "shape.converted")?.payload).toEqual({
    documentId: "d2",
    from: "rect",
  });
  // Sigue seleccionada y editándose.
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);

  await page.keyboard.press("v");
  await editVertices(page, "estrella");
  await drag(page, await toScreen(page, 300, 190), await toScreen(page, 300, 170));
  await expect.poll(() => attribute(page, "estrella", "data-winvector-shape")).toBeNull();
  expect((await sent(page)).filter((m) => m.name === "shape.converted").at(-1)?.payload).toEqual({
    documentId: "d2",
    from: "star",
  });
});

test("con Mayús el arrastre va en horizontal y un vértice se ajusta a otro cercano", async ({
  page,
}) => {
  await editVertices(page, "tri");
  await drag(page, await toScreen(page, 90, 120), await toScreen(page, 130, 124));
  // Sin Mayús: a donde se suelta.
  expect(await attribute(page, "tri", "points")).not.toContain("90,120");
  await page.keyboard.press("Control+Z");

  const from = await toScreen(page, 90, 120);
  const to = await toScreen(page, 130, 124);
  // Mayús al pulsar sobre un vértice lo añade o lo quita de la selección: se pulsa después.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await attribute(page, "tri", "points")).toMatch(/ 1\d\d(\.\d+)?,120$/);
  await page.keyboard.press("Control+Z");

  // Cerca de otro vértice: queda exactamente encima.
  const near = await toScreen(page, 140, 40);
  await drag(page, from, { x: near.x + 3, y: near.y + 2 });
  expect(await attribute(page, "tri", "points")).toBe("40,40 140,40 140,40");
});

test("doble clic en un polígono con la herramienta Selección pasa a editar sus vértices", async ({
  page,
}) => {
  const inside = await toScreen(page, 90, 70);
  await page.mouse.dblclick(inside.x, inside.y);
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "vertex" } });
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(3);
});
