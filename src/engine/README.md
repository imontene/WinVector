# Motor de edición

Motor de edición SVG de WinVector. Se ejecuta dentro del lienzo (WebView2) de la aplicación, pero se desarrolla y prueba en cualquier navegador basado en Chromium, sin necesidad de Windows.

## Requisitos

Node.js en la versión de [`.nvmrc`](.nvmrc).

## Scripts

| Comando                      | Qué hace                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`                | Servidor de desarrollo con un SVG de ejemplo                                     |
| `npm run build`              | Comprueba tipos y genera el bundle en `dist/`                                    |
| `npm run preview`            | Sirve `dist/` para revisarlo                                                     |
| `npm test`                   | Pruebas unitarias (Vitest)                                                       |
| `npm run test:e2e`           | Pruebas de integración en Chromium (Playwright) contra el bundle de producción   |
| `npm run lint`               | ESLint y comprobación de formato con Prettier                                    |
| `npm run format`             | Aplica el formato de Prettier                                                    |
| `npm run typecheck`          | Comprobación de tipos de TypeScript                                              |
| `npm run contracts:generate` | Regenera los tipos del contrato del puente (ver [`contracts/`](../../contracts)) |
| `npm run contracts:test`     | Pruebas del generador del contrato                                               |

Antes de la primera ejecución de `test:e2e`, instala el navegador:

```bash
npx playwright install chromium
```

Para usar un Chromium ya instalado en el sistema, indica su ruta en `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Estructura

| Carpeta         | Responsabilidad                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/document`  | Carga y serialización SVG, preservación del contenido desconocido, `defs` e identificadores                                                   |
| `src/history`   | Deshacer y rehacer basado en comandos                                                                                                         |
| `src/selection` | Selección simple, múltiple y por marco; grupos                                                                                                |
| `src/tools`     | Herramientas del lienzo como máquinas de estados sobre eventos de puntero                                                                     |
| `src/geometry`  | Matrices, trazados, cajas delimitadoras, detección de impacto y ajuste                                                                        |
| `src/overlay`   | Capa separada para manejadores, guías y vistas previas                                                                                        |
| `src/viewport`  | Zoom y desplazamiento                                                                                                                         |
| `src/bridge`    | Mensajes con la aplicación según el contrato de [`contracts/`](../../contracts); los tipos de `src/bridge/generated` se generan, no se editan |
| `e2e`           | Pruebas de integración                                                                                                                        |

El bundle de `dist/` no puede cargar nada de fuera de la aplicación: la prueba `e2e/lienzo.spec.ts` falla si aparece una petición externa.

## Seguridad

La compilación añade a `index.html` una política de seguridad de contenido (CSP, definida en `vite.config.ts`). Impide ejecutar scripts que no sean los del propio bundle, incluidos los que traiga un SVG abierto, y cargar imágenes, fuentes o datos desde fuera de la aplicación. Los estilos en línea se permiten porque los SVG los usan de forma habitual. `e2e/seguridad.spec.ts` comprueba estas restricciones. En `npm run dev` la política no se aplica, para no romper la recarga en caliente.

La aplicación sirve `dist/` dentro del lienzo en `https://engine.winvector/` y bloquea cualquier navegación fuera de esa dirección.
