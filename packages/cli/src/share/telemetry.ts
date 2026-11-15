import { randomUUID } from "node:crypto";
import { AuthError } from "../auth/errors.js";
import { CliUsageError } from "../utils/commandResult.js";
import { readConfigFresh } from "../telemetry/config.js";
import { resetTelemetryPostureCache, trackEvent } from "../telemetry/client.js";
import type { ReviewExportProgress } from "@hyperframes/share";

export type ShareSurface = "cli" | "local_studio";
const LOCAL_STUDIO_UPGRADE_CTA = "share_modal_upgrade";
export type ShareInteraction =
  | Exclude<
      import("@hyperframes/studio-server").LocalShareInteraction,
      { event: "share_link_copied" }
    >
  | { event: "share_link_copied"; via: "copy" | "publish" | "update" };
const REASONS = new Set([
  "feature_unavailable",
  "audience_required",
  "workspace_cannot_share",
  "workspace_mismatch",
  "manage_existing_audience",
  "review_project_limit_reached",
  "review_subscription_required",
  "review_entitlement_unavailable",
  "review_public_consent_required",
  "moderation_hold",
  "review_operation_busy",
  "not_shared",
  "offline",
  "signed_out",
]);
function failureReason(error: unknown): string {
  if (error instanceof AuthError) return "authentication";
  if (error instanceof CliUsageError && REASONS.has(error.code)) return error.code;
  if (typeof error === "object" && error !== null && "reason" in error) {
    const reason = error.reason;
    if (typeof reason === "string" && REASONS.has(reason)) return reason;
  }
  return "other";
}
function emit(event: string, properties: Record<string, string | boolean>): void {
  try {
    // A preview process can outlive an opt-out made from another terminal.
    readConfigFresh();
    resetTelemetryPostureCache();
    trackEvent(event, properties);
  } catch {
    // Telemetry must not alter whether a share succeeds or fails.
  }
}
export function trackShareInteraction(input: ShareInteraction, surface: ShareSurface = "cli") {
  const base = { client_surface: surface };
  switch (input.event) {
    case "share_opened":
      return emit(input.event, { ...base, link: input.link });
    case "share_link_copied":
      return emit(input.event, { ...base, via: input.via });
    case "share_upgrade_clicked":
      return emit(input.event, { ...base, reason: input.reason, cta: LOCAL_STUDIO_UPGRADE_CTA });
    case "share_audience_selected":
      return emit(input.event, { ...base, audience: input.audience });
    case "share_source_toggled":
      return emit(input.event, { ...base, enabled: input.enabled });
    case "share_navigation_clicked":
      return emit(input.event, { ...base, destination: input.destination });
    case "share_action_clicked":
      return emit(input.event, { ...base, action: input.action });
  }
}

function shareAttempt(action: "share" | "update", surface: ShareSurface) {
  const base = { client_surface: surface, action, attempt_id: randomUUID() };
  let admitted = false;
  let recovery = false;
  const track = (event: string, extra: Record<string, string | boolean> = {}) =>
    emit(event, { ...base, recovery, ...extra });
  const admit = () => {
    if (admitted) return;
    admitted = true;
    track("share_mutation_admitted");
  };
  track("share_mutation_attempted");
  return {
    authenticated: () => track("share_mutation_authenticated"),
    recover: (pending: boolean) => {
      recovery = pending;
      if (pending) track("share_recovery_attempted");
    },
    progress: (value: ReviewExportProgress | null) => {
      if (value && value.step !== "preparing") admit();
    },
    retrieved: () => track("share_existing_link_returned"),
    complete: (ready: boolean, added: boolean) => {
      if (!added)
        return track(ready ? "share_existing_link_returned" : "share_mutation_processing");
      admit();
      track("share_video_ready");
    },
    failed: (error: unknown) => track("share_mutation_failed", { reason: failureReason(error) }),
  };
}
export type ShareAttempt = ReturnType<typeof shareAttempt>;
export async function observeShareMutation<T>(
  action: "share" | "update",
  surface: ShareSurface,
  run: (attempt: ShareAttempt) => Promise<T>,
): Promise<T> {
  const attempt = shareAttempt(action, surface);
  try {
    return await run(attempt);
  } catch (error) {
    attempt.failed(error);
    throw error;
  }
}
