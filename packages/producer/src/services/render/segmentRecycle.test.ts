import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_BROWSER_RECYCLE,
  isTargetLossError,
  resolveSegmentBrowserRecycle,
} from "./segmentRecycle.js";

describe("isTargetLossError", () => {
  it("matches the Chrome target-loss signatures seen in the field", () => {
    for (const msg of [
      "Protocol error (Page.captureScreenshot): Target closed",
      "Protocol error (Runtime.callFunctionOn): Target closed",
      "Attempted to use detached Frame 'B2CD611B9F8EF71674BEF3ABB0A9E0FD'.",
      "Protocol error: Session closed. Most likely the page has been closed.",
      "Target.closeTarget: Target closed",
    ]) {
      expect(isTargetLossError(new Error(msg))).toBe(true);
    }
  });

  it("does not match authoring or encoder errors", () => {
    // These reproduce on a fresh browser, so a retry only doubles the time
    // spent reaching the same failure.
    expect(isTargetLossError(new Error("Chunk concat failed: Invalid data"))).toBe(false);
    expect(isTargetLossError(new Error("media_start_out_of_range"))).toBe(false);
    expect(isTargetLossError(new Error("Segment 2 encode failed: broken pipe"))).toBe(false);
    expect(isTargetLossError(new Error("Sequential screenshot capture stalled"))).toBe(false);
    expect(isTargetLossError("Target closed")).toBe(false); // must be an Error
    expect(isTargetLossError(null)).toBe(false);
    expect(isTargetLossError(undefined)).toBe(false);
  });
});

describe("resolveSegmentBrowserRecycle", () => {
  it("defaults to 3 and accepts 0 as never", () => {
    expect(resolveSegmentBrowserRecycle({})).toBe(DEFAULT_SEGMENT_BROWSER_RECYCLE);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "0" })).toBe(0);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "1" })).toBe(1);
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "-2" })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "x" })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "1.5" })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
    expect(resolveSegmentBrowserRecycle({ HF_SEGMENT_BROWSER_RECYCLE: "  " })).toBe(
      DEFAULT_SEGMENT_BROWSER_RECYCLE,
    );
  });
});
