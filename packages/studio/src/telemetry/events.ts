import { trackEvent } from "./client";

// Studio frontend events. The corresponding `render_complete` / `render_error`
// events are emitted server-side by `packages/cli/src/server/studioServer.ts`
// with `source: "studio"` — keeping rich perf data on a single unified event.

export function trackStudioSessionStart(props: { has_project: boolean }): void {
  trackEvent("studio_session_start", {
    has_project: props.has_project,
  });
}

export function trackStudioRenderStart(props: {
  fps: number;
  quality: string;
  format: string;
  resolution?: string;
  composition?: string;
}): void {
  trackEvent("studio_render_start", {
    fps: props.fps,
    quality: props.quality,
    format: props.format,
    resolution: props.resolution,
    composition: props.composition,
  });
}

function getBrowserDoctorSummary(): string {
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string };
      userAgentData?: { platform?: string };
    };
    const platform = nav.userAgentData?.platform ?? navigator.platform ?? "unknown";
    const parts = [
      `ua=${platform}`,
      `screen=${screen.width}x${screen.height}@${devicePixelRatio}x`,
      `lang=${navigator.language}`,
    ];
    if (nav.deviceMemory) parts.push(`mem=${nav.deviceMemory}GB`);
    if (nav.connection?.effectiveType) parts.push(`net=${nav.connection.effectiveType}`);
    if (navigator.hardwareConcurrency) parts.push(`cpu=${navigator.hardwareConcurrency}cores`);
    return parts.join(" ");
  } catch {
    return "";
  }
}

export function trackStudioRazorSplit(props: { mode: "single" | "all"; count: number }): void {
  trackEvent("studio_razor_split", {
    mode: props.mode,
    count: props.count,
  });
}

// Adoption signal for the inline timeline-expansion surface: edits applied to a
// sub-composition child clip while its parent scene is expanded.
export function trackStudioExpandedClipEdit(props: {
  action: "move" | "resize" | "delete" | "split";
}): void {
  trackEvent("studio_expanded_clip_edit", { action: props.action });
}

export function trackStudioFeedback(props: { rating: number; comment?: string }): void {
  trackEvent("survey sent", {
    $survey_id: "studio_experience",
    $survey_response: props.rating,
    ...(props.comment ? { $survey_response_2: props.comment } : {}),
    doctor_summary: getBrowserDoctorSummary(),
    source: "studio",
  });
}
