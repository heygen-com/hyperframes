import { describe, expect, it } from "bun:test";
import type { VideoElement } from "@hyperframes/engine";
import {
  captureHdrWithPassthrough,
  createDeferredPassthroughFrames,
  type FrameDeferralGateInput,
  passthroughDefersFrameExtraction,
} from "./frameDeferral.js";
import type { HdrPassthroughOutcome, HdrPassthroughResult } from "./types.js";

function video(overrides: Partial<VideoElement> = {}): VideoElement {
  return {
    id: "hdr-source",
    src: "assets/hlg.mp4",
    start: 0,
    end: 20,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
    ...overrides,
  };
}

function gate(overrides: Partial<FrameDeferralGateInput> = {}): FrameDeferralGateInput {
  return {
    experimentalHdrPassthrough: true,
    hdrMode: undefined,
    outputFormat: "mp4",
    needsAlpha: false,
    motionBlur: false,
    composition: { videos: [video()], duration: 20 },
    framesHeldBackElsewhere: false,
    ...overrides,
  };
}

function result(label: string): HdrPassthroughResult {
  return {
    lastBrowserConsole: [label],
    hdrPerf: undefined,
    captureDurationMs: 1,
    encodeMs: 1,
    warnings: [],
  } as unknown as HdrPassthroughResult;
}

describe("passthroughDefersFrameExtraction", () => {
  it("defers for one full-length local video on an opted-in HDR-capable mp4 render", () => {
    expect(passthroughDefersFrameExtraction(gate())).toBe(true);
    expect(passthroughDefersFrameExtraction(gate({ hdrMode: "auto" }))).toBe(true);
    expect(passthroughDefersFrameExtraction(gate({ hdrMode: "force-hdr" }))).toBe(true);
  });

  it("never defers with the flag off", () => {
    expect(passthroughDefersFrameExtraction(gate({ experimentalHdrPassthrough: false }))).toBe(
      false,
    );
    expect(passthroughDefersFrameExtraction(gate({ experimentalHdrPassthrough: undefined }))).toBe(
      false,
    );
  });

  it.each<[string, Partial<FrameDeferralGateInput>]>([
    ["force-sdr", { hdrMode: "force-sdr" }],
    ["webm output", { outputFormat: "webm" }],
    ["alpha output", { needsAlpha: true }],
    ["motion blur", { motionBlur: true }],
    ["a frame window or the video layer passthrough", { framesHeldBackElsewhere: true }],
    ["canvas grading", { composition: { videos: [video()], duration: 20, gradedCanvas: true } }],
    [
      "a master effect chain",
      { composition: { videos: [video()], duration: 20, masterFxChain: "eq=gamma=1.1" } },
    ],
    ["two videos", { composition: { videos: [video(), video({ id: "second" })], duration: 20 } }],
    ["no video", { composition: { videos: [], duration: 20 } }],
    ["a looping video", { composition: { videos: [video({ loop: true })], duration: 20 } }],
    ["a late start", { composition: { videos: [video({ start: 2 })], duration: 20 } }],
    ["an early end", { composition: { videos: [video({ end: 12 })], duration: 20 } }],
    [
      "a remote source",
      { composition: { videos: [video({ src: "https://example.com/a.mp4" })], duration: 20 } },
    ],
  ])("does not defer with %s", (_label, overrides) => {
    expect(passthroughDefersFrameExtraction(gate(overrides))).toBe(false);
  });
});

describe("createDeferredPassthroughFrames", () => {
  it("is a no-op when nothing was deferred", async () => {
    let calls = 0;
    const frames = createDeferredPassthroughFrames(false, async () => {
      calls += 1;
    });
    expect(frames.pending).toBe(false);
    await frames.ensureExtracted();
    expect(calls).toBe(0);
  });

  it("extracts once, sharing the extraction between concurrent callers", async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const frames = createDeferredPassthroughFrames(true, () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    expect(frames.pending).toBe(true);
    const first = frames.ensureExtracted();
    const second = frames.ensureExtracted();
    expect(calls).toBe(1);
    expect(frames.pending).toBe(true);
    finish();
    await Promise.all([first, second]);
    expect(frames.pending).toBe(false);
    await frames.ensureExtracted();
    expect(calls).toBe(1);
  });

  it("rejects every caller when the extraction fails and stays pending", async () => {
    const frames = createDeferredPassthroughFrames(true, async () => {
      throw new Error("ffmpeg died");
    });
    await expect(frames.ensureExtracted()).rejects.toThrow("ffmpeg died");
    await expect(frames.ensureExtracted()).rejects.toThrow("ffmpeg died");
    expect(frames.pending).toBe(true);
  });
});

/** Records the order the orchestrator's callbacks run in. */
function harness(outcome: HdrPassthroughOutcome | "throws" | "off", deferred: boolean) {
  const events: string[] = [];
  const frames = createDeferredPassthroughFrames(deferred, async () => {
    events.push("extract");
  });
  const attempt =
    outcome === "off"
      ? undefined
      : async (): Promise<HdrPassthroughOutcome> => {
          events.push("attempt");
          if (outcome === "throws") throw new Error("aborted");
          return outcome;
        };
  const run = () =>
    captureHdrWithPassthrough({
      attempt,
      frames,
      onFallback: () => events.push("reset"),
      layered: async () => {
        events.push("layered");
        return result("layered");
      },
    });
  return { events, frames, run };
}

describe("captureHdrWithPassthrough", () => {
  it("completed passthrough: the deferred frames are never extracted", async () => {
    const { events, frames, run } = harness(
      { kind: "completed", result: result("passthrough") },
      true,
    );
    const out = await run();
    expect(out.lastBrowserConsole).toEqual(["passthrough"]);
    expect(events).toEqual(["attempt"]);
    expect(frames.pending).toBe(true);
  });

  it("fallback after the skip: resets progress, extracts, then runs the layered stage", async () => {
    const { events, frames, run } = harness({ kind: "fallback", reason: "not_full_canvas" }, true);
    const out = await run();
    expect(out.lastBrowserConsole).toEqual(["layered"]);
    expect(events).toEqual(["attempt", "reset", "extract", "layered"]);
    expect(frames.pending).toBe(false);
  });

  it("fallback with nothing deferred runs the layered stage as before", async () => {
    const { events, run } = harness({ kind: "fallback", reason: "error", detail: "x" }, false);
    await run();
    expect(events).toEqual(["attempt", "reset", "layered"]);
  });

  it("flag off: only the layered stage runs", async () => {
    const { events, run } = harness("off", false);
    await run();
    expect(events).toEqual(["layered"]);
  });

  it("an abort from the attempt propagates without extracting or running the layered stage", async () => {
    const { events, run } = harness("throws", true);
    await expect(run()).rejects.toThrow("aborted");
    expect(events).toEqual(["attempt"]);
  });
});
