import { describe, expect, it } from "bun:test";
import { createLayeredChunkObserver, createLayeredChunkClassifier } from "./layeredEligibility.js";
import type { LayeredFrame } from "./layeredFrameState.js";

const frame: LayeredFrame = { kind: "candidate", signature: "video-rect-A", videoCount: 2 };

describe("whole-chunk layered eligibility", () => {
  it("preserves a null injector without observing the page", () => {
    const observer = createLayeredChunkObserver({ startFrame: 20, endFrame: 23 }, 25);
    expect(observer.wrap(null)).toBeNull();
    expect(observer.decision()).toEqual({ kind: "fallback", reason: "no_video", frameIndex: null });
  });

  it("requires every absolute frame, independently of worker completion order", () => {
    const classifier = createLayeredChunkClassifier({ startFrame: 20, endFrame: 23 });
    classifier.observe(22, frame);
    classifier.observe(20, frame);
    expect(classifier.decision()).toEqual({
      kind: "fallback",
      reason: "incomplete_frames",
      frameIndex: null,
    });
    classifier.observe(21, frame);
    expect(classifier.decision()).toEqual({ kind: "eligible", frames: 3, videoCount: 2 });
  });

  it("does not let duplicate, warmup or adjacent-chunk observations fill a missing frame", () => {
    const classifier = createLayeredChunkClassifier({ startFrame: 20, endFrame: 23 });
    for (const index of [19, 20, 20, 20.5, 22, 23]) classifier.observe(index, frame);
    expect(classifier.decision()).toEqual({
      kind: "fallback",
      reason: "incomplete_frames",
      frameIndex: null,
    });
  });

  it("rejects an unsupported interior frame even when both endpoints match", () => {
    const classifier = createLayeredChunkClassifier({ startFrame: 0, endFrame: 3 });
    classifier.observe(0, frame);
    classifier.observe(1, { kind: "fallback", reason: "unsupported_stacking" });
    classifier.observe(2, frame);
    expect(classifier.decision()).toEqual({
      kind: "fallback",
      reason: "unsupported_stacking",
      frameIndex: 1,
    });
  });

  it("rejects video layout changes inside the chunk", () => {
    const classifier = createLayeredChunkClassifier({ startFrame: 0, endFrame: 3 });
    classifier.observe(0, frame);
    classifier.observe(1, { ...frame, signature: "translated-video" });
    classifier.observe(2, frame);
    expect(classifier.decision()).toEqual({
      kind: "fallback",
      reason: "changing_video_layout",
      frameIndex: 1,
    });
  });

  it("keeps a fresh attempt independent of a failed attempt", () => {
    const previous = createLayeredChunkClassifier({ startFrame: 0, endFrame: 1 });
    previous.observe(0, { kind: "fallback", reason: "unsupported_effect" });
    const retry = createLayeredChunkClassifier({ startFrame: 0, endFrame: 1 });
    expect(retry.decision().kind).toBe("fallback");
    retry.observe(0, frame);
    expect(retry.decision().kind).toBe("eligible");
    expect(previous.decision()).toEqual({
      kind: "fallback",
      reason: "unsupported_effect",
      frameIndex: 0,
    });
  });

  it.each([
    { startFrame: 1, endFrame: 1 },
    { startFrame: -1, endFrame: 2 },
    { startFrame: 0, endFrame: Infinity },
    { startFrame: 0.5, endFrame: 2 },
  ])("rejects an invalid frame range %j", (range) => {
    expect(() => createLayeredChunkClassifier(range)).toThrow("Invalid layered chunk frame range");
  });
});
