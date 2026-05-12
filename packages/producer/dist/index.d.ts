/**
 * @hyperframes/producer
 *
 * Generic HTML-to-video rendering engine using Chrome's BeginFrame API.
 * Framework-agnostic: works with GSAP, Lottie, Three.js, CSS animations,
 * or any web content via configurable page contracts and hooks.
 */
export { createRenderJob, executeRenderJob, RenderCancelledError, type RenderConfig, type RenderJob, type RenderStatus, type RenderPerfSummary, type ProgressCallback, } from "./services/renderOrchestrator.js";
export { createCaptureSession, initializeSession, closeCaptureSession, captureFrame, captureFrameToBuffer, getCompositionDuration, getCapturePerfSummary, prepareCaptureSessionForReuse, type CaptureOptions, type CaptureSession, type CaptureResult, type CapturePerfSummary, type BeforeCaptureHook, } from "./services/frameCapture.js";
export { createFileServer, type FileServerOptions, type FileServerHandle, } from "./services/fileServer.js";
export { createVideoFrameInjector } from "./services/videoFrameInjector.js";
export { resolveConfig, DEFAULT_CONFIG, type ProducerConfig } from "./config.js";
export { type ProducerLogger, type LogLevel, createConsoleLogger, defaultLogger, } from "./logger.js";
export { createRenderHandlers, createProducerApp, startServer, type HandlerOptions, type ServerOptions, type RenderHandlers, } from "./server.js";
export { quantizeTimeToFrame } from "./utils/parityContract.js";
export { resolveRenderPaths, type RenderPaths } from "./utils/paths.js";
export { prepareHyperframeLintBody, runHyperframeLint, type PreparedHyperframeLintInput, } from "./services/hyperframeLint.js";
//# sourceMappingURL=index.d.ts.map