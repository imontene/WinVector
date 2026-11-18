# Plan del proyecto WinVector

Editor gráfico de SVG para Windows 11, nativo y moderno.

| | |
|---|---|
| Estado | Planificación aprobada, pendiente de iniciar la Fase 0 |
| Versión objetivo | MVP 1 → `v0.1.0` |
| Licencia | Apache 2.0 |
| Repositorio | Público en GitHub |

---

## 1. Visión

WinVector es un editor vectorial que se siente parte de Windows 11: ventana con Mica, pestañas en la barra de título, controles Fluent, tema claro/oscuro y color de énfasis del sistema. Trabaja directamente sobre SVG, el archivo que abre es el archivo que guarda: sin formatos propios y sin perder lo que no entiende.

### Principios

1. **El SVG es el formato nativo.** No hay formato intermedio. Lo que el usuario ve en pantalla es el SVG real renderizado.
2. **No destruir archivos ajenos.** Elementos, atributos, comentarios y espacios de nombres desconocidos se conservan al guardar.
3. **Nativo donde se toca, web donde se dibuja.** Toda la interfaz es WinUI 3; solo el lienzo usa WebView2.
4. **El motor de edición es independiente de la interfaz.** Se desarrolla y prueba en un navegador, sin Windows.
5. **SVG limpio a la salida.** Atributos legibles, sin basura de editor, `defs` sin elementos huérfanos.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Interfaz principal | **Opción A, Estudio clásico**: herramientas a la izquierda, propiedades a la derecha, reglas, menús y pestañas de documento |
| Vista opcional | **Opción C, Diseño + código**: vista dividida con el código SVG en vivo, activable desde el menú Ver (llega en el MVP 2) |
| Arquitectura | **WinUI 3 + WebView2**: shell nativo en C#, lienzo y motor de edición en TypeScript |
| Nombre | WinVector |
| Licencia | Apache 2.0 |
| Alcance MVP 1 | Formas, trazados, texto y degradados |

La justificación de la arquitectura está en [ADR 0001](adr/0001-arquitectura-winui3-webview2.md).

---

## 3. Arquitectura

```
┌───────────────────────────────────────────────────────────────────┐
│  Shell nativo · WinUI 3 (C# / .NET)                               │
│  Ventana + Mica · TabView · MenuBar · CommandBar · paneles        │
│  Archivos · portapapeles · ajustes · localización · fuentes       │
└──────────────┬─────────────────────────────────▲──────────────────┘
               │ comandos (JSON)                 │ eventos (JSON)
┌──────────────▼─────────────────────────────────┴──────────────────┐
│  Puente tipado · contrato compartido en /contracts                │
└──────────────┬─────────────────────────────────▲──────────────────┘
┌──────────────▼─────────────────────────────────┴──────────────────┐
│  Lienzo · WebView2 + motor de edición (TypeScript)                │
│  Documento (DOM SVG) · herramientas · historial · geometría       │
│  Superposición de edición (manejadores, guías) · serialización    │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1 Shell nativo (`src/WinVector.App`)

- **Tecnología:** C#, .NET (LTS vigente), Windows App SDK con WinUI 3, empaquetado MSIX.
- **Patrón:** MVVM con `CommunityToolkit.Mvvm`.
- **Ventana:** `MicaBackdrop`, `ExtendsContentIntoTitleBar` con `TabView` en la barra de título (una pestaña por documento).
- **Responsabilidades:**
  - Menús, barra de comandos, barra de herramientas, panel de propiedades, barra de estado.
  - Abrir, guardar y archivos recientes (el shell lee y escribe el disco; el motor nunca accede a archivos).
  - Portapapeles de Windows (SVG como texto y como `image/svg+xml`).
  - Lista de fuentes del sistema para la herramienta de texto.
  - Ajustes, temas, atajos de teclado y localización (español e inglés desde el inicio, con `.resw`).
- **Carga del lienzo:** el bundle del motor se sirve desde la carpeta de la app con `SetVirtualHostNameToFolderMapping` (por ejemplo `https://engine.winvector/`). Sin servidor local ni red.

### 3.2 Motor de edición (`src/engine`)

- **Tecnología:** TypeScript estricto, Vite para el bundle, Vitest para pruebas unitarias, Playwright (Chromium, el mismo motor de WebView2) para pruebas de integración.
- **Sin framework de UI.** El motor manipula el DOM SVG directamente; la interfaz de usuario está en el shell.
- **Módulos:**
  - `document`: carga y serialización SVG, preservación de contenido desconocido, gestión de `defs` e identificadores.
  - `history`: patrón comando, deshacer/rehacer, agrupación de cambios continuos (un arrastre = un paso).
  - `selection`: selección simple, múltiple y por marco; entrada y salida de grupos.
  - `tools`: selección, nodos, pluma, formas, texto, degradado, mano y zoom. Cada herramienta es una máquina de estados sobre eventos de puntero.
  - `geometry`: análisis de `d` (todos los comandos, absolutos y relativos), matrices de transformación, cajas delimitadoras, impacto (hit testing), ajuste a cuadrícula.
  - `overlay`: capa SVG separada para manejadores, guías y vista previa. Nunca se mezcla con el documento.
  - `viewport`: zoom y desplazamiento.
  - `bridge`: implementación del contrato de mensajes.

### 3.3 Puente (`contracts/`)

- Comunicación por `PostWebMessageAsJson` (shell → motor) y `chrome.webview.postMessage` (motor → shell). No se usan objetos host.
- El contrato se define una sola vez (JSON Schema) y se generan los tipos de TypeScript y C#, para que una divergencia rompa la compilación.
- Tres tipos de mensaje:
  - **Comando** (shell → motor), con respuesta opcional: `document.load`, `document.serialize`, `tool.select`, `selection.applyStyle`, `history.undo`, `view.zoomTo`…
  - **Evento** (motor → shell): `selection.changed`, `document.changed`, `history.changed`, `viewport.changed`, `tool.changed`, `error`.
  - **Respuesta**: correlacionada por `id`, con resultado o error.
- **Fuente de verdad:** el documento vive en el motor. El shell guarda la ruta del archivo, el estado "modificado" y una copia de las propiedades de la selección para pintar los paneles.

### 3.4 Estructura del repositorio

```
WinVector/
├─ src/
│  ├─ WinVector.App/          Shell WinUI 3 (C#)
│  ├─ WinVector.Core/         Lógica C# sin UI: archivos, ajustes, cliente del puente
│  └─ engine/                 Motor de edición (TypeScript)
├─ contracts/                 Esquemas del puente y generación de tipos
├─ tests/
│  ├─ WinVector.Core.Tests/   Pruebas C#
│  ├─ engine/                 Unitarias e integración del motor
│  └─ corpus/                 SVG de referencia para fidelidad e ida y vuelta
├─ docs/
│  ├─ PLAN.md
│  └─ adr/                    Registro de decisiones de arquitectura
├─ .github/workflows/         CI y publicación
├─ LICENSE · NOTICE · README.md
```

---

## 4. MVP 1: formas, trazados, texto y degradados

Objetivo: una aplicación instalable con la que se pueda crear y editar una ilustración sencilla de principio a fin, y abrir y guardar SVG de terceros sin dañarlos.

### 4.1 Base imprescindible

Sin esto no se pueden usar las cuatro áreas del MVP, así que forma parte de él.

**Ventana e interfaz (opción A)**
- Ventana con Mica, pestañas de documento, menú (Archivo, Editar, Objeto, Trazado, Texto, Ver, Ayuda), barra de comandos, barra de herramientas vertical, panel de propiedades, reglas y barra de estado.
- Tema claro y oscuro siguiendo el sistema; color de énfasis del sistema.
- Paleta de comandos (`Ctrl+K`) para buscar cualquier acción.

**Archivos**
- Nuevo documento con tamaño predefinido o personalizado (px, mm, pulgadas).
- Abrir `.svg` (diálogo, arrastrar y soltar, archivos recientes y desde el Explorador con "Abrir con").
- Guardar y Guardar como; aviso al cerrar con cambios sin guardar.
- Asociación de archivo `.svg` en el paquete MSIX (opcional para el usuario).

**Edición**
- Deshacer y rehacer ilimitados por documento.
- Cortar, copiar, pegar, duplicar y eliminar (pegar SVG desde otras aplicaciones).
- Seleccionar todo, deseleccionar.

**Lienzo**
- Zoom con rueda, pellizco, atajos y "ajustar a ventana"; desplazamiento con barra espaciadora, botón central o herramienta mano.
- Mesa de trabajo (tamaño y `viewBox` editables), cuadrícula visible y ajuste a cuadrícula.

**Selección y transformación**
- Clic, `Mayús`+clic y selección por marco.
- Mover, escalar (proporcional con `Mayús`) y rotar con manejadores; mover con flechas.
- Panel con X, Y, ancho, alto y rotación editables numéricamente.
- Orden de apilado: traer al frente, enviar al fondo, subir y bajar un nivel.
- Agrupar y desagrupar; doble clic para entrar en un grupo (necesario para editar SVG importados).

**Estilo básico**
- Relleno de color sólido o ninguno; trazo de color sólido con grosor; opacidad del objeto.
- Selector de color con HEX, RGB y HSL, más cuentagotas dentro del lienzo.
- Los estilos avanzados de relleno y borde quedan para MVP futuros (sección 6).

### 4.2 Formas

- Rectángulo (con esquinas redondeadas `rx`/`ry`), elipse y círculo, línea, polígono regular y estrella.
- Modificadores: `Mayús` para proporciones iguales, `Alt` para dibujar desde el centro.
- Propiedades específicas en el panel (radio de esquina, número de lados, radio interior de la estrella).
- Las formas se guardan como su elemento SVG nativo (`rect`, `ellipse`, `circle`, `line`, `polygon`), no como trazados.
- Convertir forma a trazado.

### 4.3 Trazados

- Lectura correcta de todos los comandos de `d`: `M L H V C S Q T A Z`, absolutos y relativos.
- Herramienta pluma: clic para nodos de esquina, arrastrar para curvas Bézier, cerrar el trazado sobre el primer nodo.
- Herramienta de nodos: mover nodos y manejadores, añadir y eliminar nodos, convertir entre esquina, suave y simétrico, abrir y cerrar trazados, selección múltiple de nodos.
- Un trazado que no se edita se guarda exactamente como llegó; uno editado se reescribe de forma compacta y legible.
- Regla de relleno `nonzero` / `evenodd`.

### 4.4 Texto

- Herramienta de texto: clic para crear texto, edición directamente en el lienzo con cursor y selección.
- Varias líneas (`tspan` por línea) con interlineado.
- Fuente (lista de fuentes del sistema), tamaño, peso, cursiva y alineación (`text-anchor`).
- El color del texto usa el relleno y el trazo del estilo básico; admite degradados.
- Aviso cuando el documento usa fuentes que no están instaladas en el equipo.
- Fuera del MVP 1: convertir texto a trazados, texto sobre trazado y tipografía avanzada (ver "Texto vectorial" en la sección 6).

### 4.5 Degradados

- Degradados lineales y radiales aplicables a relleno y a trazo.
- Editor de paradas en el panel: añadir, eliminar y mover paradas; color y opacidad por parada.
- Manejadores en el lienzo: dirección y longitud (lineal), centro, radio y foco (radial).
- Biblioteca del documento: reutilizar un degradado existente; los degradados se guardan en `defs` con identificadores legibles.
- Limpieza automática de degradados sin uso al guardar.
- Lectura de degradados existentes con `gradientUnits`, `gradientTransform` y `href` a otros degradados.

### 4.6 Criterios de aceptación del MVP 1

| Área | Criterio |
|---|---|
| Fidelidad | El corpus de referencia de `tests/corpus` se abre sin errores y se ve igual que en Edge |
| Ida y vuelta | Abrir y guardar sin cambios produce un SVG equivalente (mismo resultado visual, contenido desconocido intacto) |
| Rendimiento | Interacción fluida (60 fps) con documentos de 2.000 objetos en un equipo de gama media |
| Arranque | Ventana lista en menos de 2 s en arranque en frío |
| Estabilidad | Sin cierres inesperados en las pruebas de integración; guardado automático de recuperación |
| Accesibilidad | Toda la interfaz nativa operable con teclado y lector de pantalla; contraste correcto en ambos temas |
| Distribución | MSIX instalable desde GitHub Releases |

Los valores de rendimiento son objetivos iniciales; se ajustarán tras las primeras mediciones de la Fase 1.

---

## 5. Fases de trabajo del MVP 1

Las fases son secuenciales; cada una termina con algo funcionando y probado. El tamaño es relativo (S, M, L), sin fechas hasta conocer la dedicación del equipo.

### Fase 0 · Fundaciones (M)
- Estructura del repositorio, `.editorconfig`, plantillas de issues y pull requests, `CONTRIBUTING.md`.
- Proyecto WinUI 3 vacío con Mica, pestañas y un WebView2 que carga el motor desde la carpeta local.
- Proyecto del motor con Vite, Vitest y Playwright.
- Contrato del puente con generación de tipos y un mensaje de prueba en ambos sentidos.
- CI en GitHub Actions: compilación y pruebas del motor (Linux), compilación del shell y empaquetado MSIX sin firmar (Windows).
- **Resultado:** la app abre, muestra un SVG fijo y el shell recibe eventos del motor.

### Fase 1 · Documento y lienzo (L)
- Carga y serialización con preservación de contenido desconocido; corpus de referencia y pruebas de ida y vuelta.
- Abrir, guardar, nuevo, recientes, aviso de cambios, recuperación.
- Zoom, desplazamiento, mesa de trabajo, reglas, cuadrícula.
- Historial deshacer/rehacer.
- Selección, transformaciones, panel de propiedades conectado, orden de apilado, agrupar.
- Portapapeles.
- Estilo básico y selector de color.
- **Resultado:** se pueden abrir SVG de terceros, moverlos, recolorearlos y guardarlos sin dañarlos.

### Fase 2 · Formas (M)
- Herramientas de rectángulo, elipse, línea, polígono y estrella, con modificadores y propiedades específicas.
- Convertir forma a trazado.

### Fase 3 · Trazados (L)
- Analizador y serializador de `d` con pruebas exhaustivas.
- Herramienta pluma y herramienta de nodos.

### Fase 4 · Texto (M)
- Herramienta de texto, edición en el lienzo, varias líneas, fuentes del sistema, propiedades tipográficas.

### Fase 5 · Degradados (M)
- Degradados lineales y radiales, editor de paradas, manejadores en el lienzo, biblioteca y limpieza de `defs`.

### Fase 6 · Estabilización y publicación de `v0.1.0` (M)
- Pruebas de rendimiento y accesibilidad, corrección de errores.
- Localización completa en español e inglés.
- Firma del paquete, publicación en GitHub Releases, notas de versión.
- Documentación de usuario básica en el README.

---

## 6. MVP futuros

Tras el MVP 1 se podrán abordar las siguientes funciones. El orden es una propuesta y se revisará al cerrar cada versión según la respuesta de los usuarios.

### MVP 2 · Organización y vista de código
- **Capas:** panel de capas con árbol del documento, visibilidad, bloqueo, renombrado y reordenación por arrastre.
- **Vista de código (opción C):** vista dividida con el SVG en vivo, sincronización en ambos sentidos entre lienzo y código, resaltado de la selección, validación.
- Alinear y distribuir objetos; guías y ajuste a objetos.

### MVP 3 · Exportación
- **PNG** y **WebP** con escala, fondo transparente y exportación de la selección o de la mesa de trabajo.
- **PDF** vectorial.
- **Otros formatos:** JPEG, ICO (iconos de Windows con varios tamaños), SVG optimizado (minificado y limpio) y evaluación de EMF y AVIF.
- Exportación por lotes de varias mesas de trabajo o tamaños.

### MVP 4 · Texto vectorial, rellenos y bordes
- **Texto vectorial:** convertir texto a trazados, texto sobre un trazado, funciones OpenType (ligaduras, versalitas), espaciado entre letras y palabras, texto en área con ajuste de línea.
- **Rellenos:** patrones, rellenos con imagen, muestras de color y estilos guardados en el documento.
- **Bordes:** líneas discontinuas, extremos y uniones, alineación del trazo, marcadores (flechas), contorno de trazo a forma.

### MVP 5 · Efectos
- Sombras, desenfoque y resplandor mediante filtros SVG.
- Máscaras y trazados de recorte.
- Modos de fusión y opacidad por relleno y trazo.
- Editor de filtros SVG para usuarios avanzados.

### Otras ideas para más adelante
- Operaciones booleanas entre trazados (unir, restar, intersección, exclusión).
- Símbolos y componentes reutilizables (`symbol` y `use`).
- Importación de imágenes de mapa de bits incrustadas o enlazadas.
- Lápiz de mano alzada con presión (Windows Ink).
- Publicación en winget y Microsoft Store.
- Extensiones o complementos.

---

## 7. Calidad y pruebas

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Motor, unitarias | Vitest | Geometría, análisis de trazados, historial, serialización |
| Motor, integración | Playwright (Chromium) | Herramientas con eventos de puntero reales, capturas de referencia |
| Fidelidad | Corpus `tests/corpus` | Ida y vuelta y comparación visual con Edge |
| Shell | MSTest | Lógica de `WinVector.Core` y cliente del puente |
| Interfaz nativa | FlaUI (evaluar en Fase 0) | Flujos principales: abrir, editar, guardar |

- Toda pull request ejecuta CI completa; `main` siempre compila.
- Convenciones: [Conventional Commits](https://www.conventionalcommits.org/es/) y versionado semántico.

---

## 8. Distribución

- Paquete MSIX para Windows 11 (x64 y ARM64).
- MVP 1: GitHub Releases. Más adelante: winget y Microsoft Store.
- Firma de código: decidir el proveedor antes de la Fase 6 (por ejemplo, Azure Trusted Signing). Hasta entonces, compilaciones sin firmar para pruebas.
- WebView2: Windows 11 ya incluye el runtime Evergreen; el instalador comprobará su presencia.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Latencia del puente al arrastrar | Las interacciones de puntero se resuelven por completo en el motor; al shell solo llegan eventos resumidos y limitados en frecuencia |
| Documentos grandes lentos | Medición desde la Fase 1, superposición de edición separada del documento, actualización solo de los elementos afectados |
| Daño a SVG de terceros | Preservación de contenido desconocido y pruebas de ida y vuelta en CI desde la Fase 1 |
| Medición y edición de texto en el lienzo | Prototipo temprano en la Fase 1 para validar el enfoque antes de la Fase 4 |
| Dos lenguajes en el equipo | Contrato generado, límites claros y un ADR por decisión transversal |
| Coste y trámites de firma de código | Decisión anticipada antes de la Fase 6 |

---

## 10. Próximos pasos

1. Crear el repositorio público `WinVector` en GitHub y subir este plan.
2. Crear en GitHub los hitos (MVP 1 a MVP 5) y los issues de la Fase 0.
3. Iniciar la Fase 0.
