import { describe, expect, it } from "vitest";
import { resolveClipRenderContext } from "./timelineClipChildren";
import type { TimelineElement } from "../store/playerStore";

const clip: TimelineElement = {
  id: "clip",
  tag: "video",
  start: 10,
  duration: 5,
  track: 0,
};

describe("resolveClipRenderContext", () => {
  it("prioritizes interactive clips and enables rich thumbnails", () => {
    expect(resolveClipRenderContext(clip, { start: 0, end: 1 }, true)).toEqual({
      priority: "interaction",
      rich: true,
    });
  });

  it("distinguishes visible clips from overscan clips", () => {
    expect(resolveClipRenderContext(clip, { start: 14, end: 16 }, false)).toEqual({
      priority: "visible",
      rich: false,
    });
    expect(resolveClipRenderContext(clip, { start: 15, end: 20 }, false)).toEqual({
      priority: "overscan",
      rich: false,
    });
  });
});
