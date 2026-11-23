import { describe, expect, it } from "vitest";
import { rotateFunction, scaleFunction } from "./elementTransform";

describe("the individual properties as transform functions", () => {
  it("writes each computed rotate form Chrome serializes", () => {
    expect(rotateFunction("45deg")).toBe("rotate(45deg)");
    expect(rotateFunction("x 30deg")).toBe("rotateX(30deg)");
    expect(rotateFunction("1 1 0 30deg")).toBe("rotate3d(1, 1, 0, 30deg)");
    expect(rotateFunction("none")).toBe("");
    expect(rotateFunction(undefined)).toBe("");
  });

  it("writes each computed scale form, a depth scale as scale3d", () => {
    expect(scaleFunction("2")).toBe("scale(2)");
    expect(scaleFunction("2 3")).toBe("scale(2, 3)");
    expect(scaleFunction("1 1 2")).toBe("scale3d(1, 1, 2)");
    expect(scaleFunction("none")).toBe("");
  });
});
