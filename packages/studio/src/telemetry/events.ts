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

export type StudioTimelinePerformanceSample = {
  total_clip_count: number;
  mounted_clip_count: number;
  total_row_count: number;
  timeline_dom_node_count: number;
  viewport_width: number;
  viewport_height: number;
  zoom_mode: string;
  scroll_sample_count: number;
  scroll_frame_latency_p95_ms: number;
  scroll_frame_latency_max_ms: number;
  frame_interval_p95_ms?: number;
};

export function trackStudioTimelinePerformance(props: StudioTimelinePerformanceSample): void {
  trackEvent("studio_timeline_performance", props);
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

// Adoption signal for the per-clip keyframe-lane caret toggle.
export function trackStudioKeyframeLaneExpand(props: { expanded: boolean }): void {
  trackEvent("studio_keyframe_lane_expand", { expanded: props.expanded });
}

// Adoption signal for opening and committing the per-segment ease editor.
export function trackStudioSegmentEaseEdit(props: {
  action: "open" | "commit";
  ease?: string;
}): void {
  trackEvent("studio_segment_ease_edit", { action: props.action, ease: props.ease });
}

export function trackStudioFeedback(props: { rating: number; comment?: string }): void {
  // Plain product event, not a PostHog survey response: nothing here is served
  // by the surveys product (no survey definition, no targeting, no popover).
  trackEvent("studio_feedback", {
    rating: props.rating,
    rating_scale: 10,
    ...(props.comment ? { comment: props.comment } : {}),
    doctor_summary: getBrowserDoctorSummary(),
    source: "studio",
  });
}
