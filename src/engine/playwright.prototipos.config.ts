import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:5175";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
/** En Windows se prueba con Edge (channel "msedge"), el mismo motor que WebView2. */
const channel = process.env.PROTOTYPE_BROWSER_CHANNEL;

/**
 * Prototipos (prototipos/): se sirven con el servidor de desarrollo de Vite, porque no forman
 * parte del bundle de la aplicación.
 */
export default defineConfig({
  testDir: "prototipos",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        ...(channel ? { channel } : {}),
        ...(executablePath && !channel ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: "npx vite --port 5175 --strictPort",
    url: `${BASE_URL}/prototipos/texto/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
