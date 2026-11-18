# ADR 0004 · Un motor compartido para todas las pestañas

- **Estado:** Aceptada
- **Fecha:** 2026-11-18

## Contexto

Cada pestaña de WinVector es un documento. Antes de abrir archivos (Fase 1) hay que decidir cómo se reparten los documentos entre motores de edición:

1. **Un WebView2 por pestaña.** Cada documento tiene su propio control WebView2 con su propia instancia del motor.
2. **Un motor compartido.** Un único WebView2 y un único motor que gestiona varios documentos y muestra uno cada vez.

La decisión condiciona la memoria, el tiempo de carga, el cambio de pestaña, el aislamiento entre documentos y el contrato del puente.

## Mediciones

Herramienta: `tools/TabsBenchmark`, ejecutada por el workflow **Medición de pestañas**.
- **Qué carga:** el motor real (`src/engine/dist`), servido desde el host virtual `engine.winvector`.
- **Documentos de prueba:** uno distinto por pestaña, de 2.000 objetos (rectángulos, círculos, trazados y textos).
- **Aislamiento entre escenarios:** cada uno se ejecuta en un proceso nuevo, con su propia carpeta de datos de WebView2.

Entorno: runner `windows-latest` de GitHub Actions (Windows Server 2025), WebView2 Runtime 156.0.4314.58, control WebView2 de WinForms. Usa el mismo runtime y los mismos procesos que el de WinUI.

| Modelo | Pestañas | Memoria de WebView2 | Procesos de renderizado | Carga | Cambio de pestaña (mediana / máx.) |
|---|---|---|---|---|---|
| Uno por pestaña | 1 | 111 MB | 1 | 2,6 s | — |
| Uno por pestaña | 5 | 254 MB | 5 | 1,9 s | 31 / 35 ms |
| Uno por pestaña | 10 | 453 MB | 10 | 3,1 s | 32 / 47 ms |
| Compartido | 1 | 105 MB | 1 | 1,1 s | — |
| Compartido | 5 | 124 MB | 1 | 1,3 s | 31 / 37 ms |
| Compartido | 10 | 146 MB | 1 | 1,3 s | 31 / 43 ms |

Cómo se mide:
- **Memoria:** memoria privada de todos los procesos de WebView2 (navegador, renderizado, GPU y utilidades), tras 3 s de reposo.
- **Carga:** desde crear el primer control hasta mostrar el primer documento, con todos los documentos cargados.
- **Cambio de pestaña:** desde la orden hasta que el navegador pinta dos fotogramas, con 20 cambios por escenario.

Desglose a 10 pestañas:

| Proceso | Uno por pestaña | Compartido |
|---|---|---|
| Renderizado | 10 procesos, 328 MB (unos 33 MB cada uno) | 1 proceso, 72 MB |
| Navegador | 86 MB | 40 MB |
| GPU y utilidades | 38 MB | 34 MB |

## Análisis

- **Memoria.** Con un WebView2 por pestaña, cada pestaña añade unos 34 MB, casi todo por su proceso de renderizado. Con el motor compartido, cada documento de 2.000 objetos añade unos 4 MB. A 10 pestañas la diferencia es de 307 MB.
- **Carga.** El motor compartido se inicializa una sola vez. Con un WebView2 por pestaña, abrir cada pestaña cuesta crear un control y cargar el motor.
- **Cambio de pestaña.** No hay diferencia apreciable: los dos cambian en unos dos fotogramas. La medición no distingue por debajo de ese umbral.
- **Aislamiento.** Con un WebView2 por pestaña, cada documento tiene su propio proceso de renderizado: si uno falla, los demás siguen. Con el motor compartido, un fallo del proceso afecta a todos los documentos abiertos. Los estilos y los identificadores sí quedan aislados entre documentos, porque cada uno vive en su propio *shadow root* (issue #20).
- **Bloqueos.** Con el motor compartido, una operación muy pesada en un documento bloquea el lienzo mientras dura. Solo se ve un documento a la vez, así que en la práctica afecta igual en los dos modelos.
- **Contrato.** El motor compartido necesita identificar el documento en los mensajes que se refieren a uno.

## Decisión

Se adopta un **motor compartido**: un único WebView2 y un único motor gestionan todos los documentos abiertos.

- Cada documento es un `SvgDocument` en su propio contenedor con *shadow root*. Solo el de la pestaña activa está visible; los demás no se pintan ni consumen CPU.
- Cada documento tiene su propio historial de deshacer, su selección y su estado de zoom.
- Los mensajes del puente que se refieren a un documento llevan su identificador (`documentId`), y se añade un comando para activar un documento al cambiar de pestaña.
- El aislamiento ante fallos lo cubre la recuperación (issue #24). Si el proceso del motor falla, la aplicación lo vuelve a crear y recarga todos los documentos desde sus copias de recuperación.

## Consecuencias

- La memoria crece poco con el número de documentos abiertos: unos 4 MB por documento de 2.000 objetos, frente a unos 34 MB por pestaña con el otro modelo.
- La recuperación del issue #24 deja de ser solo una mejora: es la protección contra un fallo del motor, que ahora afecta a todas las pestañas. Debe probarse matando el proceso de renderizado.
- El contrato del documento (issue #22) incluye `documentId` desde el principio, y el issue #23 cambia de pestaña con un comando del puente en lugar de mostrar otro control.
- Si en el futuro hiciera falta un aislamiento fuerte, por ejemplo para extensiones de terceros, se puede revisar esta decisión. La herramienta de medición sigue en el repositorio para repetir las mediciones con `workflow_dispatch`.
- Las mediciones son de un runner de Windows Server, no de un equipo con Windows 11. Las proporciones entre modelos deberían mantenerse; los valores absolutos pueden variar.
