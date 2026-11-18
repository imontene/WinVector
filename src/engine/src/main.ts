import { version as engineVersion } from "../package.json";
import { EngineBridge, detectTransport } from "./bridge";
import { SvgDocument } from "./document";
import sampleSvg from "./sample.svg?raw";
import { describeElement, selectableElementAt } from "./selection";

const workspace = document.getElementById("workspace");
if (!workspace) {
  throw new Error("Falta el contenedor #workspace en la página.");
}

const bridge = new EngineBridge(detectTransport(), { engineVersion });

bridge.handle("app.ping", ({ sentAt }) => ({ sentAt, receivedAt: Date.now() }));

// Provisional hasta que la aplicación entregue documentos (document.load, issue #22).
const svgDocument = SvgDocument.load(sampleSvg, workspace);

// Fase 0: un clic selecciona un elemento; un clic en el fondo vacía la selección.
// El documento está en un shadow root: el destino real del evento es el primero de composedPath().
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const element = selectableElementAt(event.composedPath()[0] ?? null, svgDocument.root);
  bridge.emit("selection.changed", { items: element ? [describeElement(element)] : [] });
});

bridge.start();
