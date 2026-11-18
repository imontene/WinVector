import { defineConfig } from "vitest/config";

// El bundle se sirve desde la carpeta de la aplicación mediante un host virtual de
// WebView2, así que todas las rutas deben ser relativas y no puede haber recursos externos.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
