import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Operaciones del menú Trazado y regla de relleno (issue #79). */

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <circle id="aro" cx="100" cy="100" r="80" fill="#3a7bd5"/>
  <rect id="hueco" x="70" y="70" width="60" height="60" fill="#e94b3c"/>
  <path id="linea" d="M220 40H340V140" fill="none" stroke="#000"/>
  <path id="caja" d="M220 180H340V280H220Z" fill="#2a9d8f"/>
</svg>
`;

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "trazados", svg: SHAPES }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-act2", ok: true });
});

let counter = 0;

/** Envía un comando y espera su respuesta. */
async function send(page: Page, name: string, payload: object) {
  const id = `c-op${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId: "d2", ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

const pathOperation = (page: Page, operation: string) =>
  send(page, "path.operation", { operation });

const serialize = async (page: Page) =>
  ((await send(page, "document.serialize", {}))?.payload as { svg: string }).svg;

const d = (page: Page, id: string) =>
  page.locator(`#workspace #${id}`).evaluate((e) => e.getAttribute("d") ?? "");

const lastSelection = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
    { items: { id: string | null; tagName: string }[]; style?: { fillRule?: string } } | undefined;

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null } | undefined;

/** Un punto de cada forma (del relleno o del trazo) para hacer clic en ella. */
const INSIDE: Readonly<Record<string, readonly [number, number]>> = {
  aro: [100, 30],
  hueco: [100, 100],
  linea: [280, 40],
  caja: [280, 230],
};

/** Selecciona formas con clics (Mayús para añadir). */
async function select(page: Page, ...ids: string[]) {
  for (const [i, id] of ids.entries()) {
    const [x, y] = INSIDE[id] ?? [0, 0];
    const p = await page.locator(`#workspace #${id}`).evaluate(
      (element, q) => {
        const m = (element as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
        if (!m) throw new Error("Sin CTM");
        return new DOMPoint(q.x, q.y).matrixTransform(m);
      },
      { x, y },
    );
    if (i > 0) await page.keyboard.down("Shift");
    await page.mouse.click(p.x, p.y);
    if (i > 0) await page.keyboard.up("Shift");
  }
  await expect.poll(async () => (await lastSelection(page))?.items.length).toBe(ids.length);
}

const inFill = (page: Page, id: string, x: number, y: number) =>
  page
    .locator(`#workspace #${id}`)
    .evaluate((e, p) => (e as SVGGeometryElement).isPointInFill(new DOMPoint(p.x, p.y)), {
      x,
      y,
    });

test("combinar dos formas con evenodd hace un agujero; separarlas las devuelve; todo se deshace", async ({
  page,
}) => {
  const original = await serialize(page);
  await select(page, "aro", "hueco");
  expect(await pathOperation(page, "combine")).toMatchObject({
    ok: true,
    payload: { changed: true },
  });
  await expect(page.locator("#workspace #hueco")).toHaveCount(0);
  await expect
    .poll(() => lastSelection(page))
    .toMatchObject({ items: [{ id: "aro", tagName: "path" }] });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "combine-paths" });

  // La regla de relleno se cambia como el resto del estilo y se lee con la selección.
  await send(page, "selection.setStyle", {
    fill: null,
    stroke: null,
    strokeWidth: null,
    opacity: null,
    fillRule: "evenodd",
  });
  await expect.poll(() => lastSelection(page)).toMatchObject({ style: { fillRule: "evenodd" } });
  expect(await inFill(page, "aro", 100, 100)).toBe(false);
  expect(await inFill(page, "aro", 40, 100)).toBe(true);

  expect(await pathOperation(page, "separate")).toMatchObject({ payload: { changed: true } });
  await expect.poll(async () => (await lastSelection(page))?.items.length).toBe(2);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "separate-path" });

  for (let i = 0; i < 3; i++) await send(page, "history.undo", {});
  await expect.poll(() => serialize(page)).toBe(original);
});

test("cerrar, invertir y abrir un trazado, cada vez en un paso", async ({ page }) => {
  await select(page, "linea");
  await pathOperation(page, "close");
  expect(await d(page, "linea")).toBe("M220 40H340V140Z");
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "close-path" });

  await pathOperation(page, "reverse");
  expect(await d(page, "linea")).toBe("M220 40L340 140V40Z");
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "reverse-path" });

  await pathOperation(page, "open");
  expect(await d(page, "linea")).toMatch(/^M220 40.*[^Z]$/);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "open-path" });

  // Sin nada que hacer (un trazado abierto que se vuelve a abrir), no cambia nada.
  expect(await pathOperation(page, "open")).toMatchObject({ payload: { changed: false } });
  await send(page, "history.undo", {});
  await send(page, "history.undo", {});
  await send(page, "history.undo", {});
  expect(await d(page, "linea")).toBe("M220 40H340V140");
});

test("con la herramienta Vértices, abrir lo hace por el nodo seleccionado", async ({ page }) => {
  await select(page, "caja");
  await page.keyboard.press("a");
  await expect(page.locator(".overlay .overlay-vertex")).toHaveCount(4);
  // El tercer nodo: la esquina de abajo a la derecha (340,280).
  const corner = await page.locator("#workspace #caja").evaluate((e) => {
    const m = (e as SVGGraphicsElement).getScreenCTM();
    if (!m) throw new Error("Sin CTM");
    return new DOMPoint(340, 280).matrixTransform(m);
  });
  await page.mouse.click(corner.x, corner.y);
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(1);

  await pathOperation(page, "open");
  expect(await d(page, "caja")).toBe("M340 280H220V180H340V280");
  await expect(page.locator(".overlay .overlay-vertex-selected")).toHaveCount(0);
});

test("combinar necesita dos formas y separar un trazado con varios subtrazados", async ({
  page,
}) => {
  await select(page, "caja");
  expect(await pathOperation(page, "combine")).toMatchObject({ payload: { changed: false } });
  expect(await pathOperation(page, "separate")).toMatchObject({ payload: { changed: false } });
});
