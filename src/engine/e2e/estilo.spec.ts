import { expect, test, type Page } from "@playwright/test";
import { command, hostSend, lastSent, openWithFakeHost, sample, sent } from "./host";

/** Relleno, trazo, opacidad y cuentagotas sobre el SVG de ejemplo. */

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

const lastStyle = async (page: Page) =>
  (
    (await sent(page)).filter((m) => m.name === "selection.changed").at(-1)?.payload as
      | {
          style?: {
            fill: string | null;
            stroke: string | null;
            strokeWidth: number | null;
            opacity: number | null;
          };
        }
      | undefined
  )?.style;

const setStyle = (page: Page, id: string, values: Record<string, unknown>) =>
  hostSend(
    page,
    command(id, "selection.setStyle", {
      documentId: "d1",
      fill: null,
      stroke: null,
      strokeWidth: null,
      opacity: null,
      ...values,
    }),
  );

test("la selección anuncia su estilo y la aplicación lo cambia", async ({ page }) => {
  await page.locator("#sol").dblclick();
  await expect
    .poll(() => lastStyle(page))
    .toEqual({ fill: "#ffb547", stroke: "none", strokeWidth: 1, opacity: 1, fillRule: "nonzero" });

  await setStyle(page, "c-1", { fill: "#ff0000", stroke: "#000000", strokeWidth: 4, opacity: 0.5 });
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-1", payload: { changed: true } });
  await expect
    .poll(() => lastStyle(page))
    .toEqual({
      fill: "#ff0000",
      stroke: "#000000",
      strokeWidth: 4,
      opacity: 0.5,
      fillRule: "nonzero",
    });
  expect(await page.locator("#sol").getAttribute("fill")).toBe("#ff0000");

  await page.keyboard.press("Control+Z");
  await hostSend(page, command("c-ser", "document.serialize", { documentId: "d1" }));
  await expect.poll(() => lastSent(page)).toMatchObject({ id: "c-ser", payload: { svg: sample } });
});

test("el cuentagotas da a la selección el color del objeto en el que se hace clic", async ({
  page,
}) => {
  await page.locator("#sol").dblclick();
  await page.keyboard.press("i");
  await expect.poll(async () => (await lastSent(page))?.payload).toEqual({ tool: "eyedropper" });
  // La línea de la tarjeta es #9db7e0.
  await page.locator("#linea-1").click();
  await expect.poll(() => lastStyle(page)).toMatchObject({ fill: "#9db7e0" });
  // Con Mayús, el color (el relleno blanco de la tarjeta) va al trazo.
  await page.keyboard.down("Shift");
  await page.locator("#tarjeta").click({ position: { x: 10, y: 40 } });
  await page.keyboard.up("Shift");
  await expect.poll(() => lastStyle(page)).toMatchObject({ fill: "#9db7e0", stroke: "#ffffff" });
});
