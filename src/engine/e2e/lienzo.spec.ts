import { expect, test } from "@playwright/test";

test("muestra el SVG de ejemplo en el lienzo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  const svg = page.locator("#workspace svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("#sol")).toBeVisible();
  await expect(svg.locator("#titulo")).toHaveText("WinVector");
  expect(errors).toEqual([]);
});

test("no carga recursos de fuera de la aplicación", async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!baseURL || !request.url().startsWith(baseURL)) external.push(request.url());
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  expect(external).toEqual([]);
});
