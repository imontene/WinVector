import { expect, test } from "@playwright/test";
import { command, hostSend, openWithFakeHost, sent } from "./host";

/** Fuentes que usa un documento, para avisar de las que faltan (issue #97). */

const DOC = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <text id="a" x="40" y="60" font-family="'Fuente Que No Existe', serif" font-size="20">Hola</text>
  <text id="b" x="40" y="120" font-family="Georgia, serif" font-size="20">Mundo</text>
</svg>
`;

const fontsOf = async (page: import("@playwright/test").Page, documentId: string) =>
  (await sent(page))
    .filter(
      (m) =>
        m.name === "document.fonts" &&
        (m.payload as { documentId: string }).documentId === documentId,
    )
    .map((m) => (m.payload as { fonts: { families: string[] }[] }).fonts);

test("al cargar un documento y al cambiar sus fuentes se anuncian, sin repetirse", async ({
  page,
}) => {
  await openWithFakeHost(page);
  await hostSend(
    page,
    command("c-load2", "document.load", { documentId: "d2", name: "f", svg: DOC }),
  );
  await hostSend(page, command("c-act2", "document.activate", { documentId: "d2" }));
  await expect
    .poll(() => fontsOf(page, "d2"))
    .toEqual([
      [{ families: ["Fuente Que No Existe", "serif"] }, { families: ["Georgia", "serif"] }],
    ]);

  // Cambiar la fuente de un texto: se anuncia la lista nueva.
  await hostSend(page, command("c-sel", "selection.selectAll", { documentId: "d2" }));
  await hostSend(
    page,
    command("c-txt", "selection.setText", { documentId: "d2", fontFamily: "Consolas" }),
  );
  await expect
    .poll(async () => (await fontsOf(page, "d2")).at(-1))
    .toEqual([{ families: ["Consolas", "monospace"] }]);

  // Un cambio que no toca las fuentes no vuelve a anunciarlas.
  const count = (await fontsOf(page, "d2")).length;
  await hostSend(
    page,
    command("c-mov", "selection.setGeometry", {
      documentId: "d2",
      x: 10,
      y: null,
      width: null,
      height: null,
      rotation: null,
    }),
  );
  await page.waitForTimeout(600);
  expect((await fontsOf(page, "d2")).length).toBe(count);
});
