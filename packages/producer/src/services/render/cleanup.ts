/** Error-detail construction shared by render failure paths. */

import { freemem } from "node:os";
import { type SubTimelineWaitOutcome } from "@hyperframes/engine";
import type { HdrDiagnostics, RenderJob } from "../renderOrchestrator.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import type { RenderObservabilitySummary } from "./observability.js";

/**
 * Build the `RenderJob.errorDetails` shape downstream consumers (SSE,
 * sync `/render` response, queue introspection) read on failure.
 */
export function buildRenderErrorDetails(input: {
  error: unknown;
  pipelineStartMs: number;
  lastBrowserConsole: string[];
  perfStages: Record<string, number>;
  hdrDiagnostics: HdrDiagnostics;
  observability?: RenderObservabilitySummary;
  subTimelineWait?: SubTimelineWaitOutcome;
}): NonNullable<RenderJob["errorDetails"]> {
  const errorMessage = normalizeErrorMessage(input.error);
  const errorStack = input.error instanceof Error ? input.error.stack : undefined;
  return {
    message: errorMessage,
    stack: errorStack,
    elapsedMs: Date.now() - input.pipelineStartMs,
    freeMemoryMB: Math.round(freemem() / (1024 * 1024)),
    browserConsoleTail:
      input.lastBrowserConsole.length > 0 ? input.lastBrowserConsole.slice(-30) : undefined,
    perfStages: Object.keys(input.perfStages).length > 0 ? { ...input.perfStages } : undefined,
    hdrDiagnostics:
      input.hdrDiagnostics.videoExtractionFailures > 0 ||
      input.hdrDiagnostics.imageDecodeFailures > 0
        ? { ...input.hdrDiagnostics }
        : undefined,
    observability: input.observability,
    subTimelineWait: input.subTimelineWait,
  };
}
