#!/usr/bin/env node
// Compara mediciones de rendimiento con la referencia (referencia.json) y con los objetivos del
// MVP 1 (docs/rendimiento.md). Escribe una tabla en el resumen de la ejecución de GitHub Actions
// (o en la consola), avisa si una medida empeora más del umbral de aviso y termina con error si
// empeora más del umbral de fallo.
//
// Uso: node tools/perf/compare.mjs <resultados.json>...
// Acepta los resultados del motor (src/engine/perf) y los del arranque de la aplicación
// (StartupTests); los distingue por su contenido.

import { appendFileSync, readFileSync } from "node:fs";

const reference = JSON.parse(
  readFileSync(new URL("./referencia.json", import.meta.url), "utf8"),
);
const { warn, fail } = reference.thresholds;

/**
 * Una medida comparable.
 * @typedef {{ group: string, name: string, value: number, base: number | undefined,
 *   unit: string, higherIsBetter: boolean, floor: number, target?: { limit: number, text: string } }} Metric
 */

/** @type {Metric[]} */
const metrics = [];

function engineMetrics(results) {
  for (const result of results.results) {
    const base = reference.engine[String(result.objects)] ?? {};
    const group = `Motor, ${result.objects.toLocaleString("es-ES")} objetos`;
    const target = result.objects === reference.targets.fpsObjects;
    metrics.push({
      group,
      name: "Carga",
      value: result.loadMs,
      base: base.loadMs,
      unit: "ms",
      higherIsBetter: false,
      floor: 50,
    });
    for (const [key, name] of [
      ["drag", "Arrastrar"],
      ["zoom", "Zoom"],
      ["pan", "Desplazar"],
    ]) {
      metrics.push({
        group,
        name: `${name} (fps)`,
        value: result[key].fps,
        base: base[key]?.fps,
        unit: "fps",
        higherIsBetter: true,
        floor: 3,
        ...(target
          ? {
              target: {
                limit: reference.targets.fps,
                text: `≥ ${reference.targets.fps} fps`,
              },
            }
          : {}),
      });
      metrics.push({
        group,
        name: `${name} (p95 entre fotogramas)`,
        value: result[key].p95,
        base: base[key]?.p95,
        unit: "ms",
        higherIsBetter: false,
        floor: 10,
      });
    }
  }
}

function appMetrics(results) {
  for (const [key, group] of [
    ["cold", "Aplicación, en frío"],
    ["warm", "Aplicación, en caliente"],
  ]) {
    const base = reference.app[key] ?? {};
    const startup = results[key];
    metrics.push({
      group,
      name: "Ventana visible",
      value: startup.windowMs,
      base: base.windowMs,
      unit: "ms",
      higherIsBetter: false,
      floor: 250,
      ...(key === "cold"
        ? {
            target: {
              limit: reference.targets.coldStartMs,
              text: `< ${reference.targets.coldStartMs} ms`,
            },
          }
        : {}),
    });
    metrics.push({
      group,
      name: "Interfaz accesible",
      value: startup.uiMs,
      base: base.uiMs,
      unit: "ms",
      higherIsBetter: false,
      floor: 250,
    });
    metrics.push({
      group,
      name: "Motor listo",
      value: startup.engineMs,
      base: base.engineMs,
      unit: "ms",
      higherIsBetter: false,
      floor: 250,
    });
  }
}

for (const file of process.argv.slice(2)) {
  const results = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(results.results)) engineMetrics(results);
  else if (results.cold) appMetrics(results);
  else
    throw new Error(
      `${file} no contiene resultados de rendimiento reconocibles.`,
    );
}
if (metrics.length === 0) {
  console.error("Uso: node tools/perf/compare.mjs <resultados.json>...");
  process.exit(2);
}

/** Cuánto ha empeorado respecto a la referencia (0,25 = un 25 % peor); negativo si mejora. */
function worsening(metric) {
  if (metric.base === undefined || metric.base === 0) return undefined;
  const difference = metric.higherIsBetter
    ? metric.base - metric.value
    : metric.value - metric.base;
  // Diferencias por debajo del mínimo son ruido de la medición.
  if (difference > 0 && difference < metric.floor) return 0;
  return difference / metric.base;
}

const format = (value, unit) =>
  value === undefined ? "—" : `${value.toLocaleString("es-ES")} ${unit}`;
const percent = (value) =>
  `${value > 0 ? "+" : ""}${Math.round(value * 100)} %`;

const rows = [];
const warnings = [];
const failures = [];
for (const metric of metrics) {
  const change = worsening(metric);
  let status = "✅";
  if (change !== undefined && change > fail) {
    status = "❌";
    failures.push(metric);
  } else if (change !== undefined && change > warn) {
    status = "⚠️";
    warnings.push(metric);
  }
  let target = "";
  if (metric.target) {
    const met = metric.higherIsBetter
      ? metric.value >= metric.target.limit
      : metric.value < metric.target.limit;
    target = `${met ? "✅" : "⚠️"} ${metric.target.text}`;
    if (!met) warnings.push({ ...metric, missedTarget: true });
  }
  rows.push(
    `| ${metric.group} | ${metric.name} | ${format(metric.value, metric.unit)} | ${format(metric.base, metric.unit)} | ${change === undefined ? "—" : percent((metric.value - metric.base) / metric.base)} ${status} | ${target} |`,
  );
}

const summary = [
  "### Rendimiento",
  "",
  `Umbrales respecto a la referencia: aviso si empeora más de un ${Math.round(warn * 100)} %, fallo si empeora más de un ${Math.round(fail * 100)} %.`,
  "",
  "| Grupo | Medida | Resultado | Referencia | Cambio | Objetivo |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
console.log(summary);

for (const metric of warnings) {
  const text = metric.missedTarget
    ? `${metric.group}: ${metric.name} = ${format(metric.value, metric.unit)}, no cumple el objetivo (${metric.target.text}).`
    : `${metric.group}: ${metric.name} ha empeorado (${format(metric.value, metric.unit)}; referencia ${format(metric.base, metric.unit)}).`;
  console.log(`::warning title=Rendimiento::${text}`);
}
for (const metric of failures) {
  console.log(
    `::error title=Regresión de rendimiento::${metric.group}: ${metric.name} = ${format(metric.value, metric.unit)}; referencia ${format(metric.base, metric.unit)}.`,
  );
}
if (failures.length > 0) process.exit(1);
