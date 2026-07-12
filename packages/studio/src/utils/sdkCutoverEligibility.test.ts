import { describe, expect, it } from "vitest";
import type { PatchOperation } from "./sourcePatcher";
import { shouldUseSdkCutover } from "./sdkCutoverEligibility";

const childStyleOp: PatchOperation = {
  type: "inline-style",
  property: "color",
  value: "blue",
  childSelector: ":scope > span",
  childIndex: 0,
};

describe("shouldUseSdkCutover child-scoped operations", () => {
  it("declines child-scoped operations because SDK patch ops target only the parent hfId", () => {
    expect(shouldUseSdkCutover(true, true, "hf-parent", [childStyleOp])).toBe(false);
  });
});
