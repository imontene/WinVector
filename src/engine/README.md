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

Las pruebas unitarias que necesitan el DOM real (`*.browser.test.ts`, como las del módulo `document`) se ejecutan en Chromium con el modo navegador de Vitest, para que el análisis y la serialización XML sean los de WebView2. Las demás se ejecutan en Node.

Antes de la primera ejecución de `npm test` o `test:e2e`, instala el navegador:

```bash
npx playwright install chromium
```

Para usar un Chromium ya instalado en el sistema, indica su ruta en `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Estructura

| Carpeta         | Responsabilidad                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/document`  | Carga y serialización SVG, preservación del contenido desconocido, `defs` e identificadores                                                   |
| `src/history`   | Deshacer y rehacer a partir de los cambios del DOM ([ADR 0005](../../docs/adr/0005-historial.md))                                             |
| `src/transform` | Mover, escalar y girar elementos escribiendo el SVG de la forma más limpia posible (atributos propios o `transform`)                          |
| `src/structure` | Orden de apilado, agrupar y desagrupar conservando el aspecto (matriz y estilos heredados)                                                    |
| `src/clipboard` | Copiar la selección como SVG independiente, pegar SVG sin conflictos de `id`, duplicar y eliminar                                             |
| `src/style`     | Relleno, trazo y opacidad: leerlos (de atributos, CSS o grupos) y cambiarlos tocando lo mínimo del archivo                                    |
| `src/selection` | Selección simple, múltiple y por marco; grupos                                                                                                |
| `src/tools`     | Herramientas del lienzo como máquinas de estados sobre eventos de puntero                                                                     |
| `src/geometry`  | Matrices, trazados, cajas delimitadoras, detección de impacto y ajuste                                                                        |
| `src/overlay`   | Capa separada para manejadores, guías y vistas previas                                                                                        |
| `src/viewport`  | Zoom y desplazamiento                                                                                                                         |
| `src/bridge`    | Mensajes con la aplicación según el contrato de [`contracts/`](../../contracts); los tipos de `src/bridge/generated` se generan, no se editan |
| `e2e`           | Pruebas de integración                                                                                                                        |

El bundle de `dist/` no puede cargar nada de fuera de la aplicación: la prueba `e2e/lienzo.spec.ts` falla si aparece una petición externa.

## Documento

`SvgDocument.load(texto, contenedor)` analiza el SVG con `DOMParser` y lo muestra dentro de un _shadow root_ del contenedor. Así sus estilos e identificadores no afectan a la página del motor, y nada de la interfaz de edición entra en el documento.

- **Guardar sin dañar.** Un escáner (`scanner.ts`) localiza cada nodo en el texto original y un `MutationObserver` registra qué cambia. `serialize()` copia exactamente lo que no se ha modificado, incluidos comentarios, entidades, comillas y espacios. Solo regenera las etiquetas y los nodos modificados, y mantiene el orden y el texto de los atributos que no cambian. Sin cambios, devuelve el texto original byte a byte.
- **Contenido activo.** Los `<script>` se muestran como un marcador inerte y se guardan intactos. Los atributos `on*` se conservan y la política de seguridad impide que se ejecuten.
- **Errores.** Un XML no válido lanza `SvgParseError` con la línea y la columna.
- **Sin mapeo exacto.** Si el texto no cuadra con el DOM, por ejemplo con entidades que se expanden en elementos, `hasExactMapping` es `false` y se guarda sin perder contenido, con el formato del editor.
- **Utilidades.** `createId`, `getOrCreateDefs` y `findUnusedDefinitions` gestionan identificadores y definiciones.

## Seguridad

La compilación añade a `index.html` una política de seguridad de contenido (CSP, definida en `vite.config.ts`). Impide ejecutar scripts que no sean los del propio bundle, incluidos los que traiga un SVG abierto, y cargar imágenes, fuentes o datos desde fuera de la aplicación. Los estilos en línea se permiten porque los SVG los usan de forma habitual. `e2e/seguridad.spec.ts` comprueba estas restricciones. En `npm run dev` la política no se aplica, para no romper la recarga en caliente.

La aplicación sirve `dist/` dentro del lienzo en `https://engine.winvector/` y bloquea cualquier navegación fuera de esa dirección.
