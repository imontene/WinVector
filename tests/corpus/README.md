# Corpus de SVG de referencia

Archivos SVG que WinVector debe abrir, mostrar y guardar sin dañarlos. La prueba `src/engine/src/document/corpus.browser.test.ts` los recorre todos en Chromium, el motor de WebView2, y comprueba tres cosas de cada uno:

1. **Ida y vuelta sin cambios.** Abrir y guardar sin modificar produce exactamente los mismos bytes, incluidos la marca BOM y los finales de línea.
2. **Regeneración completa.** Si se fuerza a reescribir todas las etiquetas y textos, el documento guardado sigue siendo el mismo: mismos elementos, atributos, textos, comentarios e instrucciones.
3. **Fidelidad visual.** El original y el regenerado se ven igual, comparando sus píxeles a 256 × 256. Se omite en dos casos, con el motivo en el resultado de la prueba:
   - archivos con animaciones SMIL, porque cambian con el tiempo;
   - archivos con `<foreignObject>`, porque Chromium no deja leer los píxeles de esas imágenes.

La prueba forma parte de `npm test` en `src/engine` y de la CI del motor, que se ejecuta también cuando cambia esta carpeta.

## Carpetas

| Carpeta       | Contenido                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `formas/`     | Rectángulos, círculos, polígonos, transformaciones, unidades y colores                                                      |
| `trazados/`   | Comandos de `d` absolutos y relativos, arcos, sintaxis compacta, reglas de relleno, marcadores                              |
| `texto/`      | `tspan`, espacios preservados, anclaje, texto sobre trazado, Unicode y emoji, estilos de fuente                             |
| `degradados/` | Lineales y radiales, herencia con `href`, espacio de usuario, degradados en trazos                                          |
| `estructura/` | Grupos, `use`, recortes y máscaras, patrones, estilos, metadatos, DOCTYPE, contenido activo, finales de línea, BOM, filtros |
| `ajenos/`     | Archivos reales exportados por otras aplicaciones; origen y licencia en `ajenos/FUENTES.md`                                 |

## Cómo añadir un archivo

- Usa archivos pequeños que muestren un caso concreto, con el caso en el nombre: `degradado-radial-con-foco.svg`, `trazado-arcos-relativos.svg`.
- Colócalo en la carpeta de su área.
- **Cuando encuentres un fallo** al abrir o guardar un archivo, reduce el archivo al mínimo que lo reproduzca y añádelo aquí en la misma pull request que lo corrige. Así el fallo no puede volver.
- Solo archivos que puedas compartir bajo una licencia compatible con la del proyecto. Para archivos de terceros, indica en `ajenos/FUENTES.md` de dónde salen, su autor y su licencia.
- Sin referencias a recursos externos ni scripts, salvo que el archivo pruebe precisamente cómo se conservan o se bloquean (ver `estructura/script-y-manejadores-de-eventos.svg`).
