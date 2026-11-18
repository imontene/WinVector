# ADR 0001 · Arquitectura híbrida WinUI 3 + WebView2

- **Estado:** Aceptada
- **Fecha:** 2026-11-18

## Contexto

WinVector debe verse y comportarse como una aplicación nativa de Windows 11 y, a la vez, mostrar con fidelidad cualquier archivo SVG. El estándar SVG es muy amplio (texto, filtros, máscaras, degradados, `use`, CSS) y reimplementar su renderizado es un proyecto en sí mismo. El soporte SVG integrado en Direct2D no cubre texto ni filtros.

## Opciones evaluadas

1. **WinUI 3 + Win2D (C#):** todo nativo y máximo rendimiento, pero obliga a escribir casi todo el renderizado SVG a mano y los archivos externos se verían distintos que en un navegador.
2. **WinUI 3 + WebView2 (C# + TypeScript):** interfaz nativa y lienzo con el motor de Edge.
3. **Tauri 2 + React (Rust + TypeScript):** multiplataforma, pero la interfaz no es nativa de Windows.
4. **Avalonia + Skia (C#):** multiplataforma con un lenguaje, aspecto similar pero no idéntico a Windows 11 y huecos de fidelidad SVG.

Descartadas sin evaluación detallada: Electron (tamaño y consumo de memoria) y C++ con Direct2D (mismo problema de fidelidad que la opción 1 con mayor coste).

## Decisión

Se adopta la **opción 2**. El shell (ventana, menús, paneles, archivos, ajustes) es WinUI 3 en C#. El lienzo es un WebView2 que ejecuta un motor de edición en TypeScript. Ambos se comunican mediante un contrato de mensajes JSON definido una sola vez y con tipos generados para los dos lenguajes.

## Consecuencias

- Fidelidad de navegador desde el primer día y aspecto 100 % Windows 11.
- El motor se puede desarrollar y probar en un navegador, sin Windows, y reutilizar si en el futuro se quiere otra plataforma.
- El equipo trabaja con dos lenguajes y debe cuidar el diseño del puente.
- El rendimiento con documentos muy grandes debe medirse desde las primeras fases.
- La aplicación depende del runtime de WebView2, incluido de serie en Windows 11.
