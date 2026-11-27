# ADR 0009 · Modelo de degradados: cadenas href, copia al editar y unidades de los nuevos

- **Estado:** Aceptada
- **Fecha:** 2026-11-22

## Contexto

La Fase 5 añade degradados lineales y radiales: aplicarlos desde el panel (#109), moverlos en el lienzo (#110), mantenerlos al transformar (#111), una biblioteca (#112) y limpiar los que sobran (#113). Todo eso necesita un modelo común, que plantea tres problemas:

- **Los degradados de otros programas heredan unos de otros.** Inkscape guarda las paradas en un degradado y la geometría en otro que lo referencia con `xlink:href`. SVG 2 usa `href`. Un atributo que falta se toma del degradado referenciado, y las paradas son las del primero de la cadena que tenga.
- **Un degradado puede estar compartido.** Varios objetos pueden pintar con el mismo, o un objeto puede usarlo en el relleno y en el trazo. También lo pueden usar sin nombrarlo: un grupo que lo hereda a sus hijos o una clase de CSS (Illustrator). Si al editar el degradado de un objeto se cambiara el compartido, cambiarían otros objetos sin que el usuario lo pida.
- **Las unidades.** Con `objectBoundingBox` (lo predeterminado) el degradado se estira con la caja del objeto. Un radial se vuelve una elipse en una forma alargada, y sus coordenadas son fracciones de la caja. Con `userSpaceOnUse` está en coordenadas del documento, como el objeto, pero hay que moverlo cuando se mueve el objeto.

## Decisión

**Lectura** (`src/engine/src/paint/gradient.ts`). Un degradado se lee como lo dibuja el navegador:

- Se sigue la cadena `href` / `xlink:href` (parando en un ciclo). Cada atributo (`gradientUnits`, `gradientTransform`, `spreadMethod`, la geometría) es el del primero de la cadena que lo tenga, con los valores por defecto de SVG si ninguno lo tiene.
- Las paradas son las del primero de la cadena que tenga alguna. Cada posición se limita entre 0 y 1, y nunca es menor que la anterior.
- El color y la opacidad de cada parada salen de su estilo calculado, vengan de atributos, del atributo `style` (Inkscape) o de CSS. La transparencia de un color `rgba` se multiplica por `stop-opacity`.
- El tipo (lineal o radial) es el del degradado al que se refiere la pintura, aunque herede de uno del otro tipo.

**Escritura.** Al cambiar un degradado se escribe solo lo que cambia, en el mismo sitio donde estaba: el atributo o la declaración del atributo `style` de la parada. Lo que se escribe tapa lo heredado. Las paradas heredadas se copian en el degradado antes de cambiarlas, y el degradado del que venían no se toca.

**Copia al editar.** Antes de cambiar el degradado de una pintura se obtiene un degradado propio de esa pintura (`ownGradient`). Es el mismo si el objeto lo declara él mismo para esa pintura y nada más del documento se refiere a él: ni otro objeto, ni su otra pintura, ni una hoja de estilos, ni otro degradado que lo herede. Si no, se hace una copia:

- Lleva sus atributos, sus paradas propias y su mismo `href`. Así sigue heredando lo que heredaba y el archivo crece poco.
- Se coloca justo detrás del original, con un id nuevo a partir del suyo (`cielo` → `cielo-2`).
- El objeto pasa a usarla: se cambia donde declaraba la pintura. Si una regla de CSS tapa el atributo, se declara en su atributo `style`.

Cambiar un degradado para todos los objetos que lo usan es una acción explícita de la biblioteca (#112).

**Degradados nuevos:** en `userSpaceOnUse`, con la geometría en coordenadas del objeto. Es lo que hacen Inkscape e Illustrator, un radial sigue siendo circular en cualquier forma, y los manejadores del lienzo (#110) trabajan en las mismas coordenadas que el objeto. A cambio, al mover o escalar un objeto hay que actualizar su degradado (#111). Los degradados en `objectBoundingBox` de otros programas se respetan y se editan en sus unidades.

**Al transformar** (#111). Un degradado en `userSpaceOnUse` está en las coordenadas del objeto que lo usa. Si al mover o escalar un objeto se le añade o cambia el `transform`, el degradado lo acompaña sin más. Pero los rectángulos, elipses, círculos, líneas e imágenes sin `transform` se mueven y escalan reescribiendo sus coordenadas, y entonces hay que aplicar al degradado la misma transformación:

- Si no tiene `gradientTransform` y la transformación solo mueve y escala sin girar, se cambian sus coordenadas. Un radial solo se cambia así si la escala es la misma en los dos ejes. El foco solo se escribe si ya estaba escrito.
- Si no, se compone su `gradientTransform`.
- Siempre sobre su degradado propio: si lo comparte, se copia antes. En un arrastre, la copia se hace al empezar el gesto, dentro de su paso del historial. Un gesto que no mueve nada, o que se cancela, no deja ni el paso ni la copia.

Los degradados en `objectBoundingBox` siguen a la caja del objeto sin tocarlos. Desagrupar pasa la transformación del grupo al `transform` de cada objeto, así que también se ven igual.

**Biblioteca** (#112). Como en Inkscape, las paradas se comparten y la posición es de cada objeto. La biblioteca del documento son los degradados con paradas propias, y se anuncia a la aplicación con `document.gradients`.

- Usar uno en un objeto le crea un degradado propio, en `userSpaceOnUse` y colocado sobre él, que hereda sus paradas por `href`. Si el de la biblioteca es en `objectBoundingBox` sin transformación, el objeto lo usa tal cual.
- Cambiar las paradas «para todos» (`shared`) las escribe en el degradado que las tiene, sin copiarlo.
- Duplicar da al objeto una copia de las paradas.
- Los predefinidos crean un degradado nuevo con sus paradas.

**Contrato.** `selection-changed` describe el degradado común del relleno y del trazo (`fillGradient`, `strokeGradient`): id, tipo, repetición, paradas y cuántas pinturas de objetos lo usan directamente. La geometría no viaja por el puente, porque solo la usa el motor (manejadores del lienzo). El relleno y el trazo siguen valiendo `"url"` cuando son un degradado.

## Consecuencias

- Los degradados de Inkscape, Illustrator y Figma del corpus se leen correctamente, y leerlos no cambia el documento.
- Editar un degradado nunca cambia otros objetos. La copia puede dejar el original sin uso (por ejemplo, cuando dos objetos lo compartían y ambos se editan). La limpieza de definiciones del #113 se ocupa de eso.
- Los ids nuevos siguen al del original (`-2`, `-3`…), así que se reconoce de dónde viene cada copia.
- Un degradado heredado de un grupo o aplicado por una clase de CSS pasa a declararse en el propio objeto al editarlo. El archivo cambia un poco más, pero solo cambia ese objeto.
