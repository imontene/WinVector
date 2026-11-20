// Convierte los resultados del prototipo de texto (src/engine/prototipos/texto/resultados/*.json) en tablas Markdown
// para el resumen de la ejecución de GitHub Actions. Uso: node resumen.mjs <resultados.json>
import { appendFileSync, readFileSync } from "node:fs";

const results = JSON.parse(readFileSync(process.argv[2], "utf8"));
const modes = Object.keys(results.checks);
const names = [
  ...new Set(modes.flatMap((mode) => Object.keys(results.checks[mode]))),
];
const yes = (value) => (value ? "✅" : "❌");
const accuracy = results.accuracy;
const columns = accuracy.length > 0 ? Object.keys(accuracy[0]) : [];

const lines = [
  "### Prototipo de edición de texto",
  "",
  `Navegador: \`${results.browser}\``,
  "",
  `| Comprobación | ${modes.join(" | ")} |`,
  `| --- | ${modes.map(() => "---").join(" | ")} |`,
  ...names.map(
    (name) =>
      `| ${name} | ${modes.map((mode) => yes(results.checks[mode][name])).join(" | ")} |`,
  ),
  "",
  `| ${columns.join(" | ")} |`,
  `| ${columns.map(() => "---").join(" | ")} |`,
  ...accuracy.map(
    (row) => `| ${columns.map((column) => String(row[column])).join(" | ")} |`,
  ),
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines}\n`);
console.log(lines);
