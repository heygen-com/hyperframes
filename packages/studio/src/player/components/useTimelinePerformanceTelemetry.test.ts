// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { summarizeTimelinePerformance } from "./useTimelinePerformanceTelemetry";

describe("summarizeTimelinePerformance", () => {
  it("reports raw mounted work and p95 scroll timings", () => {
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: 1_200 },
      clientHeight: { value: 360 },
    });
    scroll.innerHTML = `
      <div>
        <div data-clip="true"></div>
        <div data-clip="true"><span></span></div>
      </div>
    `;

    expect(
      summarizeTimelinePerformance(
        scroll,
        { totalClipCount: 3_000, totalRowCount: 24, zoomMode: "fit" },
        [8, 10, 12, 80],
        [16, 17, 45],
      ),
    ).toEqual({
      total_clip_count: 3_000,
      mounted_clip_count: 2,
      total_row_count: 24,
      timeline_dom_node_count: 4,
      viewport_width: 1_200,
      viewport_height: 360,
      zoom_mode: "fit",
      scroll_sample_count: 4,
      scroll_frame_latency_p95_ms: 80,
      scroll_frame_latency_max_ms: 80,
      frame_interval_p95_ms: 45,
    });
  });

  it("does not emit a summary without a completed animation frame", () => {
    const scroll = document.createElement("div");

    expect(
      summarizeTimelinePerformance(
        scroll,
        { totalClipCount: 1, totalRowCount: 1, zoomMode: "manual" },
        [],
        [],
      ),
    ).toBeNull();
  });
});
