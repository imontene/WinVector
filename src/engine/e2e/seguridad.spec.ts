import { expect, test } from "@playwright/test";

test("el bundle declara la política de seguridad de contenido", async ({ page }) => {
  await page.goto("/");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self'");
});

test("no ejecuta scripts incrustados en un SVG", async ({ page }) => {
  await page.goto("/");

  const executed = await page.evaluate(async () => {
    const flags = window as unknown as Record<string, unknown>;
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">
         <script>window.__winvectorInjected = true;</script>
         <image href="x" onerror="window.__winvectorInjected = true" />
       </svg>`,
      "image/svg+xml",
    ).documentElement;
    document.body.append(document.importNode(svg, true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    return flags.__winvectorInjected === true;
  });

  expect(executed).toBe(false);
});

test("bloquea las imágenes externas referenciadas desde un SVG", async ({ page, baseURL }) => {
  // Playwright notifica la petición antes de que la política la bloquee, así que se comprueba que
  // no llega ninguna respuesta externa y que el navegador registra la infracción.
  const externalResponses: string[] = [];
  page.on("response", (response) => {
    if (!baseURL || !response.url().startsWith(baseURL)) externalResponses.push(response.url());
  });
  await page.goto("/");

  const violations = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/rastreo.png" width="10" height="10" /></svg>`,
      "image/svg+xml",
    ).documentElement;
    document.body.append(document.importNode(svg, true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return seen;
  });

  expect(violations).toEqual(["img-src https://example.com/rastreo.png"]);
  expect(externalResponses).toEqual([]);
});
