import { describe, expect, it } from "vitest";
import { arcPathFromMotionPathValue } from "./gsapRuntimeKeyframes";

describe("arcPathFromMotionPathValue", () => {
  it("builds arc config from object form { path, curviness }", () => {
    const arc = arcPathFromMotionPathValue({
      path: [
        { x: 0, y: 0 },
        { x: 100, y: -50 },
        { x: 200, y: 0 },
        { x: 300, y: 80 },
      ],
      curviness: 2,
    });
    expect(arc?.enabled).toBe(true);
    expect(arc?.segments).toHaveLength(3); // 4 waypoints → 3 segments
    expect(arc?.segments.every((s) => s.curviness === 2)).toBe(true);
  });

  it("builds arc config from bare array form (default curviness 1)", () => {
    const arc = arcPathFromMotionPathValue([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(arc?.enabled).toBe(true);
    expect(arc?.segments).toHaveLength(1);
    expect(arc?.segments[0]!.curviness).toBe(1);
  });

  it("carries autoRotate", () => {
    const arc = arcPathFromMotionPathValue({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      autoRotate: true,
    });
    expect(arc?.autoRotate).toBe(true);
  });

  it("returns undefined for fewer than 2 points, missing path, or string path", () => {
    expect(arcPathFromMotionPathValue({ path: [{ x: 0, y: 0 }] })).toBeUndefined();
    expect(arcPathFromMotionPathValue({ curviness: 2 })).toBeUndefined();
    expect(arcPathFromMotionPathValue({ path: "M0 0 L10 10" })).toBeUndefined();
    expect(arcPathFromMotionPathValue(null)).toBeUndefined();
  });
});
