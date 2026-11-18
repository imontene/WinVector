# ADR 0002 · Generador propio para el contrato del puente

- **Estado:** Aceptada
- **Fecha:** 2026-11-18

## Contexto

El puente entre la aplicación (C#) y el motor (TypeScript) se define una sola vez en `contracts/` y los tipos de ambos lenguajes se generan a partir de ahí ([ADR 0001](0001-arquitectura-winui3-webview2.md)). Hay que elegir con qué se generan.

Además de los tipos de datos, el código generado debe incluir el catálogo de mensajes (qué comando lleva qué payload y qué respuesta), que es lo que permite que el cliente del puente esté tipado en los dos lados.

## Opciones evaluadas

1. **quicktype.** Se probó la versión 26 con un esquema de ejemplo:
   - Ignora `title` y los nombres de `$defs`: el tipo `SelectionChanged` salió como `Out` y `SelectedElement` como `SelSchema`.
   - El C# generado desactiva las advertencias de nulabilidad (`#pragma warning disable CS8618`, `CS8601`…), que el proyecto trata como errores.
   - No genera el catálogo de mensajes ni los tipos del sobre; habría que escribir un segundo generador para eso.
2. **json-schema-to-typescript (TypeScript) + NJsonSchema (C#).** Dos herramientas distintas que interpretan JSON Schema de forma distinta, una en cada ecosistema, y tampoco generan el catálogo.
3. **Generador propio** para un subconjunto acotado de JSON Schema.

## Decisión

Se adopta la **opción 3**: `contracts/tools/generate.mjs`, un script de Node.js sin dependencias.

- Admite solo objetos con `additionalProperties: false`, enumeraciones de texto, primitivos, arrays, referencias entre archivos y valores nullable.
- Cualquier palabra clave fuera de ese subconjunto es un error de generación, para que no haya restricciones que parezcan aplicarse y se ignoren.
- Genera interfaces de solo lectura y tipos discriminados del sobre en TypeScript, y records con un contexto de System.Text.Json generado en compilación en C#, que exige campos obligatorios y respeta la nulabilidad.

## Consecuencias

- La salida es exactamente la que necesita el proyecto, con nombres legibles y documentación en los dos lenguajes.
- Mantener el generador es trabajo del proyecto. Está cubierto por pruebas (`generate.test.mjs`) y es pequeño porque el subconjunto es pequeño.
- Ampliar el subconjunto (por ejemplo, uniones de objetos) requiere cambiar el generador y sus pruebas.
- Requiere .NET 9 o posterior por `RespectRequiredConstructorParameters`, `RespectNullableAnnotations` y `JsonStringEnumMemberName`. El plan usa la LTS vigente (.NET 10).
