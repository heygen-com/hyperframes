/**
 * @hyperframes/engine
 *
 * Seekable web page to video rendering engine.
 * Framework-agnostic: works with GSAP, Lottie, Three.js, CSS animations,
 * or any web content that implements the window.__hf seek protocol.
 *
 * ## Error Convention
 *
 * Engine services use three error strategies depending on the operation type:
 *
 * - **Orchestration services throw on failure.** Browser launch, session init,
 *   frame capture, and CDP operations propagate errors as thrown exceptions.
 *   Callers are expected to catch and handle (e.g. frameCapture, browserManager,
 *   screenshotService, videoFrameExtractor.extractVideoFramesRange).
 *
 * - **FFmpeg process wrappers return `{ success, error? }` result objects.**
 *   Encoding, muxing, audio mixing, and streaming encode operations never reject.
 *   They resolve with a result that includes `success: boolean` and an optional
 *   `error` string (e.g. chunkEncoder, audioMixer, streamingEncoder).
 *
 * - **Cleanup and teardown functions never throw.** Browser close, session close,
 *   temp directory removal, and resource release swallow errors via `.catch(() => {})`
 *   to avoid masking the original failure (e.g. releaseBrowser, closeCaptureSession,
 *   FrameLookupTable.cleanup).
 *
 * - **Optional lookups return `T | undefined` or `T | null`.**
 *   Functions that may legitimately find nothing (resolveHeadlessShellPath,
 *   getFrameAtTime, detectGpuEncoder) return a nullable value instead of throwing.
 *
 */

// ── Protocol types ─────────────────────────────────────────────────────────────
export type {
  HfProtocol,
  HfMediaElement,
  CaptureOptions,
  CaptureResult,
  CaptureBufferResult,
  CapturePerfSummary,
} from "./types.js";

// ── Configuration ──────────────────────────────────────────────────────────────
export { resolveConfig, DEFAULT_CONFIG, type EngineConfig } from "./config.js";

// ── Browser management ─────────────────────────────────────────────────────────
export {
  acquireBrowser,
  releaseBrowser,
  resolveHeadlessShellPath,
  buildChromeArgs,
  ENABLE_BROWSER_POOL,
  type BuildChromeArgsOptions,
  type CaptureMode,
  type AcquiredBrowser,
} from "./services/browserManager.js";

// ── Frame capture pipeline ──────────────────────────────────────────────────────
export {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  getCompositionDuration,
  getCapturePerfSummary,
  prepareCaptureSessionForReuse,
  type CaptureSession,
  type BeforeCaptureHook,
} from "./services/frameCapture.js";

// ── Screenshot (BeginFrame) ─────────────────────────────────────────────────────
export {
  beginFrameCapture,
  pageScreenshotCapture,
  getCdpSession,
  injectVideoFramesBatch,
  syncVideoFrameVisibility,
  cdpSessionCache,
  type BeginFrameResult,
} from "./services/screenshotService.js";

// ── Encoding ───────────────────────────────────────────────────────────────────
export {
  encodeFramesFromDir,
  encodeFramesChunkedConcat,
  muxVideoWithAudio,
  applyFaststart,
  detectGpuEncoder,
  ENCODER_PRESETS,
  getEncoderPreset,
  type GpuEncoder,
} from "./services/chunkEncoder.js";
export type { EncoderOptions, EncodeResult, MuxResult } from "./services/chunkEncoder.types.js";

export {
  spawnStreamingEncoder,
  createFrameReorderBuffer,
  type StreamingEncoder,
  type StreamingEncoderOptions,
  type StreamingEncoderResult,
  type FrameReorderBuffer,
} from "./services/streamingEncoder.js";

// ── Media processing ───────────────────────────────────────────────────────────
export {
  parseVideoElements,
  extractVideoFramesRange,
  extractAllVideoFrames,
  getFrameAtTime,
  createFrameLookupTable,
  FrameLookupTable,
  type VideoElement,
  type ExtractedFrames,
  type ExtractionOptions,
  type ExtractionResult,
} from "./services/videoFrameExtractor.js";

export { createVideoFrameInjector } from "./services/videoFrameInjector.js";

export { parseAudioElements, processCompositionAudio } from "./services/audioMixer.js";
export type { AudioElement, AudioTrack, MixResult } from "./services/audioMixer.types.js";

// ── Parallel rendering ─────────────────────────────────────────────────────────
export {
  calculateOptimalWorkers,
  distributeFrames,
  executeParallelCapture,
  mergeWorkerFrames,
  getSystemResources,
  type WorkerTask,
  type WorkerResult,
  type ParallelProgress,
} from "./services/parallelCoordinator.js";

// ── File server ────────────────────────────────────────────────────────────────
export {
  createFileServer,
  type FileServerOptions,
  type FileServerHandle,
} from "./services/fileServer.js";

// ── Utilities ──────────────────────────────────────────────────────────────────
export { quantizeTimeToFrame, MEDIA_VISUAL_STYLE_PROPERTIES } from "@hyperframes/core";

export {
  extractVideoMetadata,
  extractAudioMetadata,
  analyzeKeyframeIntervals,
  type VideoMetadata,
  type AudioMetadata,
  type KeyframeAnalysis,
} from "./utils/ffprobe.js";

export { downloadToTemp, isHttpUrl } from "./utils/urlDownloader.js";
