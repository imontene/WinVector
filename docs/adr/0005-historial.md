# ADR 0005 · Historial de deshacer basado en los cambios del DOM

- **Estado:** Aceptada
- **Fecha:** 2026-11-19

## Contexto

El plan preveía un historial con el patrón comando: cada operación de edición sería un objeto con `execute` y `undo` (issue #26). El criterio de aceptación es que cualquier cambio de la Fase 1 se pueda deshacer y rehacer, y que el documento quede exactamente como estaba.

Con el patrón comando, cada herramienta tiene que escribir también la inversa de lo que hace. Si una inversa olvida un detalle, el error solo aparece al deshacer esa operación concreta. Y las operaciones que tocan muchos nodos (desagrupar, convertir a trayecto, pegar estilos) tienen inversas largas.

El documento es un DOM, y `SvgDocument` ya observa sus cambios con un `MutationObserver` para la serialización sin pérdidas (issue #20).

## Decisión

El historial registra los cambios del DOM y sabe invertirlos. Las herramientas no escriben inversas.

- El observador se configura con `attributeOldValue` y `characterDataOldValue`. Cada `MutationRecord` se convierte en una operación: un atributo con su valor anterior, un texto con su valor anterior, o una lista de hijos añadidos y quitados con su posición.
- Un **paso** agrupa las operaciones de una acción. Las herramientas delimitan la acción con `history.transact(acción, cambio)` o `begin`/`commit`; un arrastre completo es un solo paso. Los cambios hechos fuera de una transacción forman un paso cada vez que el observador los entrega.
- Los pasos seguidos con la misma **clave de fusión** se funden: escribir en un campo numérico o mover con las flechas se deshace de una vez.
- Dentro de un paso, los cambios de un mismo atributo o texto se resumen en el primer valor anterior y el valor final. Un paso que no cambia nada (un arrastre que vuelve al origen) no se guarda.
- Deshacer invierte las listas de hijos en orden inverso y restaura los valores anteriores; rehacer hace lo contrario. Los cambios que provoca no generan pasos nuevos.
- La **revisión** del documento identifica su estado: cada edición recibe una revisión nueva y, al deshacer o rehacer, el documento vuelve a la revisión de ese estado. La aplicación compara la revisión con la guardada, así que deshacer hasta lo guardado deja la pestaña sin cambios.
- El serializador copia del texto original los nodos que han vuelto a su estado original, aunque se hayan tocado. Deshacer todo devuelve exactamente el texto del archivo.

Los atajos (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+Mayús+Z`) los atiende solo la aplicación, con los aceleradores del menú Editar, y envían `history.undo` y `history.redo`. El motor no los atiende, para no deshacer dos veces.

## Consecuencias

- Cualquier cambio del documento se puede deshacer, también los de herramientas futuras, sin código adicional. Lo que sí tienen que hacer las herramientas es agrupar sus cambios en transacciones con un nombre de acción, para que el menú diga "Deshacer mover".
- El historial no puede deshacer lo que no está en el DOM: estado de la interfaz como la selección o el zoom no forma parte de él.
- Un paso guarda referencias a los nodos que añade o quita, incluidos los borrados, que siguen en memoria mientras el paso esté en el historial. El historial es ilimitado; si la memoria se convierte en un problema con documentos grandes (issue #34), se puede limitar el número de pasos.
- Los cambios de estilo dentro de un `<style>` son cambios de texto y se deshacen igual que los demás.
