# ADR 0007 · Modelo de trazados y edición de arcos

- **Estado:** Aceptada
- **Fecha:** 2026-11-21

## Contexto

La Fase 3 edita trazados: la herramienta de nodos, la pluma con curvas, las operaciones del menú Trazado y el redondeo de vértices (issues #74 a #81). Todas necesitan leer un `d`, trabajar con él y volver a escribirlo.

El atributo `d` admite muchas formas de escribir lo mismo:
- comandos absolutos y relativos;
- abreviaturas: `H` y `V` para las rectas horizontales y verticales, `S` y `T` para las curvas que reflejan el control anterior, y la repetición implícita de un comando;
- números pegados (`1-2`, `.5.5`), exponentes y banderas de arco sin separador (`a1 1 0 01 5 5`).

Además, los arcos (`A`) no son curvas de Bézier. Se definen por sus radios, el giro de la elipse y dos banderas, así que no tienen manejadores que se puedan arrastrar.

## Decisión

**Modelo.** Un trazado es una lista de subtrazados. Cada subtrazado tiene un punto inicial, sus segmentos y si está cerrado. Los segmentos van en **coordenadas absolutas** y son de cuatro tipos: recta, cúbica, cuadrática y arco (`src/engine/src/paths/model.ts`). Al leer, las abreviaturas se resuelven: `H` y `V` son rectas, y `S` y `T` son curvas con el control reflejado ya calculado. Las herramientas trabajan siempre con puntos absolutos, sin casos especiales.

**Lectura.** El analizador (`paths/parse.ts`) sigue la gramática de SVG 2. Si encuentra un error, se queda con lo leído hasta el último segmento completo, como hacen los navegadores al dibujar, e indica dónde estaba el error. Nunca lanza una excepción por un `d` mal formado.

**Escritura.** El serializador (`paths/serialize.ts`) escribe de forma compacta y legible:
- en cada segmento elige la forma más corta entre la absoluta y la relativa;
- usa `H`, `V`, `S` y `T` cuando valen;
- no repite la letra de un comando seguido;
- escribe los números sin ceros de más ni separadores innecesarios, con 3 decimales como máximo;
- deja espacios entre las banderas de los arcos, aunque se puedan pegar, para que se lean mejor;
- redondea los puntos antes de calcular las coordenadas relativas, así que un trazado largo no acumula errores de redondeo.

**Trazados sin editar.** Solo se reescribe el `d` de un trazado que se edita. Uno que no se toca se guarda exactamente como llegó, porque el documento conserva el texto original de los nodos sin cambios (ADR 0005).

**Arcos.** Un arco se mantiene como arco mientras solo se muevan sus extremos: sus radios, su giro y sus banderas no cambian. Cuando el usuario toca algo que un arco no puede expresar, se convierte en curvas cúbicas, con un error pequeño y acotado. Pasa al arrastrar el punto medio de la curva, al convertir el nodo en suave o simétrico, o al partir el segmento.

## Consecuencias

- Las herramientas de la Fase 3 trabajan con un solo modelo y en coordenadas absolutas.
- Los arcos de los archivos de otros programas sobreviven a las ediciones habituales, que son mover nodos.
- Un arco convertido en curvas no vuelve a ser un arco. Hay que avisarlo en la barra de estado, como con las estrellas que pasan a ser polígonos.
- El redondeo a 3 decimales basta para el diseño en pantalla. Si un documento necesitara más precisión, por ejemplo coordenadas muy grandes con detalles muy pequeños, la opción `precision` del serializador permite subirla.
- Las pruebas comprueban:
  - cada comando y cada caso de la gramática;
  - que leer, escribir y volver a leer 300 trazados al azar da la misma geometría y el mismo texto;
  - que los trazados del corpus de `tests/corpus` dan la misma caja y la misma longitud en el navegador antes y después de escribirlos.
