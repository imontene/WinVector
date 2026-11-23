import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, openWithFakeHost, sent } from "./host";

/** Redondear vértices con la herramienta Vértices (issue #80). */

const SQUARE = "100,100 200,100 200,200 100,200";
const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <polygon id="caja" points="${SQUARE}" fill="#3a7bd5"/>
</svg>
`;

async function load(page: Page, id: string, svg: string) {
  await hostSend(page, command(`c-load-${id}`, "document.load", { documentId: id, name: id, svg }));
  await hostSend(page, command(`c-act-${id}`, "document.activate", { documentId: id }));
  // Después de la respuesta pueden llegar eventos (la selección, los nodos): se busca por su id.
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === `c-act-${id}`))
    .toMatchObject({ ok: true });
}

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await load(page, "d2", SHAPES);
});

let counter = 0;

async function send(page: Page, documentId: string, name: string, payload: object) {
  const id = `c-r${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId, ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

interface Point {
  x: number;
  y: number;
}

/** Punto del documento en pantalla (con la matriz del lienzo del documento activo). */
const toScreen = (page: Page, x: number, y: number): Promise<Point> =>
  page.locator("#workspace #caja").evaluate(
    (element, p) => {
      const m = (element as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
      if (!m) throw new Error("Sin CTM");
      return new DOMPoint(p.x, p.y).matrixTransform(m);
    },
    { x, y },
  );

const attribute = (page: Page, name: string) =>
  page.locator("#workspace #caja").evaluate((e, n) => e.getAttribute(n), name);

const tag = (page: Page) => page.locator("#workspace #caja").evaluate((e) => e.localName);

const nodesChanged = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "nodes.changed").at(-1)?.payload as
    { count: number; canRound?: boolean; cornerRadius?: number } | undefined;

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

/** Selecciona la caja con un clic dentro y pasa a la herramienta Vértices. */
async function editCaja(page: Page) {
  const inside = await toScreen(page, 150, 150);
  await page.mouse.click(inside.x, inside.y);
  await page.keyboard.press("a");
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);
}

async function clickVertex(page: Page, x: number, y: number, add = false) {
  const p = await toScreen(page, x, y);
  if (add) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  if (add) await page.keyboard.up("Shift");
}

/** Centro del control de radio que se dibuja en la capa de superposición. */
const widget = (page: Page, index = 0) =>
  page
    .locator(".overlay .overlay-corner-radius")
    .nth(index)
    .evaluate((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));

const radiiOf = async (page: Page) =>
  Object.fromEntries(
    ((await attribute(page, "data-winvector-corner-radii")) ?? "")
      .split(" ")
      .filter(Boolean)
      .map((pair) => {
        const [key, value] = pair.split("=");
        return [key ?? "", Number(value)];
      }),
  );

test("arrastrar el control de radio redondea la esquina con un arco, en un paso", async ({
  page,
}) => {
  await editCaja(page);
  await clickVertex(page, 200, 100);
  await expect(page.locator(".overlay .overlay-corner-radius")).toHaveCount(1);
  await expect
    .poll(() => nodesChanged(page))
    .toMatchObject({ count: 1, canRound: true, cornerRadius: 0 });

  // Diez unidades por la bisectriz, hacia dentro: el radio es 10 / (1 / sen 45° - 1) ≈ 24.
  const from = await widget(page);
  const vertex = await toScreen(page, 200, 100);
  const inside = await toScreen(page, 200 - 10 / Math.SQRT2, 100 + 10 / Math.SQRT2);
  const to = { x: from.x + inside.x - vertex.x, y: from.y + inside.y - vertex.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();

  expect(await tag(page)).toBe("path");
  expect(await attribute(page, "d")).toMatch(/a/i);
  expect(await attribute(page, "data-winvector-unrounded")).toBe("M100 100H200V200H100Z");
  const radius = (await radiiOf(page))["0:1"] ?? 0;
  expect(radius).toBeGreaterThan(22);
  expect(radius).toBeLessThan(26);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "corner-radius" });
  // Los nodos que se ven siguen siendo los cuatro vértices, y el control está en el arco.
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);

  await page.keyboard.press("Control+Z");
  await expect.poll(() => tag(page)).toBe("polygon");
  expect(await attribute(page, "points")).toBe(SQUARE);
});

test("dos esquinas con radios distintos se guardan, se vuelven a abrir y se cambian o quitan", async ({
  page,
}) => {
  await editCaja(page);
  await clickVertex(page, 200, 100);
  expect(await send(page, "d2", "path.cornerRadius", { radius: 10 })).toMatchObject({
    payload: { changed: true },
  });
  await clickVertex(page, 100, 200);
  await send(page, "d2", "path.cornerRadius", { radius: 30 });
  expect(await radiiOf(page)).toEqual({ "0:1": 10, "0:3": 30 });

  // Guardar y volver a abrir.
  const saved = ((await send(page, "d2", "document.serialize", {}))?.payload as { svg: string })
    .svg;
  expect(saved).toContain('data-winvector-corner-radii="0:1=10 0:3=30"');
  // Se cierra antes el original: los dos tendrían una caja con el mismo identificador.
  await send(page, "d2", "document.close", {});
  await load(page, "d3", saved);
  await editCaja(page);

  await clickVertex(page, 200, 100);
  await clickVertex(page, 100, 200, true);
  // Radios distintos: el panel no muestra ninguno.
  await expect.poll(() => nodesChanged(page)).toMatchObject({ count: 2, canRound: true });
  expect((await nodesChanged(page))?.cornerRadius).toBeUndefined();

  // Un clic en un vértice ya seleccionado no deselecciona los demás (para arrastrarlos): Esc sí.
  await page.keyboard.press("Escape");
  await clickVertex(page, 200, 100);
  await expect.poll(() => nodesChanged(page)).toMatchObject({ count: 1, cornerRadius: 10 });
  await send(page, "d3", "path.cornerRadius", { radius: 15 });
  expect(await radiiOf(page)).toEqual({ "0:1": 15, "0:3": 30 });

  // Quitar los dos redondeos deja el cuadrado como era, sin los atributos.
  await clickVertex(page, 100, 200, true);
  await send(page, "d3", "path.cornerRadius", { radius: 0 });
  expect(await attribute(page, "d")).toBe("M100 100H200V200H100Z");
  expect(await attribute(page, "data-winvector-unrounded")).toBeNull();
  expect(await attribute(page, "data-winvector-corner-radii")).toBeNull();
});

test("el radio se limita a lo que cabe; mover un vértice conserva el redondeo", async ({
  page,
}) => {
  await editCaja(page);
  await clickVertex(page, 200, 100);
  await send(page, "d2", "path.cornerRadius", { radius: 500 });
  expect(await radiiOf(page)).toEqual({ "0:1": 100 });

  await clickVertex(page, 200, 200);
  await page.keyboard.press("Shift+ArrowRight");
  expect(await attribute(page, "data-winvector-unrounded")).toBe("M100 100H200l10 100H100Z");
  expect(await radiiOf(page)).toEqual({ "0:1": 100 });
  expect(await attribute(page, "d")).toMatch(/a/i);
});

test("sin esquinas que redondear no cambia nada", async ({ page }) => {
  await editCaja(page);
  expect(await send(page, "d2", "path.cornerRadius", { radius: 10 })).toMatchObject({
    payload: { changed: false },
  });
  expect(await tag(page)).toBe("polygon");
});

// ---------------------------------------------------------------------------------------------
// Redondear todas las esquinas de una figura a la vez (issue #114).
// ---------------------------------------------------------------------------------------------

const MIXED = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <polygon id="cuadro" points="${SQUARE}" fill="#3a7bd5"/>
  <path id="flecha" d="M250 100 L350 150 L250 200 Z" fill="#1f4f99"/>
  <polyline id="zeta" points="20,20 80,20 20,80 80,80" fill="none" stroke="#000"/>
</svg>
`;

const selectionChanged = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    { items: unknown[]; corners?: { radius?: number } } | undefined;

const attributeOf = (page: Page, id: string, name: string) =>
  page.locator(`#workspace #${id}`).evaluate((e, n) => e.getAttribute(n), name);

test("con Selección, el radio se aplica a todas las esquinas de varias figuras en un paso", async ({
  page,
}) => {
  await load(page, "d3", MIXED);
  await send(page, "d3", "selection.selectAll", {});
  await expect.poll(() => selectionChanged(page)).toMatchObject({ corners: { radius: 0 } });

  const result = await send(page, "d3", "path.cornerRadius", { radius: 10, all: true });
  expect(result).toMatchObject({ ok: true, payload: { changed: true } });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "corner-radius" });

  // El cuadrado y la flecha, todas sus esquinas; la zeta (abierta), sus dos esquinas interiores.
  expect(await attributeOf(page, "cuadro", "data-winvector-corner-radii")).toBe(
    "0:0=10 0:1=10 0:2=10 0:3=10",
  );
  expect(await attributeOf(page, "flecha", "data-winvector-corner-radii")).toBe(
    "0:0=10 0:1=10 0:2=10",
  );
  expect(await attributeOf(page, "zeta", "data-winvector-corner-radii")).toBe("0:1=10 0:2=10");
  await expect.poll(() => selectionChanged(page)).toMatchObject({ corners: { radius: 10 } });

  // Un solo paso: deshacer devuelve las tres figuras como estaban.
  await send(page, "d3", "history.undo", {});
  await expect(page.locator("#workspace polygon#cuadro")).toHaveCount(1);
  await expect(page.locator("#workspace polyline#zeta")).toHaveCount(1);
  expect(await attributeOf(page, "flecha", "d")).toBe("M250 100 L350 150 L250 200 Z");
});

test("con radios distintos el radio común no se indica, y 0 quita el redondeo", async ({
  page,
}) => {
  await load(page, "d4", MIXED);
  await send(page, "d4", "selection.selectAll", {});
  // Un radio que no cabe se reduce en cada esquina según sus lados: ya no tienen todas el mismo.
  await send(page, "d4", "path.cornerRadius", { radius: 200, all: true });
  await expect.poll(async () => (await selectionChanged(page))?.corners).toEqual({});

  await send(page, "d4", "path.cornerRadius", { radius: 0, all: true });
  expect(await attributeOf(page, "cuadro", "data-winvector-corner-radii")).toBeNull();
  expect(await attributeOf(page, "cuadro", "d")).toBe("M100 100H200V200H100Z");
  await expect.poll(() => selectionChanged(page)).toMatchObject({ corners: { radius: 0 } });
});

test("los rectángulos, las estrellas y las elipses no tienen esquinas que redondear", async ({
  page,
}) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect id="r" x="10" y="10" width="50" height="40"/>
  <ellipse id="e" cx="200" cy="100" rx="40" ry="20"/>
</svg>
`;
  await load(page, "d5", svg);
  await send(page, "d5", "selection.selectAll", {});
  await expect.poll(async () => (await selectionChanged(page))?.items.length).toBe(2);
  expect((await selectionChanged(page))?.corners).toBeUndefined();
  const result = await send(page, "d5", "path.cornerRadius", { radius: 5, all: true });
  expect(result).toMatchObject({ ok: true, payload: { changed: false } });
});

test("con Vértices, Ctrl+A (selection.selectAll) selecciona todos los nodos", async ({ page }) => {
  await editCaja(page);
  await send(page, "d2", "selection.selectAll", {});
  await expect.poll(() => nodesChanged(page)).toMatchObject({ count: 4, canRound: true });
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(4);
});
