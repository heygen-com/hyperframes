export type {
  HyperFramesElement,
  SdkDocument,
  OverrideSet,
  EditOp,
  ElasticHold,
  FontValue,
  ImageValue,
  GsapTweenSpec,
  HfId,
  JsonPatchOp,
  PatchEvent,
  PersistErrorEvent,
  ElementSnapshot,
  ElementTimingSnapshot,
  FindQuery,
  SelectionProxy,
  ElementHandle,
  Composition,
  CanResult,
} from "./types.js";

export { ORIGIN_APPLY_PATCHES, ORIGIN_LOCAL } from "./types.js";

// Variable schema types — re-exported so SDK consumers (Studio, embedders)
// can type declarations without a direct @hyperframes/core dependency.
export type {
  CompositionVariable,
  CompositionVariableType,
  VariableValidationIssue,
} from "@hyperframes/core/variables";

export { UnsupportedOpError } from "./engine/mutate.js";

export { buildDocument, buildRoots, flatElements } from "./document.js";

export { isNewHostBoundary, bareId } from "./engine/model.js";

export { openComposition } from "./session.js";
export type { OpenCompositionOptions } from "./session.js";

export { createHistory } from "./history.js";
export type { HistoryModule, HistoryOptions, HistoryEntry } from "./history.js";

export { createPersistQueue } from "./persist-queue.js";
export type { PersistQueueModule, PersistQueueOptions } from "./persist-queue.js";

export type { PersistAdapter, PreviewAdapter, PersistVersionEntry } from "./adapters/types.js";

// Concrete adapter factories (browser-safe — Node-only fs adapter: @hyperframes/sdk/adapters/fs).
export { createMemoryAdapter } from "./adapters/memory.js";
export { createHeadlessAdapter } from "./adapters/headless.js";
export { createIframePreviewAdapter, resolveNearestHfElement } from "./adapters/iframe.js";
