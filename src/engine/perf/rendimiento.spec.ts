import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { command, openWithFakeHost } from "../e2e/host";
import { generateDocument } from "./generate";

/**
 * Medición de rendimiento del motor (issue #34) con documentos de 500, 2.000 y 10.000 objetos:
 * tiempo de carga y fotogramas por segundo al arrastrar, escribir en un texto, mover el extremo de
 * un degradado, hacer zoom y desplazar.
 *
 * No es una prueba de aciertos y fallos: escribe los resultados en perf/resultados/motor.json y
 * `npm run perf:compare` los compara con la referencia (perf/referencia.json).
 */

const SIZES = [500, 2000, 10000] as const;
/** Duración de cada gesto: 60 movimientos separados por un fotograma. */
const STEPS = 60;
const FRAME = 16;

interface FrameStats {
  /** Fotogramas por segundo durante el gesto. */
  readonly fps: number;
  /** Percentil 95 del tiempo entre fotogramas, en milisegundos. */
  readonly p95: number;
}

interface Result {
  readonly objects: number;
  readonly loadMs: number;
  readonly drag: FrameStats;
  readonly zoom: FrameStats;
  readonly pan: FrameStats;
  /** Escribir en un texto con la herramienta Texto (issue #99): cada letra reescribe el texto. */
  readonly type: FrameStats;
  /** Arrastrar el extremo de un degradado con la herramienta Degradado (issue #115). */
  readonly gradient: FrameStats;
}

const results: Result[] = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await openWithFakeHost(page);
});

test.afterAll(() => {
  mkdirSync(new URL("./resultados/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("./resultados/motor.json", import.meta.url),
    `${JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
});

/** Empieza a anotar el instante de cada fotograma. */
const startFrames = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as { __frames: number[]; __recording: number };
    // Cada medición tiene su propio bucle; el de la anterior se detiene al ver otro número.
    const recording = (host.__recording || 0) + 1;
    host.__frames = [];
    host.__recording = recording;
    const tick = (time: number) => {
      if (host.__recording !== recording) return;
      host.__frames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Deja de anotar y resume los fotogramas. */
const stopFrames = (page: Page): Promise<FrameStats> =>
  page.evaluate(() => {
    const host = window as unknown as { __frames: number[]; __recording: number };
    host.__recording += 1;
    const frames = host.__frames;
    const intervals = frames
      .slice(1)
      .map((time, index) => time - (frames[index] ?? time))
      .sort((a, b) => a - b);
    const first = frames[0] ?? 0;
    const last = frames.at(-1) ?? first;
    const fps = frames.length > 1 ? ((frames.length - 1) * 1000) / (last - first) : 0;
    const p95 = intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * 0.95))] ?? 0;
    return { fps: Math.round(fps * 10) / 10, p95: Math.round(p95 * 10) / 10 };
  });

async function measure(page: Page, gesture: (step: number) => Promise<void>): Promise<FrameStats> {
  await startFrames(page);
  for (let step = 0; step < STEPS; step++) {
    await gesture(step);
    await page.waitForTimeout(FRAME);
  }
  return stopFrames(page);
}

for (const objects of SIZES) {
  test(`${String(objects)} objetos`, async ({ page }) => {
    test.setTimeout(180_000);
    const svg = generateDocument(objects);

    // Carga: desde que la aplicación envía el documento hasta que se ha pintado.
    const loadMs = await page.evaluate(
      async ({ load, activate }) => {
        const host = window as unknown as {
          __hostSend: (data: unknown) => void;
          __sent: { id?: string }[];
        };
        const responded = (id: string) =>
          new Promise<void>((resolve) => {
            const check = () => {
              if (host.__sent.some((message) => message.id === id)) resolve();
              else setTimeout(check, 1);
            };
            check();
          });
        const start = performance.now();
        host.__hostSend(load);
        await responded("c-perf-load");
        host.__hostSend(activate);
        await responded("c-perf-activate");
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.round(performance.now() - start);
      },
      {
        load: command("c-perf-load", "document.load", {
          documentId: "perf",
          name: "perf.svg",
          svg,
        }),
        activate: command("c-perf-activate", "document.activate", { documentId: "perf" }),
      },
    );
    await expect(page.locator("#o0")).toBeVisible();

    // Arrastrar un objeto (con Ctrl+clic se selecciona el más profundo).
    const box = await page.locator("#o0").boundingBox();
    if (!box) throw new Error("El primer objeto no se ve");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.keyboard.down("Control");
    await page.mouse.click(start.x, start.y);
    await page.keyboard.up("Control");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const before = await page.locator("#o0").boundingBox();
    const drag = await measure(page, (step) => page.mouse.move(start.x + step * 2, start.y + step));
    await page.mouse.up();
    const after = await page.locator("#o0").boundingBox();
    expect(after?.x, "el arrastre debe mover el objeto").not.toBe(before?.x);

    // Mover el extremo de un degradado con la herramienta Degradado. El primer objeto, que sigue
    // seleccionado tras arrastrarlo, tiene uno compartido con otros: al empezar se copia para él.
    await page.keyboard.press("d");
    const end = await page.locator(".overlay .overlay-gradient-end").boundingBox();
    if (!end) throw new Error("No se ve el extremo del degradado");
    const handle = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    const gradient = await measure(page, (step) =>
      page.mouse.move(handle.x + step, handle.y + step / 2),
    );
    await page.mouse.up();
    expect(
      await page.locator("#o0").getAttribute("fill"),
      "mover el extremo debe dar al objeto su propio degradado",
    ).not.toBe("url(#degradado)");
    await page.keyboard.press("v");

    // Escribir en un texto: con la herramienta Texto, clic en el primero y una letra por fotograma.
    // Los textos del documento generado (el de ejemplo, en otra pestaña, también tiene uno).
    const text = page.locator(`text[id^="o"]`).first();
    const textBox = await text.boundingBox();
    if (!textBox) throw new Error("El primer texto no se ve");
    await page.keyboard.press("t");
    await page.mouse.click(textBox.x + textBox.width - 1, textBox.y + textBox.height / 2);
    const typed = (await text.textContent()) ?? "";
    const type = await measure(page, () => page.keyboard.type("a"));
    await page.keyboard.press("Escape");
    expect((await text.textContent())?.length, "escribir debe cambiar el texto").toBeGreaterThan(
      typed.length,
    );
    await page.keyboard.press("v");

    // Zoom con Ctrl+rueda, acercando y alejando.
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.keyboard.down("Control");
    const zoom = await measure(page, (step) => page.mouse.wheel(0, step < STEPS / 2 ? -40 : 40));
    await page.keyboard.up("Control");

    // Desplazar con la rueda.
    const pan = await measure(page, (step) => page.mouse.wheel(step % 2 === 0 ? 30 : 0, 30));

    const result = { objects, loadMs, drag, type, gradient, zoom, pan };
    results.push(result);
    test.info().annotations.push({ type: "rendimiento", description: JSON.stringify(result) });
    console.log(JSON.stringify(result));
  });
}

test("el generador da el número pedido de objetos", () => {
  expect(generateDocument(500).match(/ id="o\d+"/g)).toHaveLength(500);
});
