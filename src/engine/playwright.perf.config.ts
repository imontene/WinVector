import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:4173";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

/**
 * Medición de rendimiento (perf/): aparte de las pruebas e2e, sin paralelismo para que las
 * mediciones no compitan entre sí, y sin reintentos.
 */
export default defineConfig({
  testDir: "perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "off",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
