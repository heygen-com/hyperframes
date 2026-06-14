import { describe, expect, it } from "vitest";
import { shouldUseSdkCutover } from "../utils/sdkCutover";
import type { PatchOperation } from "../utils/sourcePatcher";

const styleOp = (property: string, value: string): PatchOperation => ({
  type: "inline-style",
  property,
  value,
});

const attrOp = (property: string, value: string): PatchOperation => ({
  type: "attribute",
  property,
  value,
});

describe("shouldUseSdkCutover", () => {
  it("returns false when flag is disabled", () => {
    expect(shouldUseSdkCutover(false, true, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no SDK session", () => {
    expect(shouldUseSdkCutover(true, false, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when selection has no hfId", () => {
    expect(shouldUseSdkCutover(true, true, null, [styleOp("color", "red")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, undefined, [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when ops array is empty", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [])).toBe(false);
  });

  it("returns true when all conditions met with supported op types", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red")])).toBe(true);
    expect(
      shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red"), attrOp("data-x", "1")]),
    ).toBe(true);
  });
});
