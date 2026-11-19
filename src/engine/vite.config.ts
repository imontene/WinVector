import { playwright } from "@vitest/browser-playwright";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Permite usar un Chromium ya instalado en el sistema en lugar del que descarga Playwright.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

/**
 * Política de seguridad del bundle. El lienzo mostrará SVG de terceros: los scripts que traigan no
 * deben ejecutarse y nada debe cargarse desde fuera de la aplicación. Los estilos en línea se
 * permiten porque los SVG los usan de forma habitual (atributo style).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

/** Añade la política al index.html solo en la compilación; en desarrollo rompería la recarga en caliente. */
function contentSecurityPolicy(): Plugin {
  return {
    name: "winvector-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend",
      },
    ],
  };
}

// El bundle se sirve desde la carpeta de la aplicación mediante un host virtual de
// WebView2, así que todas las rutas deben ser relativas y no puede haber recursos externos.
export default defineConfig({
  base: "./",
  plugins: [contentSecurityPolicy()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Las pruebas leen el corpus de SVG de tests/corpus, fuera de la carpeta del motor.
    fs: { allow: [".", "../../tests/corpus"] },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
          environment: "node",
        },
      },
      {
        // Pruebas que necesitan el DOM real: se ejecutan en Chromium, el motor de WebView2, para
        // que el análisis y la serialización XML sean los mismos que en la aplicación.
        extends: true,
        test: {
          name: "chromium",
          include: ["src/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(
              chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {},
            ),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
