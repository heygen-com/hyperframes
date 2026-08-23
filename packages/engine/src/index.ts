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
  HfTransitionMeta,
  CaptureOptions,
  CaptureVideoMetadataHint,
  CaptureResult,
  CaptureBufferResult,
  CapturePerfSummary,
  CaptureWarning,
  CaptureWarningCode,
  SubTimelineWaitOutcome,
} from "./types.js";

// ── Configuration ──────────────────────────────────────────────────────────────
export {
  resolveConfig,
  validateEngineConfigSnapshot,
  DEFAULT_CONFIG,
  scaleProtocolTimeoutForComposition,
  shouldClampToScreenshotForConcreteGpu,
  applyConcreteGpuScreenshotClamp,
  explainDrawElementDisabled,
  resolveExtractCacheDir,
  defaultExtractCacheDir,
  EXTRACT_CACHE_DIR_DISABLED_ALIASES,
  type EngineConfig,
  type ExtractCacheDirResolution,
} from "./config.js";
export {
  DEFAULT_VP9_CPU_USED,
  MAX_VP9_CPU_USED,
  MIN_VP9_CPU_USED,
  normalizeVp9CpuUsed,
} from "./services/vp9Options.js";
export {
  getCgroupMemoryLimitMb,
  getSystemTotalMb,
  isLowMemorySystem,
  LOW_MEMORY_TOTAL_MB_THRESHOLD,
} from "./services/systemMemory.js";

// ── Browser management ─────────────────────────────────────────────────────────
export {
  acquireBrowser,
  releaseBrowser,
  drainBrowserPool,
  resolveHeadlessShellPath,
  resolveBrowserGpuMode,
  buildChromeArgs,
  ENABLE_BROWSER_POOL,
  BrowserLeasePool,
  type BuildChromeArgsOptions,
  type BrowserLaunchFingerprint,
  type BrowserLease,
  type BrowserPoolState,
  type CaptureMode,
  type AcquiredBrowser,
} from "./services/browserManager.js";
export {
  augmentProtocolTimeoutError,
  isProtocolTimeoutError,
} from "./services/protocolTimeoutErrorHint.js";
export {
  augmentPageNavigationTimeoutError,
  isPageNavigationTimeoutError,
  type NavigationTimeoutHintContext,
} from "./services/pageNavigationTimeoutErrorHint.js";

// ── Frame capture pipeline ──────────────────────────────────────────────────────
export {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrame,
  captureFrameToBuffer,
  captureFrameToBufferPipelined,
  captureFramesBatchPipelined,
  DrawElementVerificationError,
  isDrawElementVerificationError,
  getDrawElementVerificationDetails,
  type DrawElementVerificationDetails,
  recaptureDrawElementFrameForVerify,
  completeDeferredDrawElementInit,
  writeCapturedFrame,
  discardWarmupCapture,
  getCompositionDuration,
  getCapturePerfSummary,
  percentileOf,
  prepareCaptureSessionForReuse,
  deriveBeginFrameProbeTimeTicks,
  type CaptureSession,
  isTransientBrowserError,
  isMemoryExhaustionError,
  type BeforeCaptureHook,
  type DiscardWarmupInnerCapture,
  type StaticVerificationOutcome,
} from "./services/frameCapture.js";
export {
  CaptureFailure,
  classifyCaptureFailure,
  isFatalCaptureFailure,
  type CaptureFailureKind,
  type CaptureWorkerDiagnostic,
} from "./services/captureFailure.js";

// ── Screenshot (BeginFrame) ─────────────────────────────────────────────────────
export {
  beginFrameCapture,
  pageScreenshotCapture,
  getCdpSession,
  injectVideoFramesBatch,
  syncVideoFrameVisibility,
  cdpSessionCache,
  probeBeginFrameLiveness,
  initTransparentBackground,
  captureAlphaPng,
  applyDomLayerMask,
  removeDomLayerMask,
  DOM_LAYER_MASK_STYLE_ID,
  type BeginFrameResult,
} from "./services/screenshotService.js";

// ── Encoding ───────────────────────────────────────────────────────────────────
export {
  buildEncoderArgs,
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
  parseImageElements,
  extractVideoFramesRange,
  extractAllVideoFrames,
  resolveTimelineExtractionWindow,
  resolveVideoExtractionWindow,
  resolveFinalFrameExtractionWindow,
  resolveVideoExtractionDuration,
  resolvePlayableVideoDuration,
  extractionFrameCountForDuration,
  resolveProjectRelativeSrc,
  getFrameAtTime,
  createFrameLookupTable,
  FrameLookupTable,
  analyzeClipMediaFit,
  classifyVideoExtractionError,
  isVideoSourceExtractionError,
  runVideoExtractionWithRetry,
  VideoSourceExtractionError,
  type VideoElement,
  type ImageElement,
  type ExtractedFrames,
  type ExtractionOptions,
  type ExtractionResult,
  type ExtractionPhaseBreakdown,
  type TimelineExtractionWindow,
  type VideoExtractionFailure,
  type VideoExtractionFailureKind,
  type VideoFrameFormat,
  VIDEO_FRAME_FORMATS,
  isVideoFrameFormat,
} from "./services/videoFrameExtractor.js";

export { createVideoFrameInjector } from "./services/videoFrameInjector.js";

export {
  MIXED_AUDIO_FILENAME,
  parseAudioElements,
  processCompositionAudio,
} from "./services/audioMixer.js";
export { cloneCaptureWarning, cloneCaptureWarnings } from "./services/captureWarning.js";
export type {
  AudioElement,
  AudioFailureReason,
  AudioFailureStage,
  AudioProcessingFailure,
  AudioTrack,
  AudioVolumeKeyframe,
  MixResult,
} from "./services/audioMixer.types.js";

// ── Parallel rendering ─────────────────────────────────────────────────────────
export {
  calculateOptimalWorkers,
  computeWorkerSizing,
  selectVerifySampleIndicesForTask,
  verifyDiskDrawElementSamples,
  distributeFrames,
  distributeFramesInterleaved,
  executeParallelCapture,
  mergeWorkerFrames,
  getSystemResources,
  type WorkerTask,
  type WorkerResult,
  type WorkerSizing,
  type WorkerSizingBound,
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
  assertSwiftShader,
  readWebGlVendorInfo,
  SwiftShaderAssertionError,
  BROWSER_GPU_NOT_SOFTWARE,
} from "./utils/assertSwiftShader.js";

export { readWebGlVendorInfoFromCanvas } from "./utils/readWebGlVendorInfoFromCanvas.js";

export {
  extractMediaMetadata,
  extractVideoMetadata,
  extractFinalVideoFrameTimestamp,
  extractAudioMetadata,
  probeMediaProfile,
  analyzeKeyframeIntervals,
  type VideoMetadata,
  type AudioMetadata,
  type MediaProbeProfile,
  type KeyframeAnalysis,
} from "./utils/ffprobe.js";

export {
  NOT_MEDIA_PAYLOAD,
  NotMediaPayloadError,
  assertMediaPayload,
  fingerprintElementId,
  isNotMediaPayload,
} from "./utils/notMediaPayload.js";

export {
  assertPublicHttpsUrl,
  downloadToTemp,
  fetchPublicHttpsText,
  isHttpUrl,
  safeDownloadUrlIdentity,
  writeUrlDownloadTelemetry,
  type SafeDownloadUrlIdentity,
  type UrlDownloadOptions,
  type UrlDownloadTelemetry,
  type PublicHttpsTextOptions,
} from "./utils/urlDownloader.js";
export {
  runFfmpeg,
  formatFfmpegError,
  type RunFfmpegOptions,
  type RunFfmpegResult,
} from "./utils/runFfmpeg.js";
export {
  ManagedChildProcess,
  type ManagedChildProcessOptions,
  type ManagedChildProcessOutcome,
  type ManagedProcessTerminationReason,
} from "./utils/managedChildProcess.js";
export {
  assertConfiguredFfmpegBinariesExist,
  getFfmpegBinary,
  getFfprobeBinary,
  FFMPEG_PATH_ENV,
  FFPROBE_PATH_ENV,
} from "./utils/ffmpegBinaries.js";

export { trackChildProcess, killTrackedProcesses } from "./utils/processTracker.js";

// drawElement self-verify comparison — shared by the streaming drain
// (producer) and the parallel disk-path verify (parallelCoordinator).
export { psnrDb, resolveDeVerifyMinDb } from "./utils/psnr.js";

export {
  decodePng,
  decodePngToRgb48le,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  blitRgb48leAffine,
  parseTransformMatrix,
  roundedRectAlpha,
  resampleRgb48leObjectFit,
  normalizeObjectFit,
  type ObjectFit,
} from "./utils/alphaBlit.js";

export { groupIntoLayers, type CompositeLayer } from "./utils/layerCompositor.js";

export {
  diffGpuParityFrames,
  diffGpuParityPngs,
  verifyGpuParity,
  type RgbaFrame,
  type GpuParityDiffOptions,
  type GpuParityDiffResult,
  type BlackOnlyInARegion,
  type VerifyGpuParityResult,
} from "./utils/gpuParityDiff.js";

// ── Shader transitions ────────────────────────────────────────────────────────
export {
  type TransitionFn,
  TRANSITIONS,
  crossfade,
  sampleRgb48le,
  hdrToLinear,
  linearToHdr,
  convertTransfer,
} from "./utils/shaderTransitions.js";

export {
  initHdrReadback,
  uploadAndReadbackHdrFrame,
  float16ToPqRgb,
  buildHdrChromeArgs,
  launchHdrBrowser,
} from "./services/hdrCapture.js";

export { captureScreenshotWithAlpha } from "./services/screenshotService.js";

export {
  hideVideoElements,
  showVideoElements,
  queryVideoElementBounds,
  queryElementStacking,
  type VideoElementBounds,
  type ElementStackingInfo,
} from "./services/videoFrameInjector.js";

export {
  isHdrColorSpace,
  detectTransfer,
  getHdrEncoderColorParams,
  analyzeCompositionHdr,
  DEFAULT_HDR10_MASTERING,
  type HdrTransfer,
  type HdrEncoderColorParams,
  type CompositionHdrInfo,
  type HdrMasteringMetadata,
} from "./utils/hdr.js";
export type { VideoColorSpace } from "./utils/ffprobe.js";
export {
  renderProvenanceArgs,
  appendRenderProvenanceArgs,
  readRenderProvenance,
  PROVENANCE_RENDERER_TAG,
  PROVENANCE_VERSION_TAG,
  PROVENANCE_RENDERER_NAME,
  PROVENANCE_VERSION,
  type RenderProvenance,
} from "./utils/renderProvenance.js";
