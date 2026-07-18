import { describe, expect, it } from "vitest";
import { defaultThumbnailMode, effectiveThumbnailMode } from "./thumbnailPolicy";

describe("thumbnail runtime policy", () => {
  it("defaults missing preferences adaptively after activation", () => {
    expect(defaultThumbnailMode(undefined, "follow-preference")).toBe("adaptive");
    expect(defaultThumbnailMode(undefined, "legacy-default")).toBe("hidden");
  });

  it("forces the safe renderer without overwriting user intent", () => {
    expect(effectiveThumbnailMode("adaptive", "force-hidden")).toBe("hidden");
    expect(effectiveThumbnailMode("adaptive", "follow-preference")).toBe("adaptive");
  });
});
