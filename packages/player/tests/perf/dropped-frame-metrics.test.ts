import { describe, expect, it } from "vitest";
import { summarizeSceneFrames } from "./dropped-frame-metrics.ts";

describe("summarizeSceneFrames", () => {
  it("keeps missed frame rate and decoder cost separate for each scene", () => {
    const result = summarizeSceneFrames(
      [
        {
          scene: "tile-0",
          durationMs: 1_000,
          expectedFrames: 30,
          presentedFrames: 27,
          decoderMs: [4, 5, 6, 7],
          callbackDelayMs: [1, 2, 3, 4],
        },
        {
          scene: "tile-1",
          durationMs: 1_000,
          expectedFrames: 30,
          presentedFrames: 30,
          decoderMs: [1, 2, 3, 4],
          callbackDelayMs: [0, 1, 1, 2],
        },
      ],
      30,
    );

    expect(result).toEqual([
      {
        scene: "tile-0",
        expectedFps: 30,
        presentedFps: 27,
        missedFps: 3,
        missedPercent: 10,
        decoderP95Ms: 7,
        callbackDelayP95Ms: 4,
        frameBudgetMs: 33.333333333333336,
      },
      {
        scene: "tile-1",
        expectedFps: 30,
        presentedFps: 30,
        missedFps: 0,
        missedPercent: 0,
        decoderP95Ms: 4,
        callbackDelayP95Ms: 2,
        frameBudgetMs: 33.333333333333336,
      },
    ]);
  });

  it("rejects incomplete or impossible measurements instead of hiding them", () => {
    expect(() =>
      summarizeSceneFrames(
        [
          {
            scene: "tile-0",
            durationMs: 0,
            expectedFrames: 30,
            presentedFrames: 31,
            decoderMs: [],
            callbackDelayMs: [],
          },
        ],
        30,
      ),
    ).toThrow("durationMs must be positive");
  });
});
