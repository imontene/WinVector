// Pruebas del generador. Se ejecutan con `node --test` (sin dependencias):
//   npm run contracts:test   (desde src/engine)

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  CONTRACTS_DIR,
  ContractError,
  generateCSharp,
  generateTypeScript,
  loadContracts,
  toKebabCase,
  toPascalCase,
} from "./generate.mjs";

const temporaryDirs = [];
after(() => temporaryDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const BRIDGE_ERROR = {
  title: "BridgeError",
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: { message: { type: "string" } },
};

const PING = {
  title: "Ping",
  type: "object",
  additionalProperties: false,
  required: ["at"],
  properties: { at: { type: "number" } },
};

/** Crea un contrato mínimo válido en una carpeta temporal, con los cambios indicados. */
function contractsWith({ messages, types = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "winvector-contracts-"));
  temporaryDirs.push(dir);
  mkdirSync(join(dir, "types"));
  const allTypes = { "bridge-error": BRIDGE_ERROR, ping: PING, ...types };
  for (const [file, schema] of Object.entries(allTypes)) {
    if (schema !== null) writeFileSync(join(dir, "types", `${file}.schema.json`), JSON.stringify(schema));
  }
  const catalog = {
    protocolVersion: 1,
    messages: messages ?? [
      { name: "app.ping", kind: "command", description: "Ping.", payload: "Ping", response: "Ping" },
    ],
  };
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
  return dir;
}

function assertRejects(dir, pattern) {
  assert.throws(() => loadContracts(dir), (error) => error instanceof ContractError && pattern.test(error.message));
}

describe("contrato real", () => {
  const model = loadContracts();

  it("se carga sin errores", () => {
    assert.ok(model.messages.length > 0);
    assert.ok(model.types.has("BridgeError"));
  });

  it("genera siempre la misma salida", () => {
    assert.equal(generateTypeScript(loadContracts()), generateTypeScript(model));
    assert.equal(generateCSharp(loadContracts()), generateCSharp(model));
  });

  it("el sobre generado tiene los mismos campos que envelope.schema.json", () => {
    const envelope = JSON.parse(readFileSync(join(CONTRACTS_DIR, "envelope.schema.json"), "utf8"));
    const fields = Object.keys(envelope.properties);
    const ts = generateTypeScript(model);
    const cs = generateCSharp(model);
    for (const field of fields) {
      assert.match(ts, new RegExp(`readonly ${field}\\b`), `falta ${field} en TypeScript`);
    }
    const csEnvelope = cs.slice(cs.indexOf("public sealed record BridgeEnvelope("), cs.indexOf("public sealed class BridgeCommand<"));
    assert.deepEqual([...csEnvelope.matchAll(/JsonPropertyName\("(\w+)"\)/g)].map((m) => m[1]).sort(), [...fields].sort());
  });
});

describe("generación", () => {
  const optionalAndNullable = contractsWith({
    types: {
      shape: {
        title: "Shape",
        type: "object",
        additionalProperties: false,
        required: ["kind", "points", "label"],
        properties: {
          kind: { $ref: "./shape-kind.schema.json" },
          points: { type: "array", items: { type: "number" } },
          label: { type: ["string", "null"] },
          parent: { $ref: "./ping.schema.json" },
          owner: { anyOf: [{ $ref: "./ping.schema.json" }, { type: "null" }] },
        },
      },
      "shape-kind": { title: "ShapeKind", type: "string", enum: ["rect", "regular-polygon"] },
    },
  });
  // Igual que el anterior, pero con owner en required.
  const valid = contractsWith({
    types: {
      shape: {
        title: "Shape",
        type: "object",
        additionalProperties: false,
        required: ["kind", "points", "label", "owner"],
        properties: {
          kind: { $ref: "./shape-kind.schema.json" },
          points: { type: "array", items: { type: "number" } },
          label: { type: ["string", "null"] },
          parent: { $ref: "./ping.schema.json" },
          owner: { anyOf: [{ $ref: "./ping.schema.json" }, { type: "null" }] },
          count: { type: "integer" },
        },
      },
      "shape-kind": { title: "ShapeKind", type: "string", enum: ["rect", "regular-polygon"] },
    },
  });

  it("rechaza una propiedad opcional y nullable", () => assertRejects(optionalAndNullable, /opcional no puede ser además nullable/));

  it("traduce los tipos a TypeScript", () => {
    const ts = generateTypeScript(loadContracts(valid));
    assert.match(ts, /export type ShapeKind = "rect" \| "regular-polygon";/);
    assert.match(ts, /readonly kind: ShapeKind;/);
    assert.match(ts, /readonly points: readonly number\[\];/);
    assert.match(ts, /readonly label: string \| null;/);
    assert.match(ts, /readonly parent\?: Ping;/);
    assert.match(ts, /readonly owner: Ping \| null;/);
    assert.match(ts, /readonly count\?: number;/);
  });

  it("traduce los tipos a C#, con las propiedades opcionales al final", () => {
    const cs = generateCSharp(loadContracts(valid));
    assert.match(cs, /\[JsonStringEnumMemberName\("regular-polygon"\)\]\n {4}RegularPolygon,/);
    assert.match(cs, /IReadOnlyList<double> Points,/);
    assert.match(cs, /string\? Label,/);
    assert.match(cs, /Ping\? Owner,/);
    assert.match(cs, /JsonIgnore\(Condition = JsonIgnoreCondition.WhenWritingNull\)\] Ping\? Parent = null,/);
    assert.match(cs, /int\? Count = null\);/);
    assert.match(cs, /BridgeCommand<Ping, Ping> AppPing = new\("app.ping"\);/);
  });
});

describe("validación", () => {
  it("rechaza palabras clave que el generador no aplica", () => {
    const dir = contractsWith({
      types: { ping: { ...PING, properties: { at: { type: "number", minimum: 0 } } } },
    });
    assertRejects(dir, /palabra clave no admitida: minimum/);
  });

  it("exige additionalProperties: false", () => {
    const { additionalProperties: _, ...open } = PING;
    assertRejects(contractsWith({ types: { ping: open } }), /additionalProperties: false/);
  });

  it("exige que el archivo se llame como el tipo", () => {
    assertRejects(contractsWith({ types: { ping: null, otro: PING } }), /debe llamarse ping\.schema\.json/);
  });

  it("rechaza objetos anidados", () => {
    const nested = { ...PING, properties: { at: { type: "object" } } };
    assertRejects(contractsWith({ types: { ping: nested } }), /objetos anidados/);
  });

  it("rechaza referencias a archivos que no existen", () => {
    const ref = { ...PING, properties: { at: { $ref: "./nada.schema.json" } } };
    assertRejects(contractsWith({ types: { ping: ref } }), /archivo desconocido/);
  });

  it("rechaza mensajes con tipos desconocidos", () => {
    const messages = [{ name: "app.ping", kind: "command", description: "x", payload: "Nada", response: "Ping" }];
    assertRejects(contractsWith({ messages }), /tipo desconocido Nada/);
  });

  it("rechaza eventos con respuesta", () => {
    const messages = [{ name: "app.ping", kind: "event", description: "x", payload: "Ping", response: "Ping" }];
    assertRejects(contractsWith({ messages }), /solo los comandos tienen response/);
  });

  it("rechaza nombres de mensaje repetidos", () => {
    const message = { name: "app.ping", kind: "event", description: "x", payload: "Ping" };
    assertRejects(contractsWith({ messages: [message, message] }), /está repetido/);
  });

  it("exige el tipo BridgeError", () => {
    assertRejects(contractsWith({ types: { "bridge-error": null } }), /falta el tipo BridgeError/);
  });
});

describe("nombres", () => {
  it("convierte entre formatos", () => {
    assert.equal(toKebabCase("SelectionChanged"), "selection-changed");
    assert.equal(toPascalCase("selection.changed"), "SelectionChanged");
    assert.equal(toPascalCase("invalid-message"), "InvalidMessage");
  });
});
