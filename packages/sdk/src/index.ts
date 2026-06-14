export type {
  HyperFramesElement,
  SdkDocument,
  OverrideSet,
  EditOp,
  ElasticHold,
  GsapTweenSpec,
  HfId,
  JsonPatchOp,
  PatchEvent,
  PersistErrorEvent,
  ElementSnapshot,
  FindQuery,
  SelectionProxy,
  ElementHandle,
  Composition,
  CanResult,
} from "./types.js";

export { ORIGIN_APPLY_PATCHES, ORIGIN_LOCAL } from "./types.js";

export { UnsupportedOpError } from "./engine/mutate.js";

export { buildDocument, buildRoots, flatElements } from "./document.js";

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
export { createHttpAdapter } from "./adapters/http.js";
export type { HttpAdapterOptions } from "./adapters/http.js";
