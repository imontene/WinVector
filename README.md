# WinVector

Editor gráfico de SVG para Windows 11, nativo y moderno.

> **Estado:** en planificación. Todavía no hay versión descargable.

## Qué es

WinVector es un editor vectorial que trabaja directamente sobre archivos SVG y se integra con Windows 11: Mica, pestañas en la barra de título, controles Fluent y tema claro/oscuro del sistema. El archivo que abres es el archivo que guardas, sin formatos propios y sin perder el contenido que el editor no entiende.

## Primera versión (MVP 1)

- Formas: rectángulos, elipses, líneas, polígonos y estrellas.
- Trazados: pluma Bézier y edición de nodos.
- Texto: edición directa en el lienzo con fuentes del sistema.
- Degradados: lineales y radiales, con edición en el lienzo.

Después llegarán capas, vista de código, exportación (PNG, WebP, PDF y otros), texto vectorial, rellenos y bordes avanzados y efectos. El detalle está en el [plan del proyecto](docs/PLAN.md).

## Arquitectura

- **Interfaz:** WinUI 3 (Windows App SDK) en C#.
- **Lienzo:** WebView2 con un motor de edición en TypeScript.
- Comunicación entre ambos mediante un contrato de mensajes tipado.

Motivos de la decisión: [ADR 0001](docs/adr/0001-arquitectura-winui3-webview2.md).

## Requisitos

- Windows 11 (x64 o ARM64).

## Desarrollo

El proyecto tiene dos partes que se compilan por separado:

- **Motor de edición** (`src/engine`): TypeScript. Se desarrolla y prueba en cualquier sistema operativo con [Node.js](https://nodejs.org/).
- **Aplicación** (`src/WinVector.App`): C# y WinUI 3. Necesita Windows 11, Visual Studio 2022 o posterior con las cargas de trabajo de escritorio de .NET y de aplicaciones de Windows, y el SDK de .NET.

Las instrucciones paso a paso, las convenciones de commits y el flujo de pull requests están en la [guía de contribución](CONTRIBUTING.md).

## Comunidad

- [Guía de contribución](CONTRIBUTING.md)
- [Código de conducta](CODE_OF_CONDUCT.md)
- [Política de seguridad](SECURITY.md)

## Licencia

Distribuido bajo la [licencia Apache 2.0](LICENSE).
