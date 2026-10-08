import { describe, expect, it } from "vitest";
import { parsePreviewProxyBox, quantizePreviewProxyBox } from "./previewProxyBox";

describe("preview proxy box", () => {
  it("rounds each side up to the next rung", () => {
    expect(quantizePreviewProxyBox(1080, 1920)).toEqual({ width: 1448, height: 2048 });
    expect(quantizePreviewProxyBox(1, 256)).toEqual({ width: 256, height: 256 });
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
