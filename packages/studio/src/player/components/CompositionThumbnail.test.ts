import { describe, expect, it } from "vitest";
import { buildCompositionThumbnailUrl } from "./CompositionThumbnail";

describe("buildCompositionThumbnailUrl", () => {
  it("includes selector and occurrence index for precise element thumbnails", () => {
    expect(
      buildCompositionThumbnailUrl({
        previewUrl: "/api/projects/demo/preview",
        seekTime: 1,
        duration: 2,
        selector: ".card",
        selectorIndex: 2,
        origin: "http://localhost:3000",
      }),
    ).toBe(
      "http://localhost:3000/api/projects/demo/thumbnail/index.html?t=2.00&v=v2&selector=.card&selectorIndex=2",
    );
  });
});
