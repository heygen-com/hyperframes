/**
 * @hyperframes/producer
 *
 * Generic HTML-to-video rendering engine using Chrome's BeginFrame API.
 * Framework-agnostic: works with GSAP, Lottie, Three.js, CSS animations,
 * or any web content via configurable page contracts and hooks.
 */

// ── Main rendering pipeline ─────────────────────────────────────────────────
export {
  createRenderJob,
  executeRenderJob,
  RenderCancelledError,
  type RenderConfig,
  type RenderConfigInput,
  type RenderJob,
  type RenderStatus,
  type RenderPerfSummary,
  type ProgressCallback,
} from "./services/renderOrchestrator.js";
export {
  type BrowserDiagnosticSummary,
  type RenderCaptureObservability,
  type RenderObservabilitySummary,
  type RenderObservationData,
  type RenderObservationEvent,
  type RenderObservationStatus,
} from "./services/render/observability.js";

// ── HTML asset localization ─────────────────────────────────────────────────
// Rewrite remote <img>/<video>/<audio>/@font-face to same-origin local paths
// before capture. Shared by render and `validate` so both resolve assets alike.
export {
  localizeRemoteMediaSources,
  localizeRemoteImageSources,
  localizeRemoteFontFaces,
} from "./services/htmlCompiler.js";

// ── Frame capture (lower-level) ─────────────────────────────────────────────
export {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  getCompositionDuration,
  getCapturePerfSummary,
  prepareCaptureSessionForReuse,
  type CaptureOptions,
  type CaptureSession,
  type CaptureResult,
  type CapturePerfSummary,
  type BeforeCaptureHook,
} from "./services/frameCapture.js";

// ── File server ─────────────────────────────────────────────────────────────
export {
  createFileServer,
  type FileServerOptions,
  type FileServerHandle,
} from "./services/fileServer.js";

// ── Video frame injection (Hyperframes-specific hook) ───────────────────────
export { createVideoFrameInjector } from "@hyperframes/engine";

// ── Configuration ───────────────────────────────────────────────────────────
export { resolveConfig, DEFAULT_CONFIG, type ProducerConfig } from "./config.js";

// ── Logger ──────────────────────────────────────────────────────────────────
export {
  type ProducerLogger,
  type LogLevel,
  createConsoleLogger,
  defaultLogger,
} from "./logger.js";

// ── Server ──────────────────────────────────────────────────────────────────
export {
  createRenderHandlers,
  createProducerApp,
  startServer,
  type HandlerOptions,
  type ServerOptions,
  type RenderHandlers,
} from "./server.js";

// ── Utilities ───────────────────────────────────────────────────────────────
export { normalizeErrorMessage } from "./utils/errorMessage.js";
export { quantizeTimeToFrame } from "./utils/parityContract.js";
export { resolveRenderPaths, type RenderPaths } from "./utils/paths.js";

export {
  prepareHyperframeLintBody,
  runHyperframeLint,
  type PreparedHyperframeLintInput,
} from "./services/hyperframeLint.js";

// ── Distributed render primitives ───────────────────────────────────────────
// The full surface lives at `@hyperframes/producer/distributed`; we
// additionally re-export the three activity functions + their result
// types here so callers that pin `@hyperframes/producer` don't need a
// separate subpath import.
export {
  assemble,
  plan,
  renderChunk,
  type AssembleResult,
  type ChunkResult,
  type DistributedRenderConfig,
  type PlanResult,
} from "./distributed.js";
