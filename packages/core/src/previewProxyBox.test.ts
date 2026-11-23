import { describe, expect, it } from "vitest";
import {
  isHeavyForPreview,
  isPreviewQuality,
  parsePreviewProxyBox,
  quantizePreviewProxyBox,
  scalePreviewProxyBox,
  type PreviewSourceFacts,
} from "./previewProxyBox";

describe("preview proxy box", () => {
  it("rounds each side up to the next rung", () => {
    expect(quantizePreviewProxyBox(1080, 1920)).toEqual({ width: 1218, height: 2048 });
    expect(quantizePreviewProxyBox(1, 256)).toEqual({ width: 256, height: 256 });
  });

  it("keeps a 1080p stage's box within a fifth of the stage on each side", () => {
    expect(quantizePreviewProxyBox(1920, 1080)).toEqual({ width: 2048, height: 1218 });
    for (let side = 256; side <= 8192; side += 7) {
      const box = quantizePreviewProxyBox(side, side)!;
      expect(box.width).toBeGreaterThanOrEqual(side);
      expect(box.width / side).toBeLessThan(1.2);
    }
  });

  it("has no bound for an empty box or one past the largest rung", () => {
    expect(quantizePreviewProxyBox(0, 1920)).toBeNull();
    expect(quantizePreviewProxyBox(8193, 100)).toBeNull();
  });

  it("reads back only rungs", () => {
    expect(parsePreviewProxyBox("1448x2048")).toEqual({ width: 1448, height: 2048 });
    expect(parsePreviewProxyBox("1449x2048")).toBeNull();
    expect(parsePreviewProxyBox("1448x2048x1")).toBeNull();
    expect(parsePreviewProxyBox("")).toBeNull();
  });
});

describe("lighter copies of files Chrome can play", () => {
  const full: PreviewSourceFacts = { width: 1920, height: 1080, bitDepth: 8, bitrate: 10_000_000 };
  const box = { width: 1218, height: 724 };
  const shown = { width: 1448, height: 862 };

  it("multiplies the shown box by the level, on the ladder", () => {
    expect(scalePreviewProxyBox(box, 1)).toEqual(box);
    expect(scalePreviewProxyBox(box, 0.5)).toEqual({ width: 724, height: 362 });
    expect(scalePreviewProxyBox(box, 0.125)).toEqual({ width: 256, height: 256 });
  });

  it("calls a file heavy for a much larger source, 10-bit or deeper, or 40 Mbit/s and up", () => {
    expect(isHeavyForPreview(full, shown)).toBe(false);
    expect(isHeavyForPreview({ ...full, width: 3840, height: 2160 }, shown)).toBe(true);
    expect(isHeavyForPreview({ ...full, bitDepth: 10 }, shown)).toBe(true);
    expect(isHeavyForPreview({ ...full, bitrate: 39_999_999 }, shown)).toBe(false);
    expect(isHeavyForPreview({ ...full, bitrate: 40_000_000 }, shown)).toBe(true);
  });

  it("calls a source heavy when the copy box has half its pixels or fewer", () => {
    const half = { width: 1448, height: 724 };
    expect(isHeavyForPreview({ ...full, width: 2896, height: 1448 }, half)).toBe(true);
    expect(isHeavyForPreview({ ...full, width: 1448, height: 1000 }, half)).toBe(false);
  });

  it("knows the four levels and nothing else", () => {
    expect([1, 0.5, 0.25, 0.125].every(isPreviewQuality)).toBe(true);
    expect([0, 0.75, 2, "1", null].some(isPreviewQuality)).toBe(false);
  });
});
