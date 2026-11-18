# Contrato del puente

Mensajes que intercambian la aplicación (C#) y el motor de edición (TypeScript) a través de WebView2. Se definen una sola vez aquí y los tipos de ambos lenguajes se generan a partir de estos archivos, de modo que si un lado cambia y el otro no, la compilación falla.

## Archivos

| Archivo | Contenido |
|---|---|
| `catalog.json` | Versión del protocolo y lista de mensajes: nombre, tipo (comando o evento), descripción y tipos de su payload y su respuesta |
| `envelope.schema.json` | Sobre común de todos los mensajes |
| `types/*.schema.json` | Un JSON Schema por cada tipo de datos |
| `tools/generate.mjs` | Generador de tipos |
| `tools/generate.test.mjs` | Pruebas del generador |

Archivos generados (no se editan a mano):

- `src/engine/src/bridge/generated/contracts.ts`
- `src/WinVector.Core/Bridge/Generated/Contracts.g.cs`

## Cómo funciona el puente

- **Comandos**: la aplicación los envía al motor. El motor contesta siempre con una **respuesta** que lleva el mismo `id`, con `ok: true` y el `payload` de la respuesta, o con `ok: false` y un `error`.
- **Eventos**: el motor los envía a la aplicación cuando algo cambia. No tienen respuesta.
- Todos los mensajes llevan `kind`, `id`, `name` y `protocolVersion`.

Ejemplo de comando y su respuesta:

```json
{ "kind": "command", "id": "c1", "name": "app.ping", "protocolVersion": 1, "payload": { "sentAt": 1234.5 } }
{ "kind": "response", "id": "c1", "name": "app.ping", "protocolVersion": 1, "ok": true, "payload": { "sentAt": 1234.5, "receivedAt": 1236 } }
```

Ejemplo de evento:

```json
{ "kind": "event", "id": "e7", "name": "selection.changed", "protocolVersion": 1, "payload": { "items": [{ "id": "sol", "tagName": "circle" }] } }
```

## Implementación

| Lado | Código | Qué hace |
|---|---|---|
| Motor | `src/engine/src/bridge/bridge.ts` | `EngineBridge`: valida el sobre de los comandos, responde con el mismo `id` y emite eventos. Ante un mensaje mal formado emite el evento `error` |
| Motor | `src/engine/src/bridge/transport.ts` | Transporte sobre `window.chrome.webview` y un sustituto que escribe en la consola en `npm run dev` |
| Aplicación | `src/WinVector.Core/Bridge/BridgeClient.cs` | `BridgeClient`: envía comandos y espera la respuesta (5 s como máximo), reparte los eventos y solo acepta mensajes de la página del motor |
| Aplicación | `src/WinVector.App/Controls/WebViewBridgeTransport.cs` | Transporte sobre `PostWebMessageAsJson` y `WebMessageReceived` |

Al cargar, el motor envía `engine.ready` y la aplicación comprueba que la versión del protocolo coincide; si no, lo indica en la barra de estado. Después mide la latencia del puente con `app.ping`.

## Añadir un mensaje

1. Si el mensaje necesita tipos nuevos, crea un archivo por tipo en `types/`. El nombre del archivo es el `title` en kebab-case: el tipo `SelectionChanged` va en `selection-changed.schema.json`.
2. Añade el mensaje a `catalog.json`. Los nombres siguen el formato `area.accion` (`document.load`, `selection.changed`).
3. Regenera los tipos desde `src/engine`:

   ```bash
   npm run contracts:generate
   ```

4. Implementa el mensaje en los dos lados. Hasta que lo hagas, la compilación de alguno de ellos fallará si el mensaje cambia tipos que ya se usan.
5. Incluye en el commit los esquemas y los archivos generados. La CI comprueba que están al día.

Un cambio que rompe la compatibilidad (quitar un mensaje o un campo, cambiar un tipo) incrementa `protocolVersion` en `catalog.json`.

## Subconjunto de JSON Schema admitido

El generador solo admite lo que sabe traducir a los dos lenguajes. Si un esquema usa cualquier otra palabra clave, la generación falla, para que nadie añada una restricción creyendo que se cumple cuando en realidad se ignora.

**Tipos**, uno por archivo:

- **Objeto**: `"type": "object"`, con `properties`, `required` y obligatoriamente `"additionalProperties": false`.
- **Enumeración de texto**: `"type": "string"` con `enum`. Los valores van en kebab-case (`invalid-message`).

**Propiedades** de un objeto:

| Esquema | TypeScript | C# |
|---|---|---|
| `"type": "string"` | `string` | `string` |
| `"type": "number"` | `number` | `double` |
| `"type": "integer"` | `number` | `int` |
| `"type": "boolean"` | `boolean` | `bool` |
| `"type": "array"`, `"items": …` | `readonly T[]` | `IReadOnlyList<T>` |
| `"$ref": "./otro.schema.json"` | `Otro` | `Otro` |
| `"type": ["string", "null"]` | `string \| null` | `string?` |
| `"anyOf": [{ "$ref": … }, { "type": "null" }]` | `Otro \| null` | `Otro?` |
| Propiedad fuera de `required` | `prop?: T` | `T? Prop = null`, se omite al escribir si es null |

Reglas adicionales:

- No hay objetos anidados: un objeto dentro de otro se define en su propio archivo y se referencia con `$ref`.
- Una propiedad no puede ser a la vez opcional y nullable. Elige una: opcional si puede faltar, nullable si siempre está pero puede no tener valor.
- Los nombres de propiedad van en camelCase y los de tipo en PascalCase.
- `description` se admite en tipos y propiedades y pasa a la documentación del código generado.

## Comportamiento en C#

`BridgeJsonContext` es un contexto de System.Text.Json generado en compilación que:

- Falla al deserializar si falta un campo obligatorio (`RespectRequiredConstructorParameters`).
- Falla si llega `null` en un campo que no lo admite (`RespectNullableAnnotations`).
- Escribe y lee los enum con los valores del esquema (`"invalid-message"`, no `InvalidMessage`).

Usa siempre este contexto para leer y escribir mensajes del puente.

## Comandos

Desde `src/engine`:

| Comando | Qué hace |
|---|---|
| `npm run contracts:generate` | Regenera los tipos de TypeScript y C# y les da formato |
| `npm run contracts:test` | Ejecuta las pruebas del generador |

Las pruebas del C# generado están en `tests/WinVector.Core.Tests/Bridge`. Desde la raíz del repositorio, con el SDK de .NET instalado:

```bash
dotnet test tests/WinVector.Core.Tests
```

La decisión de usar un generador propio está en [ADR 0002](../docs/adr/0002-generador-propio-del-contrato.md).
