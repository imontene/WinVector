import { expect, test, type Page } from "@playwright/test";
import { parsePath, type CubicSegment } from "../src/paths";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Herramienta de nodos: mover los nodos y los manejadores de un trazado (issue #76). */

// Una curva con un nodo simétrico en (140,200), uno de esquina en (240,200) y un arco al final.
const ONDA = "M40 200C40 150 140 150 140 200S240 250 240 200A50 50 0 0 1 340 200";

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <path id="onda" d="${ONDA}" fill="none" stroke="#000" stroke-width="3"/>
  <path id="suave" d="M40 80C40 40 90 40 100 60C105 70 160 100 160 60" fill="none" stroke="#3a7bd5" stroke-width="3"/>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "nodos", svg: SHAPES }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-act2", ok: true });
});

interface Point {
  x: number;
  y: number;
}

const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  page.locator("#workspace #onda").evaluate(
    (element, p) => {
      const svg = (element as SVGGraphicsElement).ownerSVGElement;
      const m = svg?.getScreenCTM();
      if (!m) throw new Error("Sin CTM");
      return new DOMPoint(p.x, p.y).matrixTransform(m);
    },
    { x, y },
  );

const d = (page: Page, id: string) =>
  page.locator(`#workspace #${id}`).evaluate((e) => e.getAttribute("d") ?? "");

/** Segmento `index` del primer subtrazado del `d` de un trazado. */
const segment = async (page: Page, id: string, index: number) =>
  parsePath(await d(page, id)).data[0]?.segments[index];

const cubic = async (page: Page, id: string, index: number) => {
  const found = await segment(page, id, index);
  if (found?.kind !== "cubic") throw new Error(`El segmento ${String(index)} no es una cúbica`);
  return found satisfies CubicSegment;
};

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

async function clickAt(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Selecciona `onda` con un clic sobre su trazo y pasa a editar sus nodos. */
async function editOnda(page: Page) {
  await page.keyboard.press("v");
  // Un punto del trazo, a mitad de la segunda curva.
  await clickAt(page, 190, 237.5);
  await page.keyboard.press("a");
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ name: "tool.changed", payload: { tool: "vertex" } });
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);
}

const near = (actual: Point, expected: Point, tolerance = 1.5) => {
  expect(Math.abs(actual.x - expected.x), `x de ${JSON.stringify(actual)}`).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected.y), `y de ${JSON.stringify(actual)}`).toBeLessThan(tolerance);
};

test("arrastrar un nodo lo mueve con sus manejadores en un paso que se deshace", async ({
  page,
}) => {
  await editOnda(page);
  await drag(page, await toScreen(page, 140, 200), await toScreen(page, 140, 230));

  const before = await cubic(page, "onda", 0);
  const after = await cubic(page, "onda", 1);
  near(before.to, { x: 140, y: 230 });
  near(before.c2, { x: 140, y: 180 });
  near(after.c1, { x: 140, y: 280 });
  // Los demás nodos y los manejadores que no son suyos no se mueven.
  near(before.c1, { x: 40, y: 150 });
  near(after.c2, { x: 240, y: 250 });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "move-vertices" });

  await page.keyboard.press("Control+Z");
  // Deshacer devuelve el texto original, no una versión reescrita.
  await expect.poll(() => d(page, "onda")).toBe(ONDA);
});

test("mover los extremos de un arco lo mantiene como arco", async ({ page }) => {
  await editOnda(page);
  await drag(page, await toScreen(page, 340, 200), await toScreen(page, 360, 200));
  const arc = await segment(page, "onda", 2);
  expect(arc).toMatchObject({ kind: "arc", rx: 50, ry: 50, sweep: true });
  near(arc?.to ?? { x: 0, y: 0 }, { x: 360, y: 200 });
});

test("un nodo seleccionado muestra sus manejadores; en uno simétrico el opuesto lo refleja", async ({
  page,
}) => {
  await editOnda(page);
  await expect(page.locator(".overlay .overlay-path-handle")).toHaveCount(0);
  await clickAt(page, 140, 200);
  await expect(page.locator(".overlay .overlay-path-handle")).toHaveCount(2);
  await expect(page.locator(".overlay .overlay-path-handle-line")).toHaveCount(2);

  await drag(page, await toScreen(page, 140, 150), await toScreen(page, 110, 160));
  const before = await cubic(page, "onda", 0);
  const after = await cubic(page, "onda", 1);
  near(before.c2, { x: 110, y: 160 });
  near(after.c1, { x: 170, y: 240 });
  near(before.to, { x: 140, y: 200 });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "move-handle" });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => d(page, "onda")).toBe(ONDA);
});

test("en un nodo suave el manejador opuesto sigue la dirección y conserva su longitud", async ({
  page,
}) => {
  // En `suave`, el nodo (100,60) tiene manejadores alineados de distinta longitud.
  await page.keyboard.press("v");
  await clickAt(page, 66.25, 47.5);
  await page.keyboard.press("a");
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(3);
  await clickAt(page, 100, 60);
  await expect(page.locator(".overlay .overlay-path-handle")).toHaveCount(2);

  const opposite = (await cubic(page, "suave", 1)).c1;
  const length = Math.hypot(opposite.x - 100, opposite.y - 60);
  // El manejador de entrada (90,40) se lleva hacia la izquierda, en horizontal.
  await drag(page, await toScreen(page, 90, 40), await toScreen(page, 70, 60));
  const moved = (await cubic(page, "suave", 0)).c2;
  const follows = (await cubic(page, "suave", 1)).c1;
  near(moved, { x: 70, y: 60 });
  near(follows, { x: 100 + length, y: 60 });
});

test("con Mayús el manejador gira de 15° en 15° y Esc cancela el arrastre", async ({ page }) => {
  await editOnda(page);
  await clickAt(page, 140, 200);
  const from = await toScreen(page, 140, 150);

  // Unos 5° respecto a la vertical, que con Mayús se quedan en la vertical.
  await page.keyboard.down("Shift");
  await drag(page, from, await toScreen(page, 136, 150));
  await page.keyboard.up("Shift");
  const snapped = (await cubic(page, "onda", 0)).c2;
  expect(Math.abs(snapped.x - 140)).toBeLessThan(0.01);

  await page.keyboard.press("Control+Z");
  await expect.poll(() => d(page, "onda")).toBe(ONDA);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await toScreen(page, 100, 120);
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => d(page, "onda")).toBe(ONDA);
});

test("las flechas mueven los nodos seleccionados de un trazado", async ({ page }) => {
  await editOnda(page);
  await clickAt(page, 240, 200);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  const corner = await cubic(page, "onda", 1);
  near(corner.to, { x: 251, y: 200 }, 0.01);
  near(corner.c2, { x: 251, y: 250 }, 0.01);
  const arc = await segment(page, "onda", 2);
  expect(arc?.kind).toBe("arc");
  // Supr no borra el trazado: quitar nodos llega con el issue #77.
  await page.keyboard.press("Delete");
  await expect(page.locator("#workspace #onda")).toHaveCount(1);
});

test("doble clic en un trazado con la herramienta Selección pasa a editar sus nodos", async ({
  page,
}) => {
  // A mitad de la primera curva: en la segunda, el borde de la caja tiene un manejador de escala.
  const p = await toScreen(page, 90, 162.5);
  await page.mouse.dblclick(p.x, p.y);
  // El primer clic selecciona el trazado, así que el último mensaje puede ser la selección.
  await expect
    .poll(async () => (await sent(page)).filter((m) => m.name === "tool.changed").at(-1))
    .toMatchObject({ payload: { tool: "vertex" } });
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);
});
