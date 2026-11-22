# ADR 0003 · Pruebas de la interfaz nativa con FlaUI

- **Estado:** Aceptada
- **Fecha:** 2026-11-18

## Contexto

La lógica de WinVector se prueba sin interfaz: el motor con Vitest y Playwright, y `WinVector.Core` con MSTest. Falta una forma de comprobar automáticamente que la aplicación instalada funciona: que arranca, que sus controles responden y que la interfaz nativa y el motor se comunican de verdad.

En el issue #6 ya hubo que automatizar la interfaz para comprobar su criterio de aceptación, con un script de PowerShell y UI Automation dentro del workflow de Windows. Este ADR decide cómo se hará a partir de ahora.

## Opciones evaluadas

1. **FlaUI** (UIA3, C#), con pruebas en MSTest en un proyecto de la solución.
2. **Script de PowerShell con `System.Windows.Automation`**, la solución provisional del issue #6.
3. **Appium con su controlador de Windows**, que se apoya en WinAppDriver de Microsoft.

## Evaluación

Se escribieron 8 pruebas con FlaUI (`tests/WinVector.App.UITests`):
- Título de la ventana y pestaña inicial.
- `Ctrl+N` y `Ctrl+W`.
- Carga del motor y medición de la latencia del puente.
- Clic en el sol y en el título del SVG de ejemplo.
- Clic fuera del documento.
- Visibilidad del contenido del lienzo.

Cada prueba arranca la aplicación desde cero y la cierra al terminar.

**Estabilidad:** en el runner `windows-latest` de GitHub Actions, 10 ejecuciones seguidas de las 8 pruebas, sobre el paquete MSIX instalado:

| Resultado | Valor |
|---|---|
| Pruebas correctas | 80 de 80 |
| Ejecuciones con algún fallo | 0 de 10 |
| Duración de una ejecución completa | 14–20 s |
| Arranque y cierre de la aplicación por prueba | menos de 1 s |

**Contenido del WebView2:** el árbol de UI Automation del lienzo incluye el contenido web. El texto "WinVector" del SVG de ejemplo aparece como un elemento de tipo `Text` dentro del WebView2. Las pruebas de interfaz pueden comprobar, a grandes rasgos, lo que dibuja el motor, sin depender de coordenadas.

**Hallazgos útiles para escribir pruebas:**

- Algunos elementos de WinUI, como los `TextBlock` de la barra de estado, no aparecen en la vista de controles con la búsqueda predeterminada de `System.Windows.Automation`. Hay que recorrer la vista completa (*raw view*). `AppSession.FindById` prueba primero la búsqueda normal y, si no encuentra el elemento, recorre la vista completa.
- FlaUI lanza `PropertyNotSupportedException` al leer una propiedad sin valor, como un `HelpText` vacío. Hay que leer con `element.Properties.<Propiedad>.ValueOrDefault`.
- **Arranque en frío.** La primera vez que se abre la aplicación tras instalar el paquete, la ventana puede tardar en responder a UI Automation más que los tiempos predeterminados de FlaUI, y la conexión falla con `TimeoutException`. Ocurrió en la primera ejecución en `main` después de fusionar, aunque las 10 repeticiones de la evaluación habían pasado: solo la primera de ellas arrancaba en frío. `AppSession` amplía los tiempos de conexión y de operación de UI Automation a 15 s y reintenta la obtención de la ventana hasta 30 s.
- **Teclas modificadoras con el ratón.** El teclado llega a la página de WebView2 por un camino y el ratón por otro, y con la entrada sintética no siempre en orden. Si Mayús se suelta justo después de un clic, la página puede recibir la tecla soltada antes que el clic, y el clic llega sin Mayús (issue #91). Con una persona no ocurre, porque mantiene la tecla mucho más tiempo. `AppSession.ShiftClick` deja una pausa antes y después del clic.
- WinUI usa el `x:Name` como AutomationId cuando no se indica otro. Los textos que cambian deben llevar además `AutomationProperties.Name` enlazado a su contenido, que también mejora la accesibilidad.

**Comparación:**

- **El script de PowerShell** funciona, pero es difícil de mantener al crecer. No tiene estructura de pruebas ni informes, y Windows PowerShell 5.1 lee el script como ANSI, lo que obliga a escribirlo sin tildes. Cada comprobación nueva alarga un único paso del workflow.
- **Appium** añade un servidor y un controlador externos, y su controlador de Windows depende de WinAppDriver. El repositorio de WinAppDriver no tiene una versión estable posterior a la 1.2.1 (solo una vista previa, la 1.2.99), y requiere activar el modo de desarrollador. Su ventaja, escribir pruebas en varios lenguajes, no aporta nada a un proyecto que ya usa C#.

## Decisión

Se adopta **FlaUI** (UIA3) con MSTest, en el proyecto `tests/WinVector.App.UITests`.

- El workflow **Aplicación** instala el MSIX en el runner x64 y ejecuta estas pruebas en cada cambio. Sustituyen a la prueba de humo de PowerShell.
- Si una prueba falla, se guarda una captura de pantalla en el artefacto `pruebas-de-interfaz`.
- Lanzado a mano, el workflow acepta un número de repeticiones (`ui_test_runs`), para volver a medir la estabilidad cuando haga falta.

## Consecuencias

- Las pruebas de interfaz se escriben en el mismo lenguaje y con el mismo marco que las de `WinVector.Core`.
- Cubren flujos de usuario completos y se mantienen de grano grueso. La lógica detallada se sigue probando en `WinVector.Core` y en el motor, que son más rápidos y no necesitan Windows.
- Cada prueba nueva añade aproximadamente 1–2 s a la CI.
- Solo se ejecutan en x64, porque los runners de GitHub Actions son x64. El paquete ARM64 se compila y empaqueta, pero no se prueba.
- Para ejecutarlas en local hay que tener WinVector instalado y definir `WINVECTOR_AUMID`. Sin esa variable, las pruebas se marcan como no concluyentes en lugar de fallar.
- Los elementos que se quieran probar necesitan un AutomationId estable (`x:Name` o `AutomationProperties.AutomationId`).
