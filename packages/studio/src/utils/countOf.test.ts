import { describe, expect, it } from "vitest";
import { countOf } from "./countOf";

describe("countOf", () => {
  it("names one thing in the singular and two in the plural", () => {
    expect(countOf(1, "clip")).toBe("1 clip");
    expect(countOf(2, "clip")).toBe("2 clips");
    expect(countOf(0, "keyframe")).toBe("0 keyframes");
  });
});
