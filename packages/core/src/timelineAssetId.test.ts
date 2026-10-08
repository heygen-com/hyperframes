import { describe, expect, it } from "vitest";
import { buildTimelineAssetId } from "./timelineAssetId";

describe("timeline asset ids", () => {
  it("trims a long underscore prefix and suffix", () => {
    const padding = "_".repeat(20000);
    expect(buildTimelineAssetId(`assets/${padding}harbor${padding}.mp4`, [])).toBe("harbor");
  });

  it("mints the fallback when normalization leaves no name", () => {
    expect(buildTimelineAssetId("assets/____.mp4", ["asset", "asset_2"])).toBe("asset_3");
  });
});
