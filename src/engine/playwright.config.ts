import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:4173";

// Permite usar un Chromium ya instalado en el sistema en lugar del que descarga Playwright.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    {
      // Solo Chromium: es el mismo motor que usa WebView2 en Windows.
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  // Las pruebas se ejecutan contra el bundle de producción, que es lo que se distribuye.
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
