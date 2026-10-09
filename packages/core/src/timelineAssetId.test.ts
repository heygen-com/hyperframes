import { describe, expect, it } from "vitest";
import { buildTimelineAssetId, replacementTimelineAssetId } from "./timelineAssetId";

describe("timeline asset ids", () => {
  it("trims a long underscore prefix and suffix", () => {
    const padding = "_".repeat(20000);
    expect(buildTimelineAssetId(`assets/${padding}harbor${padding}.mp4`, [])).toBe("harbor");
  });

  it("mints the fallback when normalization leaves no name", () => {
    expect(buildTimelineAssetId("assets/____.mp4", ["asset", "asset_2"])).toBe("asset_3");
  });

  it("renames a dropped clip whose src is URL-encoded, from the decoded names", () => {
    const document = new DOMParser().parseFromString(
      '<video id="my_clip" src="assets/my%20clip.mp4"></video>',
      "text/html",
    );
    const video = document.querySelector("video")!;
    expect(replacementTimelineAssetId(document, video, "assets/new%20take.mp4")).toBe("new_take");
  });
});
