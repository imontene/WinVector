// Generador de tipos del contrato del puente.
//
// Lee contracts/catalog.json y contracts/types/*.schema.json y escribe:
//   - src/engine/src/bridge/generated/contracts.ts
//   - src/WinVector.Core/Bridge/Generated/Contracts.g.cs
//
// Solo admite un subconjunto de JSON Schema (ver contracts/README.md). Cualquier palabra clave
// fuera de ese subconjunto es un error: así nadie añade una restricción creyendo que se cumple
// en el código generado cuando en realidad se ignora.
//
// Sin dependencias: se ejecuta con Node.js directamente.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(CONTRACTS_DIR, "..");
export const TS_OUTPUT = join(REPO_ROOT, "src/engine/src/bridge/generated/contracts.ts");
export const CS_OUTPUT = join(REPO_ROOT, "src/WinVector.Core/Bridge/Generated/Contracts.g.cs");

const SCHEMA_SUFFIX = ".schema.json";
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
const MESSAGE_NAME = /^[a-z][a-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
const ENUM_VALUE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KINDS = new Set(["command", "event"]);
const PRIMITIVES = new Set(["string", "number", "integer", "boolean"]);

const TOP_LEVEL_KEYS = new Set(["$schema", "title", "description", "type", "enum", "properties", "required", "additionalProperties"]);
const PROPERTY_KEYS = new Set(["description", "type", "items", "$ref", "anyOf"]);
const ITEMS_KEYS = new Set(["type", "$ref"]);

/** Error de validación del contrato, con la ruta del elemento que lo provoca. */
export class ContractError extends Error {
  constructor(where, message) {
    super(`${where}: ${message}`);
    this.name = "ContractError";
  }
}

// ---------------------------------------------------------------------------------------------
// Carga y validación
// ---------------------------------------------------------------------------------------------

/**
 * Carga el contrato desde una carpeta con catalog.json y types/.
 * Devuelve un modelo independiente del lenguaje de salida.
 */
export function loadContracts(dir = CONTRACTS_DIR) {
  const catalog = readJson(join(dir, "catalog.json"));
  const typesDir = join(dir, "types");
  const files = readdirSync(typesDir)
    .filter((f) => f.endsWith(SCHEMA_SUFFIX))
    .sort();

  const fileToName = new Map();
  const rawTypes = new Map();
  for (const file of files) {
    const schema = readJson(join(typesDir, file));
    const where = `types/${file}`;
    const name = schema.title;
    if (typeof name !== "string" || !PASCAL_CASE.test(name)) {
      throw new ContractError(where, "title debe ser un nombre de tipo en PascalCase");
    }
    const expectedFile = `${toKebabCase(name)}${SCHEMA_SUFFIX}`;
    if (file !== expectedFile) {
      throw new ContractError(where, `el archivo de ${name} debe llamarse ${expectedFile}`);
    }
    fileToName.set(file, name);
    rawTypes.set(name, { schema, where });
  }

  const types = new Map();
  for (const [name, { schema, where }] of rawTypes) {
    types.set(name, parseType(name, schema, where, fileToName));
  }

  return { ...parseCatalog(catalog, types), types };
}

function parseCatalog(catalog, types) {
  const where = "catalog.json";
  assertKeys(catalog, new Set(["protocolVersion", "messages"]), where);
  const { protocolVersion, messages } = catalog;
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
    throw new ContractError(where, "protocolVersion debe ser un entero mayor o igual que 1");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ContractError(where, "messages debe ser una lista no vacía");
  }

  const seen = new Set();
  const parsed = messages.map((message, index) => {
    const at = `${where} messages[${index}]`;
    assertKeys(message, new Set(["name", "kind", "description", "payload", "response"]), at);
    const { name, kind, description, payload, response } = message;
    if (typeof name !== "string" || !MESSAGE_NAME.test(name)) {
      throw new ContractError(at, "name debe tener el formato area.accion, por ejemplo selection.changed");
    }
    if (seen.has(name)) throw new ContractError(at, `el mensaje ${name} está repetido`);
    seen.add(name);
    if (!KINDS.has(kind)) throw new ContractError(at, "kind debe ser command o event");
    if (typeof description !== "string" || description.length === 0) {
      throw new ContractError(at, "falta description");
    }
    assertObjectType(payload, "payload", at, types);
    if (kind === "command") {
      assertObjectType(response, "response", at, types);
    } else if (response !== undefined) {
      throw new ContractError(at, "solo los comandos tienen response");
    }
    return { name, kind, description, payload, response, member: toPascalCase(name) };
  });

  const members = new Set();
  for (const message of parsed) {
    if (members.has(message.member)) {
      throw new ContractError(where, `dos mensajes producen el mismo identificador ${message.member}`);
    }
    members.add(message.member);
  }

  if (!types.has("BridgeError") || types.get("BridgeError").kind !== "object") {
    throw new ContractError("types", "falta el tipo BridgeError, que usa el sobre de las respuestas fallidas");
  }

  return { protocolVersion, messages: parsed };
}

function assertObjectType(name, field, where, types) {
  if (typeof name !== "string") throw new ContractError(where, `falta ${field}`);
  const type = types.get(name);
  if (!type) throw new ContractError(where, `${field} hace referencia al tipo desconocido ${name}`);
  if (type.kind !== "object") throw new ContractError(where, `${field} debe ser un tipo objeto`);
}

function parseType(name, schema, where, fileToName) {
  assertKeys(schema, TOP_LEVEL_KEYS, where);
  const description = optionalDescription(schema, where);

  if (schema.type === "string" && schema.enum !== undefined) {
    const values = schema.enum;
    if (!Array.isArray(values) || values.length === 0) {
      throw new ContractError(where, "enum debe ser una lista no vacía");
    }
    const unique = new Set(values);
    if (unique.size !== values.length) throw new ContractError(where, "enum tiene valores repetidos");
    for (const value of values) {
      if (typeof value !== "string" || !ENUM_VALUE.test(value)) {
        throw new ContractError(where, `el valor de enum ${JSON.stringify(value)} debe estar en kebab-case`);
      }
    }
    if (schema.properties !== undefined || schema.required !== undefined) {
      throw new ContractError(where, "un enum no puede tener properties ni required");
    }
    return { kind: "enum", name, description, values };
  }

  if (schema.type !== "object") {
    throw new ContractError(where, 'el tipo debe ser "object" o un "string" con enum');
  }
  if (schema.enum !== undefined) throw new ContractError(where, "un objeto no puede tener enum");
  if (schema.additionalProperties !== false) {
    throw new ContractError(where, "los objetos deben declarar additionalProperties: false");
  }
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  if (!Array.isArray(required)) throw new ContractError(where, "required debe ser una lista");
  for (const key of required) {
    if (!(key in properties)) throw new ContractError(where, `required incluye ${key}, que no está en properties`);
  }

  const props = Object.entries(properties).map(([propName, prop]) => {
    const at = `${where} properties.${propName}`;
    if (!CAMEL_CASE.test(propName)) throw new ContractError(at, "el nombre debe estar en camelCase");
    assertKeys(prop, PROPERTY_KEYS, at);
    const type = parseTypeRef(prop, at, fileToName, true);
    const isRequired = required.includes(propName);
    if (!isRequired && type.nullable) {
      throw new ContractError(at, "una propiedad opcional no puede ser además nullable: elige una de las dos");
    }
    return { name: propName, description: optionalDescription(prop, at), type, required: isRequired };
  });

  return { kind: "object", name, description, properties: props };
}

/** Convierte un nodo de propiedad (o de items) en una referencia de tipo del modelo. */
function parseTypeRef(node, where, fileToName, allowArray) {
  if (node.anyOf !== undefined) {
    // Único uso admitido: { "anyOf": [ { "$ref": ... }, { "type": "null" } ] }
    const options = node.anyOf;
    const nullIndex = Array.isArray(options) ? options.findIndex((o) => o?.type === "null" && Object.keys(o).length === 1) : -1;
    if (!Array.isArray(options) || options.length !== 2 || nullIndex === -1 || node.type !== undefined || node.$ref !== undefined) {
      throw new ContractError(where, 'anyOf solo se admite como [{ "$ref": ... }, { "type": "null" }]');
    }
    const target = options[1 - nullIndex];
    assertKeys(target, new Set(["$ref"]), where);
    return { ...resolveRef(target.$ref, where, fileToName), nullable: true };
  }

  if (node.$ref !== undefined) {
    if (node.type !== undefined) throw new ContractError(where, "$ref no puede ir junto a type");
    return { ...resolveRef(node.$ref, where, fileToName), nullable: false };
  }

  let types = node.type;
  let nullable = false;
  if (Array.isArray(types)) {
    if (types.length !== 2 || !types.includes("null")) {
      throw new ContractError(where, 'type como lista solo se admite como ["<tipo>", "null"]');
    }
    nullable = true;
    types = types.find((t) => t !== "null");
  }

  if (PRIMITIVES.has(types)) {
    if (node.items !== undefined) throw new ContractError(where, "items solo se admite en arrays");
    return { kind: "primitive", primitive: types, nullable };
  }
  if (types === "array") {
    if (!allowArray) throw new ContractError(where, "no se admiten arrays de arrays");
    if (typeof node.items !== "object" || node.items === null) throw new ContractError(where, "un array necesita items");
    assertKeys(node.items, ITEMS_KEYS, `${where}.items`);
    const items = parseTypeRef(node.items, `${where}.items`, fileToName, false);
    if (items.nullable) throw new ContractError(where, "los elementos de un array no pueden ser null");
    return { kind: "array", items, nullable };
  }
  if (types === "object") {
    throw new ContractError(where, "no se admiten objetos anidados: define el objeto en su propio archivo y usa $ref");
  }
  throw new ContractError(where, `tipo no admitido: ${JSON.stringify(node.type)}`);
}

function resolveRef(ref, where, fileToName) {
  if (typeof ref !== "string" || !ref.startsWith("./") || ref.includes("#")) {
    throw new ContractError(where, '$ref debe apuntar a otro archivo de types/, por ejemplo "./bridge-error.schema.json"');
  }
  const name = fileToName.get(basename(ref));
  if (!name || ref !== `./${basename(ref)}`) throw new ContractError(where, `$ref apunta a un archivo desconocido: ${ref}`);
  return { kind: "named", name };
}

function optionalDescription(node, where) {
  if (node.description === undefined) return undefined;
  if (typeof node.description !== "string") throw new ContractError(where, "description debe ser texto");
  return node.description;
}

function assertKeys(node, allowed, where) {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw new ContractError(where, "se esperaba un objeto");
  }
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) throw new ContractError(where, `palabra clave no admitida: ${key}`);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ContractError(path, `no se pudo leer el JSON (${error.message})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Utilidades de nombres
// ---------------------------------------------------------------------------------------------

export function toKebabCase(pascal) {
  return pascal.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** "selection.changed" → "SelectionChanged", "invalid-message" → "InvalidMessage". */
export function toPascalCase(value) {
  return value
    .split(/[.\-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/** Orden estable de tipos para que la salida no dependa del sistema de archivos. */
function sortedTypes(model) {
  return [...model.types.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

const HEADER_LINES = [
  "Generado por contracts/tools/generate.mjs a partir de contracts/. No editar a mano:",
  "modifica los esquemas y ejecuta `npm run contracts:generate` en src/engine.",
];

// ---------------------------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------------------------

export function generateTypeScript(model) {
  const out = [];
  out.push(...HEADER_LINES.map((l) => `// ${l}`), "");
  out.push("/** Versión del protocolo del puente. Debe coincidir en la aplicación y en el motor. */");
  out.push(`export const PROTOCOL_VERSION = ${model.protocolVersion};`, "");

  for (const type of sortedTypes(model)) {
    out.push(...tsDoc(type.description, ""));
    if (type.kind === "enum") {
      out.push(`export type ${type.name} = ${type.values.map((v) => JSON.stringify(v)).join(" | ")};`, "");
      continue;
    }
    out.push(`export interface ${type.name} {`);
    for (const prop of type.properties) {
      out.push(...tsDoc(prop.description, "  "));
      out.push(`  readonly ${prop.name}${prop.required ? "" : "?"}: ${tsType(prop.type)};`);
    }
    out.push("}", "");
  }

  const commands = model.messages.filter((m) => m.kind === "command");
  const events = model.messages.filter((m) => m.kind === "event");

  out.push("/** Comandos que la aplicación envía al motor, con el tipo de su payload y de su respuesta. */");
  out.push("export interface BridgeCommands {");
  for (const m of commands) {
    out.push(...tsDoc(m.description, "  "));
    out.push(`  readonly ${JSON.stringify(m.name)}: { readonly payload: ${m.payload}; readonly response: ${m.response} };`);
  }
  out.push("}", "");

  out.push("/** Eventos que el motor envía a la aplicación, con el tipo de su payload. */");
  out.push("export interface BridgeEvents {");
  for (const m of events) {
    out.push(...tsDoc(m.description, "  "));
    out.push(`  readonly ${JSON.stringify(m.name)}: ${m.payload};`);
  }
  out.push("}", "");

  out.push("export type BridgeCommandName = keyof BridgeCommands;");
  out.push("export type BridgeEventName = keyof BridgeEvents;", "");
  out.push(`export const BRIDGE_COMMAND_NAMES: readonly BridgeCommandName[] = [${commands.map((m) => JSON.stringify(m.name)).join(", ")}];`);
  out.push(`export const BRIDGE_EVENT_NAMES: readonly BridgeEventName[] = [${events.map((m) => JSON.stringify(m.name)).join(", ")}];`, "");

  out.push(
    "/** Campos comunes a todos los mensajes. */",
    "export interface BridgeEnvelopeBase {",
    "  /** Identificador único del mensaje. En una respuesta, el del comando al que responde. */",
    "  readonly id: string;",
    "  readonly protocolVersion: number;",
    "}",
    "",
    "export type BridgeCommandMessage<N extends BridgeCommandName = BridgeCommandName> = {",
    "  [K in N]: BridgeEnvelopeBase & {",
    '    readonly kind: "command";',
    "    readonly name: K;",
    '    readonly payload: BridgeCommands[K]["payload"];',
    "  };",
    "}[N];",
    "",
    "export type BridgeEventMessage<N extends BridgeEventName = BridgeEventName> = {",
    "  [K in N]: BridgeEnvelopeBase & {",
    '    readonly kind: "event";',
    "    readonly name: K;",
    "    readonly payload: BridgeEvents[K];",
    "  };",
    "}[N];",
    "",
    "export type BridgeResponseMessage<N extends BridgeCommandName = BridgeCommandName> = {",
    "  [K in N]: BridgeEnvelopeBase & {",
    '    readonly kind: "response";',
    "    readonly name: K;",
    "  } & (",
    '    | { readonly ok: true; readonly payload: BridgeCommands[K]["response"] }',
    "    | { readonly ok: false; readonly error: BridgeError }",
    "  );",
    "}[N];",
    "",
    "export type BridgeMessage = BridgeCommandMessage | BridgeEventMessage | BridgeResponseMessage;",
  );

  return out.join("\n") + "\n";
}

function tsType(ref) {
  let base;
  if (ref.kind === "primitive") base = ref.primitive === "integer" ? "number" : ref.primitive;
  else if (ref.kind === "named") base = ref.name;
  else base = `readonly ${tsType(ref.items)}[]`;
  return ref.nullable ? `${base} | null` : base;
}

function tsDoc(text, indent) {
  return text ? [`${indent}/** ${text} */`] : [];
}

// ---------------------------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------------------------

export function generateCSharp(model) {
  const out = [];
  out.push("// <auto-generated>", ...HEADER_LINES.map((l) => `// ${l}`), "// </auto-generated>", "");
  out.push("#nullable enable", "");
  out.push("using System.Collections.Generic;", "using System.Text.Json;", "using System.Text.Json.Serialization;", "");
  out.push("namespace WinVector.Core.Bridge;", "");

  out.push(
    "/// <summary>Versión del protocolo del puente. Debe coincidir en la aplicación y en el motor.</summary>",
    "public static class BridgeProtocol",
    "{",
    `    public const int Version = ${model.protocolVersion};`,
    "}",
    "",
  );

  for (const type of sortedTypes(model)) {
    out.push(...csDoc(type.description, ""));
    if (type.kind === "enum") {
      out.push(`[JsonConverter(typeof(JsonStringEnumConverter<${type.name}>))]`);
      out.push(`public enum ${type.name}`, "{");
      for (const value of type.values) {
        out.push(`    [JsonStringEnumMemberName(${JSON.stringify(value)})]`);
        out.push(`    ${toPascalCase(value)},`);
      }
      out.push("}", "");
      continue;
    }
    // Las propiedades opcionales van al final porque en C# los parámetros opcionales deben ir detrás.
    const ordered = [...type.properties.filter((p) => p.required), ...type.properties.filter((p) => !p.required)];
    const docs = ordered.filter((p) => p.description).map((p) => `/// <param name="${toPascalCase(p.name)}">${escapeXml(p.description)}</param>`);
    out.push(...docs);
    if (ordered.length === 0) {
      out.push(`public sealed record ${type.name}();`, "");
      continue;
    }
    out.push(`public sealed record ${type.name}(`);
    ordered.forEach((prop, index) => {
      const attributes = [`JsonPropertyName(${JSON.stringify(prop.name)})`];
      if (!prop.required) attributes.push("JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)");
      const type = csType(prop.type, !prop.required);
      const optional = prop.required ? "" : " = null";
      const separator = index === ordered.length - 1 ? ");" : ",";
      out.push(`    [property: ${attributes.join(", ")}] ${type} ${toPascalCase(prop.name)}${optional}${separator}`);
    });
    out.push("");
  }

  out.push(
    "/// <summary>Tipo de mensaje del puente.</summary>",
    "[JsonConverter(typeof(JsonStringEnumConverter<BridgeMessageKind>))]",
    "public enum BridgeMessageKind",
    "{",
    '    [JsonStringEnumMemberName("command")]',
    "    Command,",
    '    [JsonStringEnumMemberName("event")]',
    "    Event,",
    '    [JsonStringEnumMemberName("response")]',
    "    Response,",
    "}",
    "",
    "/// <summary>Sobre común de todos los mensajes. <c>Payload</c> se deserializa según <c>Name</c>.</summary>",
    "public sealed record BridgeEnvelope(",
    '    [property: JsonPropertyName("kind")] BridgeMessageKind Kind,',
    '    [property: JsonPropertyName("id")] string Id,',
    '    [property: JsonPropertyName("name")] string Name,',
    '    [property: JsonPropertyName("protocolVersion")] int ProtocolVersion,',
    '    [property: JsonPropertyName("payload"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? Payload = null,',
    '    [property: JsonPropertyName("ok"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Ok = null,',
    '    [property: JsonPropertyName("error"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BridgeError? Error = null);',
    "",
    "/// <summary>Comando del puente con el tipo de su payload y de su respuesta.</summary>",
    "public sealed class BridgeCommand<TPayload, TResponse>(string name)",
    "{",
    "    public string Name { get; } = name;",
    "}",
    "",
    "/// <summary>Evento del puente con el tipo de su payload.</summary>",
    "public sealed class BridgeEvent<TPayload>(string name)",
    "{",
    "    public string Name { get; } = name;",
    "}",
    "",
  );

  const commands = model.messages.filter((m) => m.kind === "command");
  const events = model.messages.filter((m) => m.kind === "event");

  out.push("/// <summary>Comandos que la aplicación envía al motor.</summary>", "public static class BridgeCommands", "{");
  commands.forEach((m, i) => {
    out.push(...csDoc(m.description, "    "));
    out.push(`    public static readonly BridgeCommand<${m.payload}, ${m.response}> ${m.member} = new(${JSON.stringify(m.name)});`);
    if (i < commands.length - 1) out.push("");
  });
  out.push("}", "");

  out.push("/// <summary>Eventos que el motor envía a la aplicación.</summary>", "public static class BridgeEvents", "{");
  events.forEach((m, i) => {
    out.push(...csDoc(m.description, "    "));
    out.push(`    public static readonly BridgeEvent<${m.payload}> ${m.member} = new(${JSON.stringify(m.name)});`);
    if (i < events.length - 1) out.push("");
  });
  out.push("}", "");

  out.push(
    "/// <summary>",
    "/// Contexto de serialización generado en compilación. Exige los parámetros obligatorios y respeta",
    "/// las anotaciones de nulabilidad, para que un mensaje incompleto falle al deserializarse.",
    "/// </summary>",
    "[JsonSourceGenerationOptions(",
    "    RespectNullableAnnotations = true,",
    "    RespectRequiredConstructorParameters = true)]",
    "[JsonSerializable(typeof(BridgeEnvelope))]",
  );
  for (const type of sortedTypes(model)) {
    if (type.kind === "object") out.push(`[JsonSerializable(typeof(${type.name}))]`);
  }
  out.push("public sealed partial class BridgeJsonContext : JsonSerializerContext", "{", "}");

  return out.join("\n") + "\n";
}

function csType(ref, forceNullable) {
  let base;
  if (ref.kind === "primitive") {
    base = { string: "string", number: "double", integer: "int", boolean: "bool" }[ref.primitive];
  } else if (ref.kind === "named") {
    base = ref.name;
  } else {
    base = `IReadOnlyList<${csType(ref.items, false)}>`;
  }
  return ref.nullable || forceNullable ? `${base}?` : base;
}

function csDoc(text, indent) {
  return text ? [`${indent}/// <summary>${escapeXml(text)}</summary>`] : [];
}

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------------------------

export function writeOutputs(model, { tsPath = TS_OUTPUT, csPath = CS_OUTPUT } = {}) {
  for (const [path, content] of [
    [tsPath, generateTypeScript(model)],
    [csPath, generateCSharp(model)],
  ]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const model = loadContracts();
    writeOutputs(model);
    console.log(`Contrato v${model.protocolVersion}: ${model.messages.length} mensajes y ${model.types.size} tipos generados.`);
  } catch (error) {
    if (error instanceof ContractError) {
      console.error(`Error en el contrato: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
