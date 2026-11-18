import type { RenderJob, RenderPerfSummary } from "@hyperframes/producer";
import type { RenderObservabilityTelemetryPayload } from "./events.js";

type RenderObservabilitySummary = NonNullable<RenderPerfSummary["observability"]>;

export function renderObservabilityTelemetryPayload(
  observability: RenderObservabilitySummary | undefined,
): RenderObservabilityTelemetryPayload {
  if (!observability) return {};
  const diagnostics = observability.browserDiagnostics;
  const capture = observability.capture;
  const extraction = observability.extraction;
  const init = observability.init;
  return {
    observabilityRenderJobId: observability.renderJobId,
    observabilityCompositionHash: observability.compositionHash,
    observabilityEventCount: observability.eventCount,
    observabilityLastPhase: observability.lastEvent?.phase,
    observabilityLastStatus: observability.lastEvent?.status,
    observabilityFailedPhase: observability.failedPhase,
    browserDiagnosticCount: diagnostics.total,
    browserDiagnosticErrors: diagnostics.errors,
    browserDiagnosticPageErrors: diagnostics.pageErrors,
    browserDiagnosticRequestFailed: diagnostics.requestFailed,
    browserDiagnosticHttpErrors: diagnostics.httpErrors,
    browserDiagnosticNavigationStarts: diagnostics.navigationStarts,
    browserDiagnosticNavigationFailures: diagnostics.navigationFailures,
    browserDiagnosticConsoleErrors: diagnostics.consoleErrors,
    browserDiagnosticConsoleWarnings: diagnostics.consoleWarnings,
    captureMode: capture.captureMode,
    captureForceScreenshot: capture.forceScreenshot,
    captureWorkerCount: capture.workerCount,
    captureUseStreamingEncode: capture.useStreamingEncode,
    captureUseLayeredComposite: capture.useLayeredComposite,
    captureUsePageSideCompositing: capture.usePageSideCompositing,
    captureHasHdrContent: capture.hasHdrContent,
    captureBrowserGpuMode: capture.browserGpuMode,
    captureProtocolTimeoutMs: capture.protocolTimeoutMs,
    capturePageNavigationTimeoutMs: capture.pageNavigationTimeoutMs,
    capturePlayerReadyTimeoutMs: capture.playerReadyTimeoutMs,
    captureTransientRetries: capture.transientRetries,
    captureMemoryExhaustionDetected: capture.memoryExhaustionDetected,
    captureDeWorkerInversion: capture.deWorkerInversion,
    captureDePreInversionWorkers: capture.dePreInversionWorkers,
    captureCompositionElementCount: capture.compositionElementCount,
    captureCompositionElementCountSource: capture.compositionElementCountSource,
    captureCompositionElementTags: capture.compositionElementTags,
    captureArollVideoCount: capture.arollVideoCount,
    captureHeygenVideoCount: capture.heygenVideoCount,
    captureAdaptersUsed: capture.adaptersUsed,
    captureAudioCount: capture.audioCount,
    captureImageCount: capture.imageCount,
    captureSubCompositionCount: capture.subCompositionCount,
    captureAudioGroupCount: capture.audioGroupCount,
    captureColorGradingCount: capture.colorGradingCount,
    captureHasLut: capture.hasLut,
    captureRootBodyMismatch: capture.rootBodyMismatch,
    captureRootBodyDeltaPxBucket: capture.rootBodyDeltaPxBucket,
    captureDeShortBand: capture.deShortBand,
    captureDeParallelRouter: capture.deParallelRouter,
    captureDeGpuRenderer: capture.deGpuRenderer,
    captureDePreRouterWorkers: capture.dePreRouterWorkers,
    captureDeSelfVerifyFallback: capture.deSelfVerifyFallback,
    captureDeFallbackReason: capture.deFallbackReason,
    captureDeFallbackFailedDb: capture.deFallbackFailedDb,
    captureDeFallbackFrameIndex: capture.deFallbackFrameIndex,
    captureDeFallbackThresholdDb: capture.deFallbackThresholdDb,
    captureParallelStream: capture.captureParallelStream,
    captureChromeBrowserRssPeakMb: capture.chromeBrowserRssPeakMb,
    captureChromeRendererRssPeakMb: capture.chromeRendererRssPeakMb,
    captureChromeRssLastMb: capture.chromeRssLastMb,
    captureChromeGpuProcessSeenLastSample: capture.chromeGpuProcessSeenLastSample,
    captureChromeMemorySamples: capture.chromeMemorySamples,
    captureCapturePath: capture.capturePath,
    captureSegmentIndex: capture.segmentIndex,
    captureSegmentRetries: capture.segmentRetries,
    observabilityExtractVideoCount: extraction?.videoCount,
    observabilityExtractedVideoCount: extraction?.extractedVideoCount,
    observabilityExtractTotalFrames: extraction?.totalFramesExtracted,
    observabilityExtractMaxFramesPerVideo: extraction?.maxFramesPerVideo,
    observabilityExtractAvgFramesPerVideo: extraction?.avgFramesPerExtractedVideo,
    observabilityExtractVfrProbeMs: extraction?.vfrProbeMs,
    observabilityExtractVfrPreflightMs: extraction?.vfrPreflightMs,
    observabilityExtractVfrPreflightCount: extraction?.vfrPreflightCount,
    observabilityExtractCacheHits: extraction?.cacheHits,
    observabilityExtractCacheMisses: extraction?.cacheMisses,
    observabilityInitDurationMs: init?.initDurationMs,
    observabilityInitTweenCount: init?.tweenCount,
    observabilityInitElementCount: init?.elementCount,
  };
}

export function renderJobObservabilityTelemetryPayload(
  job: RenderJob | undefined,
): RenderObservabilityTelemetryPayload {
  return {
    ...renderObservabilityTelemetryPayload(
      job?.errorDetails?.observability ?? job?.perfSummary?.observability,
    ),
    subTimelineWait: job?.errorDetails?.subTimelineWait ?? job?.perfSummary?.subTimelineWait,
  };
}
