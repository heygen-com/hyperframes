import { describe, expect, it } from "vitest";
import { qualifyVideoLayer } from "./videoLayerPassthrough.js";
import type { VideoElement } from "./videoFrameExtractor.js";

const clip = (over: Partial<VideoElement> = {}): VideoElement => ({
  id: "v",
  src: "a.mp4",
  start: 0,
  end: 10,
  mediaStart: 0,
  loop: false,
  hasAudio: false,
  ...over,
});

describe("qualifyVideoLayer", () => {
  it("accepts one video covering the whole timeline", () => {
    expect(qualifyVideoLayer([clip()], 10)).toEqual({ qualifies: true, video: clip() });
  });

  it.each([
    ["video_count", [] as VideoElement[], {}],
    ["video_count", [clip(), clip({ id: "w" })], {}],
    ["hidden", [clip({ hidden: true })], {}],
    ["color_grading", [clip({ graded: true })], {}],
    ["loop", [clip({ loop: true })], {}],
    ["playback_rate", [clip({ playbackRate: 2 })], {}],
    ["late_start", [clip({ start: 1 })], {}],
    ["ends_early", [clip({ end: 9 })], {}],
  ])("refuses %s", (reason, videos) => {
    expect(qualifyVideoLayer(videos, 10)).toEqual({ qualifies: false, reason });
  });
});
