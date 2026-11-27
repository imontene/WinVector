import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, openWithFakeHost, sample, sent } from "./host";

/** Degradados desde el panel (issue #109) sobre el SVG de ejemplo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

interface Stop {
  offset: number;
  color: string;
  opacity: number;
}

const lastStyle = async (page: Page) =>
  (
    (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
      | {
          style?: {
            fill: string | null;
            fillGradient?: {
              id: string;
              kind: string;
              spread: string;
              stops: Stop[];
              users: number;
            };
            strokeGradient?: { id: string };
          };
        }
      | undefined
  )?.style;

let counter = 0;

async function send(page: Page, name: string, payload: object) {
  const id = `c-g${String(++counter)}`;
  await hostSend(page, command(id, name, { documentId: "d1", ...payload }));
  await expect.poll(async () => (await sent(page)).find((m) => m.id === id)).toBeTruthy();
  return (await sent(page)).find((m) => m.id === id);
}

const lastHistory = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload as
    { undoAction: string | null; canUndo: boolean } | undefined;

const serialize = async (page: Page) =>
  ((await send(page, "document.serialize", {}))?.payload as { svg: string }).svg;

const sol = (page: Page) => page.locator("#workspace #sol");

test("un degradado lineal nuevo va del color del objeto a transparente y lo cubre", async ({
  page,
}) => {
  await sol(page).dblclick();
  const result = await send(page, "selection.setGradient", { property: "fill", kind: "linear" });
  expect(result).toMatchObject({ ok: true, payload: { changed: true } });

  // El sol: círculo de centro (300, 96) y radio 52, en coordenadas del documento (ADR 0009).
  const gradient = page.locator("#workspace defs #degradado");
  await expect(gradient).toHaveCount(1);
  expect(await gradient.evaluate((g) => g.localName)).toBe("linearGradient");
  expect(
    await gradient.evaluate((g) =>
      ["gradientUnits", "x1", "y1", "x2", "y2"].map((name) => g.getAttribute(name)),
    ),
  ).toEqual(["userSpaceOnUse", "248", "96", "352", "96"]);
  expect(await sol(page).getAttribute("fill")).toBe("url(#degradado)");
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({
      fill: "url",
      fillGradient: {
        id: "degradado",
        kind: "linear",
        spread: "pad",
        stops: [
          { offset: 0, color: "#ffb547", opacity: 1 },
          { offset: 1, color: "#ffb547", opacity: 0 },
        ],
        users: 1,
      },
    });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "gradient" });

  // Deshacer deja el archivo como estaba.
  await send(page, "history.undo", {});
  expect(await serialize(page)).toBe(sample);
});

test("pasar a radial conserva el id y las paradas; la repetición se escribe", async ({ page }) => {
  await sol(page).dblclick();
  await send(page, "selection.setGradient", { property: "fill", kind: "linear" });
  await send(page, "selection.setGradient", {
    property: "fill",
    kind: "radial",
    spread: "reflect",
  });
  const gradient = page.locator("#workspace defs #degradado");
  expect(await gradient.evaluate((g) => g.localName)).toBe("radialGradient");
  expect(
    await gradient.evaluate((g) =>
      ["cx", "cy", "r", "x1", "spreadMethod"].map((name) => g.getAttribute(name)),
    ),
  ).toEqual(["300", "96", "52", null, "reflect"]);
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({ fillGradient: { kind: "radial", spread: "reflect" } });
  expect(await gradient.locator("stop").count()).toBe(2);
});

test("mover paradas seguidas es un paso; añadir una es otro", async ({ page }) => {
  await sol(page).dblclick();
  await send(page, "selection.setGradient", {
    property: "fill",
    stops: [
      { offset: 0, color: "#ff0000", opacity: 1 },
      { offset: 1, color: "#0000ff", opacity: 1 },
    ],
  });
  for (const offset of [0.2, 0.3, 0.4]) {
    await send(page, "selection.setGradient", {
      property: "fill",
      stops: [
        { offset, color: "#ff0000", opacity: 1 },
        { offset: 1, color: "#0000ff", opacity: 1 },
      ],
    });
  }
  await send(page, "selection.setGradient", {
    property: "fill",
    stops: [
      { offset: 0.4, color: "#ff0000", opacity: 1 },
      { offset: 0.7, color: "#00ff00", opacity: 1 },
      { offset: 1, color: "#0000ff", opacity: 1 },
    ],
  });
  await expect.poll(async () => (await lastStyle(page))?.fillGradient?.stops.length).toBe(3);

  await send(page, "history.undo", {});
  await expect
    .poll(async () => (await lastStyle(page))?.fillGradient?.stops.map((s) => s.offset))
    .toEqual([0.4, 1]);
  await send(page, "history.undo", {});
  await expect
    .poll(async () => (await lastStyle(page))?.fillGradient?.stops.map((s) => s.offset))
    .toEqual([0, 1]);
});

test("cambiar un degradado compartido solo cambia el objeto seleccionado", async ({ page }) => {
  // El cielo de fondo usa #cielo; se le da también al sol.
  await page.locator("#workspace #sol").evaluate((e) => {
    e.setAttribute("fill", "url(#cielo)");
  });
  await sol(page).dblclick();
  await expect.poll(async () => (await lastStyle(page))?.fillGradient?.users).toBe(2);
  await send(page, "selection.setGradient", {
    property: "fill",
    stops: [
      { offset: 0, color: "#000000", opacity: 1 },
      { offset: 1, color: "#ffffff", opacity: 1 },
    ],
  });
  expect(await sol(page).getAttribute("fill")).toBe("url(#cielo-2)");
  expect(await page.locator("#workspace #cielo-fondo").getAttribute("fill")).toBe("url(#cielo)");
  expect(
    await page
      .locator("#workspace #cielo stop")
      .evaluateAll((stops) => stops.map((s) => s.getAttribute("stop-color"))),
  ).toEqual(["#eaf3ff", "#fbfcfe"]);
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({ fillGradient: { id: "cielo-2", users: 1 } });
});

test("el trazo tiene su propio degradado", async ({ page }) => {
  await page.locator("#workspace #tarjeta").dblclick();
  await send(page, "selection.setGradient", { property: "stroke", kind: "linear" });
  expect(await page.locator("#workspace #tarjeta").getAttribute("stroke")).toBe("url(#degradado)");
  expect(await page.locator("#workspace #tarjeta").getAttribute("fill")).toBe("#ffffff");
  await expect.poll(async () => (await lastStyle(page))?.strokeGradient?.id).toBe("degradado");
});

// ---------------------------------------------------------------------------------------------
// El degradado acompaña al objeto en las operaciones (issue #111).
// ---------------------------------------------------------------------------------------------

const tarjeta = (page: Page) => page.locator("#workspace #tarjeta");

const gradientAttributes = (page: Page, id: string) =>
  page
    .locator(`#workspace [id="${id}"]`)
    .evaluate((g) => ["x1", "y1", "x2", "y2"].map((name) => g.getAttribute(name)));

/** La tarjeta (rect de 48,58 a 198,146) con un degradado lineal nuevo en su relleno. */
async function tarjetaConDegradado(page: Page) {
  await tarjeta(page).dblclick();
  await send(page, "selection.setGradient", { property: "fill", kind: "linear" });
  expect(await gradientAttributes(page, "degradado")).toEqual(["48", "102", "198", "102"]);
}

test("mover la tarjeta desde el panel mueve su degradado", async ({ page }) => {
  await tarjetaConDegradado(page);
  await send(page, "selection.setGeometry", { x: 58, y: 78 });
  expect(await tarjeta(page).getAttribute("x")).toBe("58");
  expect(await gradientAttributes(page, "degradado")).toEqual(["58", "122", "208", "122"]);
});

test("duplicar lleva el degradado a la copia, movido con ella; el original no cambia", async ({
  page,
}) => {
  await tarjetaConDegradado(page);
  await send(page, "selection.duplicate", {});
  const copy = page.locator('#workspace rect[fill="url(#degradado-2)"]');
  await expect(copy).toHaveCount(1);
  expect(await copy.getAttribute("x")).toBe("58");
  expect(await gradientAttributes(page, "degradado-2")).toEqual(["58", "112", "208", "112"]);
  expect(await gradientAttributes(page, "degradado")).toEqual(["48", "102", "198", "102"]);
});

test("copiar y pegar en otro documento lleva el degradado", async ({ page }) => {
  await tarjetaConDegradado(page);
  const copied = await send(page, "clipboard.copy", {});
  const svg = (copied?.payload as { svg: string }).svg;
  expect(svg).toContain("linearGradient");

  await hostSend(
    page,
    command("c-load-d2", "document.load", {
      documentId: "d2",
      name: "otro",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"/>',
    }),
  );
  await hostSend(page, command("c-act-d2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-act-d2"))
    .toMatchObject({ ok: true });
  await hostSend(page, command("c-paste-d2", "clipboard.paste", { documentId: "d2", svg }));
  await expect
    .poll(async () => (await sent(page)).find((m) => m.id === "c-paste-d2"))
    .toMatchObject({ ok: true });
  await hostSend(page, command("c-ser-d2", "document.serialize", { documentId: "d2" }));
  await expect
    .poll(async () => {
      const message = (await sent(page)).find((m) => m.id === "c-ser-d2");
      return (message?.payload as { svg?: string } | undefined)?.svg ?? "";
    })
    .toMatch(/<linearGradient id="degradado"[\s\S]*<rect[^>]*fill="url\(#degradado\)"/);
});

test("convertir en trazado, separar y combinar conservan el degradado", async ({ page }) => {
  await tarjetaConDegradado(page);
  await send(page, "object.toPath", {});
  await expect(page.locator('#workspace path[fill="url(#degradado)"]')).toHaveCount(1);
  await send(page, "path.operation", { operation: "separate" });
  await send(page, "selection.selectAll", {});
  await send(page, "path.operation", { operation: "combine" });
  await expect(page.locator('#workspace path[fill="url(#degradado)"]')).toHaveCount(1);
});

// ---------------------------------------------------------------------------------------------
// Biblioteca de degradados (issue #112).
// ---------------------------------------------------------------------------------------------

const library = async (page: Page) =>
  (await sent(page)).filter((m) => m.name === "document.gradients").at(-1)?.payload as
    { gradients: { id: string; users: number; stops: Stop[] }[] } | undefined;

test("la biblioteca anuncia los degradados con paradas y cuántos los usan", async ({ page }) => {
  await expect
    .poll(async () => (await library(page))?.gradients.map((g) => [g.id, g.users]))
    .toEqual([["cielo", 1]]);
  await tarjeta(page).dblclick();
  await send(page, "selection.setGradient", { property: "fill", kind: "linear" });
  await expect
    .poll(async () => (await library(page))?.gradients.map((g) => g.id))
    .toEqual(["cielo", "degradado"]);
});

test("usar uno de la biblioteca lo comparte, y editarlo para todos cambia a todos", async ({
  page,
}) => {
  // #cielo está en objectBoundingBox: el sol lo usa tal cual.
  await sol(page).dblclick();
  await send(page, "selection.useGradient", { property: "fill", id: "cielo" });
  expect(await sol(page).getAttribute("fill")).toBe("url(#cielo)");
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({ fillGradient: { id: "cielo", stopsId: "cielo", stopsUsers: 2 } });

  const black: Stop[] = [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 1 },
  ];
  await send(page, "selection.setGradient", { property: "fill", stops: black, shared: true });
  expect(await sol(page).getAttribute("fill")).toBe("url(#cielo)");
  expect(
    await page
      .locator("#workspace #cielo stop")
      .evaluateAll((stops) => stops.map((s) => s.getAttribute("stop-color"))),
  ).toEqual(["#000000", "#ffffff"]);
  await expect(page.locator("#workspace linearGradient")).toHaveCount(1);
});

test("un degradado en coordenadas del documento se coloca sobre cada objeto y hereda sus paradas", async ({
  page,
}) => {
  await tarjetaConDegradado(page);
  await sol(page).dblclick();
  await send(page, "selection.useGradient", { property: "fill", id: "degradado" });
  const fill = await sol(page).getAttribute("fill");
  expect(fill).toBe("url(#degradado-2)");
  const placed = page.locator("#workspace #degradado-2");
  expect(
    await placed.evaluate((g) =>
      ["href", "gradientUnits", "x1", "x2"].map((name) => g.getAttribute(name)),
    ),
  ).toEqual(["#degradado", "userSpaceOnUse", "248", "352"]);
  expect(await placed.locator("stop").count()).toBe(0);
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({
      fillGradient: { id: "degradado-2", stopsId: "degradado", stopsUsers: 2 },
    });

  // Una copia de las paradas: cambiarla no toca a la tarjeta.
  await send(page, "selection.useGradient", { property: "fill", id: "degradado", copy: true });
  await expect
    .poll(() => lastStyle(page))
    .toMatchObject({ fillGradient: { stopsId: "degradado-3", stopsUsers: 1 } });

  // Todo es un paso cada vez: deshacer dos veces vuelve al sol naranja.
  await send(page, "history.undo", {});
  await send(page, "history.undo", {});
  expect(await sol(page).getAttribute("fill")).toBe("#ffb547");
});

// ---------------------------------------------------------------------------------------------
// Limpieza de definiciones (issue #113).
// ---------------------------------------------------------------------------------------------

test("volver a un color borra el degradado de WinVector en el mismo paso", async ({ page }) => {
  await sol(page).dblclick();
  await send(page, "selection.setGradient", { property: "fill", kind: "linear" });
  await expect(page.locator("#workspace #degradado")).toHaveCount(1);
  await send(page, "selection.setStyle", {
    fill: "#123456",
    stroke: null,
    strokeWidth: null,
    opacity: null,
  });
  await expect(page.locator("#workspace #degradado")).toHaveCount(0);
  // Deshacer el color devuelve el degradado, que sigue en su sitio.
  await send(page, "history.undo", {});
  expect(await sol(page).getAttribute("fill")).toBe("url(#degradado)");
  await expect(page.locator("#workspace #degradado")).toHaveCount(1);
});

test("un degradado de otro programa sin uso se queda hasta limpiar las definiciones", async ({
  page,
}) => {
  await page.locator("#workspace #cielo-fondo").dblclick();
  await send(page, "selection.setStyle", {
    fill: "#eeeeee",
    stroke: null,
    strokeWidth: null,
    opacity: null,
  });
  await expect(page.locator("#workspace #cielo")).toHaveCount(1);

  const result = await send(page, "document.cleanDefinitions", {});
  expect(result).toMatchObject({ ok: true, payload: { removed: 1 } });
  await expect(page.locator("#workspace #cielo")).toHaveCount(0);
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "clean-definitions" });

  // Sin nada que quitar, no hay paso nuevo.
  expect(await send(page, "document.cleanDefinitions", {})).toMatchObject({
    payload: { removed: 0 },
  });
  await expect.poll(() => lastHistory(page)).toMatchObject({ undoAction: "clean-definitions" });
  await send(page, "history.undo", {});
  await expect(page.locator("#workspace #cielo")).toHaveCount(1);
});
