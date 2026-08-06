import { PrimitiveFunnel, type PrimitiveFunnelErrorCode } from "./primitive-funnel.js";
import {
  claimPrimitiveFunnelEvent,
  readPrimitiveFunnelContext,
  releasePrimitiveFunnelEvent,
} from "./primitive-funnel-state.js";
import { flush, shouldTrack } from "./client.js";

/**
 * Emit one terminal funnel event for a project, at most once per install under
 * concurrency, and await delivery.
 *
 * The await is the point. Terminal events are the only telemetry in the CLI
 * that consumes a durable single-use claim, so the usual fire-and-forget exit
 * flush is not good enough: the claim outlives the process, the detached flush
 * child does not, and a send that never lands leaves a claim burned on an event
 * PostHog never saw. Confirming delivery here lets us give the claim back.
 */
async function emitProjectTerminal(
  projectDir: string,
  suffix: "preview" | "render",
  emit: (funnel: PrimitiveFunnel, eventId: string) => void,
): Promise<void> {
  // Claiming while telemetry is off would burn the claim on an event that is
  // never enqueued, silently disabling the step if tracking is re-enabled.
  if (!shouldTrack()) return;
  const context = readPrimitiveFunnelContext(projectDir);
  if (!context) return;
  const eventId = `${context.installId}:${suffix}`;
  if (!claimPrimitiveFunnelEvent(projectDir, eventId)) return;
  emit(new PrimitiveFunnel(context), eventId);
  if (!(await flush())) releasePrimitiveFunnelEvent(projectDir, eventId);
}

export async function trackPrimitivePreviewSucceeded(
  projectDir: string,
  durationMs: number,
): Promise<void> {
  await emitProjectTerminal(projectDir, "preview", (funnel, eventId) =>
    funnel.previewSucceeded(eventId, durationMs),
  );
}

export async function trackPrimitivePreviewFailed(
  projectDir: string,
  errorCode: PrimitiveFunnelErrorCode,
  durationMs: number,
): Promise<void> {
  await emitProjectTerminal(projectDir, "preview", (funnel, eventId) =>
    funnel.previewFailed(eventId, errorCode, durationMs),
  );
}

export async function trackPrimitiveRenderSucceeded(
  projectDir: string,
  durationMs: number,
): Promise<void> {
  await emitProjectTerminal(projectDir, "render", (funnel, eventId) =>
    funnel.renderSucceeded(eventId, durationMs),
  );
}

export async function trackPrimitiveRenderFailed(
  projectDir: string,
  errorCode: PrimitiveFunnelErrorCode,
  durationMs: number,
): Promise<void> {
  await emitProjectTerminal(projectDir, "render", (funnel, eventId) =>
    funnel.renderFailed(eventId, errorCode, durationMs),
  );
}
