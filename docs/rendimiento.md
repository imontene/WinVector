# Rendimiento

Mediciones de los objetivos de rendimiento del MVP 1 (PLAN.md, sección 4.6) y cómo se vigilan en la CI (issue #34).

| Objetivo del MVP 1 | Cómo se mide |
| --- | --- |
| Interacción fluida (60 fps) con documentos de 2.000 objetos en un equipo de gama media | Motor en Chromium con Playwright: fotogramas por segundo al arrastrar, hacer zoom y desplazar |
| Ventana lista en menos de 2 s en arranque en frío | Aplicación instalada (MSIX) en Windows: tiempo hasta que la ventana ha cargado su contenido |

## Cómo se mide

### Motor (`npm run perf` en `src/engine`)

- **Documentos generados** (`src/engine/perf/generate.ts`) de 500, 2.000 y 10.000 objetos: rectángulos, círculos, trazados con curvas y textos, algunos con degradado, en grupos de 50. El mismo tamaño da siempre el mismo documento.
- **Carga:** desde que la aplicación envía `document.load` hasta que el documento está activo y pintado.
- **Arrastrar, mover un degradado, escribir, zoom y desplazar:** 60 movimientos o pulsaciones separados por un fotograma:
  - Arrastrar: Ctrl+clic y arrastre de un objeto.
  - Mover un degradado: con la herramienta Degradado, arrastrar el extremo del degradado del objeto arrastrado. Lo comparte con otros, así que al empezar se le copia.
  - Escribir: con la herramienta Texto, una letra por fotograma en un texto del documento, que se reescribe con cada pulsación.
  - Zoom: Ctrl+rueda. Desplazar: rueda.
  - Durante el gesto se anota cada fotograma con `requestAnimationFrame`; el resultado son los fotogramas por segundo y el percentil 95 del tiempo entre fotogramas.
- Se ejecuta con la configuración `playwright.perf.config.ts`: un solo proceso, sin reintentos, ventana de 1280×720. Los resultados quedan en `src/engine/perf/resultados/motor.json`.

### Aplicación (`StartupTests`, categoría `Rendimiento`)

- En la CI se ejecuta justo después de instalar el paquete, antes de las demás pruebas de interfaz, para que el primer arranque sea **en frío**; después mide uno **en caliente**.
- La prueba detecta la ventana por su identificador de ventana, sin UI Automation: consultar el árbol de accesibilidad activa la de WebView2 y retrasa la carga del lienzo.
- La propia aplicación anota sus hitos (`StartupTrace`) cuando la prueba lo pide con el archivo `medir-arranque` en su carpeta de datos: la ventana carga su contenido, el lienzo empieza a crear el WebView2, el WebView2 está creado y el motor responde.
- Todos los tiempos cuentan desde que se pide a Windows arrancar la aplicación.

### Comparación (`tools/perf/compare.mjs`)

Compara cada ejecución con la referencia de `tools/perf/referencia.json` y escribe una tabla en el resumen de la ejecución de GitHub Actions:

- **Aviso** si una medida empeora más de un 25 %, y **fallo** si empeora más de un 60 %. Las diferencias muy pequeñas (menos de 3 fps, 10 ms entre fotogramas, 50 ms de carga o 250 ms de arranque) se consideran ruido.
- El arranque de la aplicación **solo avisa**: en las máquinas de la CI varía mucho de una ejecución a otra.
- También marca los objetivos del MVP 1: al menos 55 fps con 2.000 objetos (60 fps con margen para el ruido de la medición) y la ventana lista en menos de 2 s en frío.

El motor se mide en el flujo *Rendimiento* (cuando cambia `src/engine`) y el arranque en el flujo *Aplicación*. Para actualizar la referencia después de una mejora o de un cambio aceptado, se copian los valores del resumen de la CI a `referencia.json`.

## Resultados de referencia

Medidos en la CI de GitHub Actions el 2026-11-20: el motor en `ubuntu-latest` con Chromium y la aplicación en `windows-latest`. Son máquinas virtuales sin GPU, más lentas que un equipo de gama media, y sus tiempos varían entre ejecuciones; sirven para detectar regresiones, no como cifras absolutas.

### Motor

| Objetos | Carga | Arrastrar | Escribir | Mover un degradado | Zoom | Desplazar |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 44 ms | 60 fps | 60 fps | 60 fps | 60 fps | 60 fps |
| **2.000** | **85 ms** | **60 fps** | **60 fps** | **60 fps** | **59,5 fps** | **60 fps** |
| 10.000 | 362 ms | 60 fps | 60 fps | 60 fps | 34–40 fps | 48–55 fps |

Escribir y mover un degradado se midieron después, el 2026-11-27, con los documentos y la máquina de la CI de siempre.

**Con 2.000 objetos se cumple el objetivo de 60 fps.** Con 10.000, arrastrar sigue a 60 fps (solo cambia el objeto movido), pero el zoom y el desplazamiento bajan: cada fotograma vuelve a pintar el documento entero con la nueva vista. Si hace falta, se puede mejorar más adelante (por ejemplo, pintar una imagen del documento durante el gesto y redibujarlo al terminar), pero queda fuera del objetivo del MVP 1.

### Aplicación

| Desde que se pide arrancar | En frío | En caliente |
| --- | --- | --- |
| Ventana visible | 1,7 s | 0,37 s |
| **Ventana lista (contenido cargado)** | **2,4 s** | **0,53 s** |
| WebView2 del lienzo creado | 8,2 s | 0,87 s |
| Motor listo | 9,1 s | 1,0 s |

- **En caliente**, la ventana está lista en medio segundo y el lienzo en un segundo.
- **En frío**, en la máquina de la CI la ventana tarda 2,4 s, por encima del objetivo de 2 s. Es el primer arranque en una máquina virtual recién creada, con el disco y la caché del sistema vacíos; hay que comprobarlo en un equipo de gama media antes de ajustar el objetivo, como prevé el plan.
- Casi todo el tiempo hasta que el lienzo responde en frío (unos 6 s) es la **primera creación del WebView2** en la máquina, que arranca el entorno de ejecución de Edge. No depende de WinVector, pero se nota: la ventana ya se puede usar (menús, pestañas) mientras el lienzo muestra su indicador de carga.

## Pendiente

- Medir el arranque en frío en un equipo de gama media real y ajustar el objetivo de 2 s si hace falta.
