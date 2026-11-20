# ADR 0006 · Edición de texto en el lienzo con cursor propio sobre el SVG

- **Estado:** Aceptada
- **Fecha:** 2026-11-20

## Contexto

La Fase 4 trae la herramienta de texto: crear texto con un clic y editarlo directamente en el lienzo, con cursor, selección, varias líneas, fuentes del sistema y propiedades tipográficas (PLAN.md, sección 4.4). El plan marca la edición de texto en el lienzo como un riesgo y pide un prototipo temprano (issue #35).

El problema de fondo: el SVG no tiene edición de texto. Un `<text>` se dibuja, pero no tiene cursor, ni selección editable, ni recibe el teclado, el IME o las tildes con teclas muertas, ni se anuncia como un campo editable a un lector de pantalla. Algo tiene que poner todo eso, sin que el texto que se ve deje de ser el `<text>` del documento.

## Enfoques probados

El prototipo está en `src/engine/prototipos/texto/` (se abre con `npm run dev` en `/prototipos/texto/`, doble clic en un texto para editarlo) y lo comprueba `npm run prototipos`. En la CI se ejecuta en Windows con Edge, el mismo motor que WebView2 y con las fuentes de Windows, y en Linux con Chromium (flujo *Prototipo de texto*).

Los dos enfoques comparten el modelo: un texto de varias líneas es un `<text>` con un `<tspan>` por línea, y cada `<tspan>` lleva `x` e `y` absolutos.

**A · Editor HTML superpuesto.** Un `contenteditable` transparente se coloca exactamente encima del `<text>`, con la misma fuente y la transformación que el texto tiene en pantalla (`getScreenCTM`). La línea base se alinea con las métricas de la fuente (medio interlineado más el ascendente). El SVG sigue dibujando el texto, que se reescribe con cada cambio; del editor solo se ven el cursor y la selección del navegador.

**B · Cursor y selección propios.** El cursor y la selección se dibujan en el SVG con su propia geometría (`getStartPositionOfChar`, `getExtentOfChar`), en una capa con la misma transformación que el texto. El teclado lo recibe un `textarea` invisible que sigue al cursor. El `textarea` hace lo que el sistema ya sabe hacer con texto (escribir, borrar, teclas muertas, IME, atajos de selección, portapapeles, deshacer) y es lo que lee el lector de pantalla. El SVG se reescribe a partir de su valor, y el cursor y la selección se dibujan según la selección del `textarea`. El ratón y las flechas arriba y abajo se resuelven con la geometría del SVG.

## Resultados

### Funcionamiento

| Comprobación | A · superpuesto | B · propio |
| --- | --- | --- |
| Escribir con tildes y eñes | ✅ | ✅ |
| Borrar | ✅ | ✅ |
| Seleccionar con el teclado (Mayús + flechas) | ✅ | ✅ |
| Seleccionar arrastrando con el ratón | ✅ | ✅ |
| Varias líneas: Intro, flechas arriba y abajo, líneas vacías | ✅ | ✅ |
| IME en japonés: el texto provisional se ve en el lienzo mientras se compone | ✅ | ✅ |
| Árbol de accesibilidad de Chromium: campo de texto con nombre y valor | ✅ | ✅ |
| Deshacer del navegador (Ctrl+Z) dentro de la edición | ✅ | ✅ |

Los dos enfoques funcionan porque, en el fondo, los dos usan un control de texto del navegador. Las tildes con teclas muertas no se pueden simular desde Playwright (las compone Windows antes de que lleguen al navegador); llegan como texto ya compuesto o como una composición, que son los dos casos probados.

### Precisión

Se midió con 27 textos: cuatro familias (sans, serif, monoespaciada y japonés, con Segoe UI, Georgia, Consolas y Yu Gothic en Windows), tamaños de 11, 24 y 48, espaciado entre letras y seis transformaciones (ninguna, escala 2, escala 0,5, rotación de 15°, sesgo de 20° y escala 2×1).

- **A:** diferencia entre dónde coloca cada carácter el editor HTML y dónde lo dibuja el SVG, en píxeles de pantalla. Es el desvío que tendrían el cursor y la selección respecto al texto.
- **B:** si el cálculo de la posición acierta el carácter de un punto, con la geometría del SVG y con clics reales del ratón.

| Resultado (Windows, Edge) | A · superpuesto | B · propio |
| --- | --- | --- |
| Desvío horizontal máximo | 0,12 px | 0 (por construcción) |
| Desvío vertical sin transformación | hasta 0,9 px | 0 (por construcción) |
| Desvío vertical con escala 2 | hasta 2,8 px (japonés), 1,8 px (serif) | 0 |
| Desvío vertical con escala 2×1 o sesgo | hasta 2,1 px | 0 |
| Carácter acertado al calcular / al hacer clic | — | 100 % / 100 % |

En Linux con Chromium los valores son parecidos (horizontal hasta 0,3 px, vertical hasta 0,9 px).

En horizontal, el HTML y el SVG colocan los caracteres prácticamente igual: los dos usan la misma composición de texto de Chromium. El desvío está en vertical: la línea HTML redondea su línea base a píxeles enteros antes de aplicar la transformación, y la transformación multiplica ese redondeo. Con el zoom del lienzo pasa lo mismo, así que a 800 % el cursor de A podría quedar unos 10 px por encima o por debajo del texto. Con fuentes de reserva (los caracteres japoneses dentro de una fuente latina) el ascendente que usa el HTML tampoco es el de la fuente que acaba dibujando cada carácter.

## Decisión

La Fase 4 usará el **enfoque B: cursor y selección propios sobre el SVG, con un `textarea` invisible para la entrada**.

- **Lo que se ve es siempre el SVG.** El cursor y la selección se calculan con la geometría del propio `<text>`, así que coinciden con los caracteres por construcción, con cualquier fuente, tamaño o transformación, y con lo que se guardará. En A, el cursor y la selección los coloca la disposición HTML, que se acerca a la del SVG pero no es la misma.
- **La entrada la sigue haciendo el sistema.** El `textarea` da gratis el IME (y coloca su ventana junto al cursor), las teclas muertas, los atajos de edición del sistema y el portapapeles de texto, y es un campo de texto real para el lector de pantalla.
- **Funciona igual con transformaciones que el HTML no puede reproducir.** A depende de que una transformación CSS reproduzca la del SVG; con un `<text>` dentro de `<textPath>`, con `rotate` por carácter o con `x`/`y` por carácter, la disposición HTML ya no se parece a la del SVG. B solo usa la geometría que el SVG ya calcula.

A sería más sencillo para texto en área con ajuste de línea (el HTML lo hace solo), pero eso queda fuera del MVP 1 (PLAN.md, MVP 4).

## Consecuencias

- **Escritura del documento.** Las líneas se escriben como `<tspan>` con `x` e `y` absolutos, y el `<text>` lleva `xml:space="preserve"`: sin él, el SVG junta los espacios seguidos y quita los del principio y el final, y los caracteres dejan de corresponder con lo escrito. Con `dy` relativo, una línea vacía no tendría caracteres a los que aplicarlo y desaparecería.
- **Historial.** Cada pulsación reescribe los `<tspan>`. La edición entera debe ser una transacción del historial (ADR 0005), "Editar texto", que se abre al entrar y se confirma al salir. Dentro de la edición, Ctrl+Z y Ctrl+Y los atiende el `textarea` (deshacer del navegador); fuera, el historial del documento.
- **Atajos.** Mientras se edita, el motor no debe interpretar como atajos de herramientas las teclas que van al `textarea` (letras, Supr, flechas). Esc y un clic fuera terminan la edición.
- **Lector de pantalla.** El `textarea` necesita un nombre accesible ("Texto", o el contenido del texto) y estar dentro del lienzo, que ya expone su contenido a UI Automation (issue #40). Falta comprobarlo con Narrador en Windows 11 cuando exista la herramienta de texto.
- **Pendiente para la Fase 4.**
  - Texto con varios estilos en una misma línea (`<tspan>` anidados): el modelo de líneas pasa a ser un modelo de tramos, y escribir debe conservar los atributos de cada tramo en lugar de reescribir las líneas.
  - `text-anchor` centrado y a la derecha: el cursor es correcto (usa la geometría del SVG), pero escribir debe mantener el anclaje.
  - Texto de derecha a izquierda y bidireccional: el cálculo de la columna desde un punto supone texto de izquierda a derecha.
  - Caracteres fuera del plano básico (emoji, algunos CJK): el SVG numera los caracteres en unidades UTF-16, igual que el `textarea`, pero hay que comprobar los pares sustitutos y los grupos de grafemas al mover el cursor.
  - Interlineado: el prototipo usa 1,2 veces el tamaño de la fuente; la Fase 4 lo hará configurable.
