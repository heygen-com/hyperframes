export const WEB_CAPTURE_BUDGETS = {
  clipboardItems: 1,
  finalUtf8Bytes: 10_000_000,
  htmlCssBytes: 1_000_000,
  nodes: 10_000,
  depth: 128,
  resources: 64,
  attributeBytes: 65_536,
  rasterPixels: 16_000_000,
  captureDeadlineMs: 12_000,
  aggregateDecodedPixels: 32_000_000,
  materializedBytes: 8_000_000,
  modelBytes: 8_000_000,
  decodedFontBytes: 16_000_000,
  mediaDimension: 8_192,
  mediaDurationMs: 12_000,
  svgExpansionNodes: 10_000,
  cssRules: 10_000,
  cssTokens: 100_000,
  cssFunctionDepth: 32,
  phaseDeadlineMs: 4_000,
  diagnostics: 100,
  devicePixelRatio: 8,
} as const;

export type WebCaptureBudget = keyof typeof WEB_CAPTURE_BUDGETS;

export function withinWebCaptureBudget(name: WebCaptureBudget, actual: number): boolean {
  return Number.isFinite(actual) && actual >= 0 && actual <= WEB_CAPTURE_BUDGETS[name];
}
