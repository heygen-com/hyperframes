// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { sealedPreviewFrame } from "../lib/sealedPreviewFrame.test-helpers";
import { usePreviewFirstFrameTelemetry } from "./usePreviewFirstFrameTelemetry";

const firstFrames = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("../../telemetry/events", () => ({
  trackPreviewFirstFrame: (props: Record<string, unknown>) => firstFrames.push(props),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  firstFrames.length = 0;
});

// fails without the fix: a sealed frame's document read as null, so the event said 0 clips and 0 seconds.
it("reports a sealed preview's clips and length on its first frame", async () => {
  document.body.innerHTML = `<div data-composition-id="main" data-duration="6">
    <div id="title" class="clip" data-start="0" data-duration="2"></div>
    <video id="shot" class="clip" data-start="2" data-duration="4" src="shot.mp4"></video>
  </div>`;
  const slot = { gen: 1, role: "live" as const };
  let report: ReturnType<typeof usePreviewFirstFrameTelemetry> | undefined;
  function Harness() {
    report = usePreviewFirstFrameTelemetry([slot]);
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(createElement(Harness)));

  report!(slot, { iframe: sealedPreviewFrame().iframe, startedAt: performance.now(), loadId: 1 });

  await vi.waitFor(() => expect(firstFrames).toHaveLength(1));
  expect(firstFrames[0]).toMatchObject({
    composition_seconds: 6,
    clip_count: 2,
    media_clip_count: 1,
  });
});
