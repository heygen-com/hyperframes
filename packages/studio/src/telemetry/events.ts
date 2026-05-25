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
