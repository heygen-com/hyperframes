/**
 * Sequencer cleanup + error-details helpers shared by the cancel and
 * error paths in `executeRenderJob`.
 */

import { rmSync } from "node:fs";
import { freemem } from "node:os";
import { type CaptureSession, closeCaptureSession } from "@hyperframes/engine";
import type { FileServerHandle } from "../fileServer.js";
import { defaultLogger, type ProducerLogger } from "../../logger.js";
import type { HdrDiagnostics, RenderJob } from "../renderOrchestrator.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import type { RenderObservabilitySummary } from "./observability.js";

/**
 * Wrap a cleanup operation so it never throws, but logs any failure.
 * The sequencer needs to keep tearing down resources even when one of
 * them is stuck (e.g. a `fileServer.close()` hitting a TCP race); a
 * thrown cleanup error would mask the original render failure.
 */
export async function safeCleanup(
  label: string,
  fn: () => Promise<void> | void,
  log: ProducerLogger = defaultLogger,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.debug(`Cleanup failed (${label})`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Close the file server, close the probe session, and remove the
 * working directory. Each step runs through `safeCleanup` so a stuck
 * resource doesn't mask the original render error.
 */
export async function cleanupRenderResources(input: {
  fileServer: FileServerHandle | null;
  probeSession: CaptureSession | null;
  workDir: string;
  debug: boolean;
  log: ProducerLogger;
  /** Suffix appended to safeCleanup labels. Pinned to the existing diagnostic payloads. */
  label: "cancel" | "error";
}): Promise<void> {
  const { fileServer, probeSession, workDir, debug, log, label } = input;
  if (fileServer) {
    const fs = fileServer;
    await safeCleanup(
      `close file server (${label})`,
      () => {
        fs.close();
      },
      log,
    );
  }
  if (probeSession) {
    const session = probeSession;
    await safeCleanup(`close probe session (${label})`, () => closeCaptureSession(session), log);
  }
  if (!debug) {
    // `force: true` swallows ENOENT, so no need to existsSync first.
    await safeCleanup(
      `remove workDir (${label})`,
      () => rmSync(workDir, { recursive: true, force: true }),
      log,
    );
  }
}

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
  };
}
