import { PrimitiveFunnel, type PrimitiveFunnelErrorCode } from "./primitive-funnel.js";
import { claimPrimitiveFunnelEvent, readPrimitiveFunnelContext } from "./primitive-funnel-state.js";

function emitProjectTerminal(
  projectDir: string,
  suffix: "preview" | "render",
  emit: (funnel: PrimitiveFunnel, eventId: string) => void,
): void {
  const context = readPrimitiveFunnelContext(projectDir);
  if (!context) return;
  const eventId = `${context.installId}:${suffix}`;
  if (!claimPrimitiveFunnelEvent(projectDir, eventId)) return;
  emit(new PrimitiveFunnel(context), eventId);
}

export function trackPrimitivePreviewSucceeded(projectDir: string): void {
  emitProjectTerminal(projectDir, "preview", (funnel, eventId) => funnel.previewSucceeded(eventId));
}

export function trackPrimitivePreviewFailed(
  projectDir: string,
  errorCode: PrimitiveFunnelErrorCode,
): void {
  emitProjectTerminal(projectDir, "preview", (funnel, eventId) =>
    funnel.previewFailed(eventId, errorCode),
  );
}

export function trackPrimitiveRenderSucceeded(projectDir: string): void {
  emitProjectTerminal(projectDir, "render", (funnel, eventId) => funnel.renderSucceeded(eventId));
}

export function trackPrimitiveRenderFailed(
  projectDir: string,
  errorCode: PrimitiveFunnelErrorCode,
): void {
  emitProjectTerminal(projectDir, "render", (funnel, eventId) =>
    funnel.renderFailed(eventId, errorCode),
  );
}
