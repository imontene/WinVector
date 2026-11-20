import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sent } from "./host";

/** Convertir formas en trazados (issue #60). */

const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect x="10" y="10" width="80" height="50" fill="#3a7bd5"/>
  <rect x="110" y="10" width="80" height="50" rx="12" fill="#e94b3c" stroke="#000" stroke-width="3"/>
  <rect x="210" y="10" width="80" height="50" ry="25" fill="#2a9d8f"/>
  <ellipse cx="60" cy="130" rx="45" ry="25" fill="#ffb547"/>
  <circle cx="160" cy="130" r="30" fill="none" stroke="#1f4f99" stroke-width="6"/>
  <line x1="220" y1="100" x2="290" y2="160" stroke="#000" stroke-width="5"/>
  <polygon points="20,200 90,200 55,260" fill="#9db7e0" stroke="#000"/>
  <polyline points="120,200 160,260 200,200" fill="none" stroke="#e94b3c" stroke-width="4"/>
  <polygon points="300,190 312,226 350,226 319,248 331,284 300,262 269,284 281,248 250,226 288,226" fill="gold" data-winvector-shape="star" data-winvector-sides="5" data-winvector-inner="0.38" data-winvector-cx="300" data-winvector-cy="240" data-winvector-r="50" data-winvector-rotation="-90"/>
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

const serialize = async (page: Page, id: string) => {
  await hostSend(page, command(id, "document.serialize", { documentId: "d2" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id, ok: true });
  return ((await lastSent(page))?.payload as { svg: string }).svg;
};

/** Píxeles distintos entre dos SVG dibujados en un canvas del mismo tamaño. */
const differentPixels = (page: Page, a: string, b: string) =>
  page.evaluate(
    async ({ a, b }) => {
      const draw = async (svg: string) => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 300;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Sin canvas");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 400, 300).data;
      };
      const [pa, pb] = [await draw(a), await draw(b)];
      let different = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const delta = Math.max(
          Math.abs((pa[i] ?? 0) - (pb[i] ?? 0)),
          Math.abs((pa[i + 1] ?? 0) - (pb[i + 1] ?? 0)),
          Math.abs((pa[i + 2] ?? 0) - (pb[i + 2] ?? 0)),
          Math.abs((pa[i + 3] ?? 0) - (pb[i + 3] ?? 0)),
        );
        if (delta > 48) different++;
      }
      return different;
    },
    { a, b },
  );

test("convertir todas las formas en trazados no cambia lo que se ve y se deshace en un paso", async ({
  page,
}) => {
  const before = await serialize(page, "c-ser1");
  await hostSend(page, command("c-all", "selection.selectAll", { documentId: "d2" }));
  await hostSend(page, command("c-path", "object.toPath", { documentId: "d2" }));
  await expect
    .poll(() => lastSent(page))
    .toMatchObject({ id: "c-path", payload: { changed: true } });

  const after = await serialize(page, "c-ser2");
  expect(after.match(/<path /g)).toHaveLength(9);
  expect(after).not.toMatch(/<(rect|ellipse|circle|line|polygon|polyline) /);
  expect(after).not.toContain("data-winvector");
  // Los antialiasados de un arco y de una elipse pueden diferir en algún píxel del borde.
  expect(await differentPixels(page, before, after)).toBeLessThan(60);

  // Siguen seleccionados: los nueve trazados.
  const selection = (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)
    ?.payload as {
    items: { tagName: string }[];
  };
  expect(selection.items.map((item) => item.tagName)).toEqual(Array(9).fill("path"));
  const history = (await sent(page)).filter((m) => m.name === "history.changed").at(-1)?.payload;
  expect(history).toMatchObject({ undoAction: "to-path" });

  await page.keyboard.press("Control+Z");
  await expect.poll(() => serialize(page, "c-ser3")).toBe(before);
});

test("Ctrl+Mayús+C convierte la selección con el lienzo enfocado", async ({ page }) => {
  await page.locator("#workspace ellipse").first().click();
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(async () => (await serialize(page, "c-ser")).includes("<ellipse")).toBe(false);
});
