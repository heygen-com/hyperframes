import { describe, expect, it } from "vitest";
import { resolveCompositionPreviewScale } from "./CompositionsTab";

describe("resolveCompositionPreviewScale", () => {
  it("scales a 16:9 stage to fit the composition card", () => {
    expect(
      resolveCompositionPreviewScale({
        cardWidth: 80,
        cardHeight: 45,
        stageWidth: 1920,
        stageHeight: 1080,
      }),
    ).toBeCloseTo(80 / 1920);
  });

  it("scales non-16:9 stages against their actual dimensions", () => {
    expect(
      resolveCompositionPreviewScale({
        cardWidth: 80,
        cardHeight: 45,
        stageWidth: 1280,
        stageHeight: 720,
      }),
    ).toBeCloseTo(80 / 1280);
  });

  it("falls back to the default stage when dimensions are invalid", () => {
    expect(
      resolveCompositionPreviewScale({
        cardWidth: 80,
        cardHeight: 45,
        stageWidth: 0,
        stageHeight: Number.NaN,
      }),
    ).toBeCloseTo(80 / 1920);
  });
});
