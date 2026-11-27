/**
 * Módulo `document`.
 *
 * Carga y serialización SVG, preservación del contenido desconocido, gestión de `defs` e
 * identificadores (`SvgDocument`), y documentos abiertos en el motor (`DocumentManager`).
 */
export { SvgDocument, SvgParseError, SVG_NS, type SvgDocumentOptions } from "./svgDocument";
export {
  DocumentManager,
  UnknownDocumentError,
  type DocumentManagerOptions,
  type OpenDocument,
} from "./documentManager";
export {
  applyArtboard,
  formatViewBox,
  parseViewBox,
  readArtboard,
  sameArtboard,
  type ArtboardSettings,
} from "./artboard";
export * from "./collect";
