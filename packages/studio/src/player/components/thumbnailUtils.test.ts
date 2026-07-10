import { describe, expect, it } from "vitest";
import {
  computeThumbnailStrip,
  resolveMediaPreviewUrl,
  THUMBNAIL_CLIP_HEIGHT,
} from "./thumbnailUtils";

describe("computeThumbnailStrip", () => {
  it("sizes tiles by aspect ratio at the clip height", () => {
    const { frameW } = computeThumbnailStrip(500, 16 / 9);
    expect(frameW).toBe(Math.round(THUMBNAIL_CLIP_HEIGHT * (16 / 9)));
  });

  it("repeats tiles to cover the container width", () => {
    const { frameW, frameCount } = computeThumbnailStrip(500, 1);
    expect(frameW).toBe(THUMBNAIL_CLIP_HEIGHT);
    expect(frameCount).toBe(Math.ceil(500 / THUMBNAIL_CLIP_HEIGHT));
    expect(frameCount * frameW).toBeGreaterThanOrEqual(500);
  });

  it("returns one tile when the container width is unknown", () => {
    expect(computeThumbnailStrip(0, 16 / 9).frameCount).toBe(1);
    expect(computeThumbnailStrip(-10, 16 / 9).frameCount).toBe(1);
  });

  it("falls back to 16:9 for degenerate aspects", () => {
    const expected = Math.round(THUMBNAIL_CLIP_HEIGHT * (16 / 9));
    expect(computeThumbnailStrip(300, 0).frameW).toBe(expected);
    expect(computeThumbnailStrip(300, -2).frameW).toBe(expected);
    expect(computeThumbnailStrip(300, Number.NaN).frameW).toBe(expected);
    expect(computeThumbnailStrip(300, Number.POSITIVE_INFINITY).frameW).toBe(expected);
  });

  it("never returns a zero-width tile (avoids divide-by-zero repeat counts)", () => {
    const { frameW, frameCount } = computeThumbnailStrip(300, 0.001);
    expect(frameW).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(frameCount)).toBe(true);
  });

  it("honors a custom clip height", () => {
    expect(computeThumbnailStrip(300, 2, 40).frameW).toBe(80);
  });
});

describe("resolveMediaPreviewUrl", () => {
  it("routes composition-relative paths through the project preview endpoint", () => {
    expect(resolveMediaPreviewUrl("assets/image.png", "proj-1")).toBe(
      "/api/projects/proj-1/preview/assets/image.png",
    );
  });

  it("passes absolute http(s) URLs through untouched", () => {
    expect(resolveMediaPreviewUrl("http://cdn.example.com/a.mp4", "proj-1")).toBe(
      "http://cdn.example.com/a.mp4",
    );
    expect(resolveMediaPreviewUrl("https://cdn.example.com/a.png", "proj-1")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("percent-encodes spaces in filenames", () => {
    expect(resolveMediaPreviewUrl("assets/my logo.png", "proj-1")).toBe(
      "/api/projects/proj-1/preview/assets/my%20logo.png",
    );
  });

  it("percent-encodes parentheses in filenames", () => {
    expect(resolveMediaPreviewUrl("assets/heygen-symbol-blue-logo (2).svg", "proj-1")).toBe(
      "/api/projects/proj-1/preview/assets/heygen-symbol-blue-logo%20(2).svg",
    );
  });

  it("preserves slashes as path separators while encoding each segment", () => {
    expect(resolveMediaPreviewUrl("sub dir/file (v2).mp4", "proj-2")).toBe(
      "/api/projects/proj-2/preview/sub%20dir/file%20(v2).mp4",
    );
  });

  it("percent-encodes unicode characters in filenames", () => {
    expect(resolveMediaPreviewUrl("assets/café logo.png", "proj-1")).toBe(
      "/api/projects/proj-1/preview/assets/caf%C3%A9%20logo.png",
    );
  });

  it("leaves paths with no special characters unchanged", () => {
    expect(resolveMediaPreviewUrl("assets/logo.svg", "proj-1")).toBe(
      "/api/projects/proj-1/preview/assets/logo.svg",
    );
  });
});
