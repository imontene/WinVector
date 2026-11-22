# ADR 0008 · Redondeo de vértices con arcos exactos y su forma original en el archivo

- **Estado:** Aceptada
- **Fecha:** 2026-11-21

## Contexto

El issue #80 pide redondear uno o varios vértices de un polígono o un trazado con un radio exacto, que cada vértice pueda tener su propio radio y que el redondeo se pueda cambiar o quitar después, también tras guardar y volver a abrir el archivo.

SVG no tiene esquinas redondeadas para polígonos ni trazados. Una vez redondeada, una esquina es otra geometría: un arco entre dos rectas más cortas. A partir de ese arco no se puede saber con seguridad dónde estaba el vértice ni qué radio se pidió, sobre todo si el radio se redujo porque no cabía.

Hasta ahora, los polígonos regulares y estrellas (#58) se redondeaban con curvas cuadráticas: se parecen a un arco, pero no lo son.

## Decisión

**Geometría.** Cada esquina entre dos rectas se sustituye por un arco circular (`A`) tangente a las dos, con el radio pedido (`src/engine/src/paths/round.ts`).
- Si los arcos de los dos extremos de un lado no caben en él, los dos se reducen en la misma proporción.
- Solo se redondean las esquinas entre dos rectas. Los extremos de un trazado abierto y los nodos junto a una curva se dejan como están.
- Los polígonos regulares y estrellas del #58 usan los mismos arcos. Su redondeo sigue siendo proporcional, de 0 a 1.

**Archivo.** Un trazado redondeado se guarda como un `<path>` normal, con su `d` redondeado, que cualquier programa dibuja igual. Además lleva dos atributos:
- `data-winvector-unrounded`: el `d` sin redondear, con los vértices originales.
- `data-winvector-corner-radii`: el radio de cada vértice redondeado, como `clave=radio` separados por espacios (por ejemplo, `0:1=10 0:3=30`). La clave es la de `pathNodes` en el `d` sin redondear: subtrazado y número de nodo.

El radio que se guarda es el que de verdad tiene la esquina, ya limitado a lo que cabe.

**Edición.**
- La herramienta Vértices trabaja con la forma sin redondear: muestra y mueve los vértices originales, y los arcos se vuelven a calcular.
- Con la herramienta Selección, el panel cambia a la vez el radio de todas las esquinas entre dos rectas de los polígonos, polilíneas y trazados seleccionados (issue #114). Se guardan igual, un radio por vértice. Los rectángulos y los polígonos regulares y estrellas conservan su propio redondeo.
- Añadir o quitar nodos y cambiar su tipo conservan el radio de los nodos que siguen en el mismo punto.
- Las operaciones del menú Trazado (cerrar, abrir, invertir, combinar, separar) trabajan con lo que se ve y olvidan el redondeo: el trazado queda con sus arcos como un trazado normal.

## Consecuencias

- El archivo se ve igual en cualquier programa. Otros programas ignoran los atributos `data-winvector-*`.
- Si otro programa cambia el `d` sin tocar los atributos, al volver a editarlo en WinVector se recupera la forma guardada en `data-winvector-unrounded`. Es el mismo riesgo que tienen ya los polígonos y estrellas con parámetros (#58), y se acepta por el mismo motivo: sin esos atributos no se podría cambiar el redondeo.
- Los polígonos y estrellas redondeados con versiones anteriores tienen curvas cuadráticas en su `d`. Al cambiar cualquier parámetro se vuelven a escribir con arcos.
- Un rectángulo, un polígono o una polilínea que se redondean pasan a ser un `<path>`, como al convertirlos en trazado.
