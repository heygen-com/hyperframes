// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectionCacheKey } from "./domEditOverlayGeometry";

describe("selectionCacheKey — hfId collision (R7)", () => {
  it("produces distinct keys for two elements that differ only by hfId", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-111" } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = selectionCacheKey({ sourceFile: "index.html", hfId: "hf-222" } as any);
    expect(a).not.toBe(b);
  });
});
