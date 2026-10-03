import { describe, expect, it } from "vitest";
import { evaluateSafeCriticalOverflows, type SafeCriticalSnapshot } from "./checkPipeline.js";

const VERTICAL_FRAMES = JSON.stringify([
  {
    id: "vertical",
    ratio: "9:16",
    x: (1920 - 608) / 2 / 1920,
    y: 0,
    width: 608 / 1920,
    height: 1,
  },
]);

function snapshot(overrides: Partial<SafeCriticalSnapshot> = {}): SafeCriticalSnapshot {
  return {
    time: 1.5,
    compositionWidth: 1920,
    compositionHeight: 1080,
    framesAttr: VERTICAL_FRAMES,
    rootLeft: 0,
    rootTop: 0,
    elements: [],
    ...overrides,
  };
}

describe("evaluateSafeCriticalOverflows", () => {
  it("fails when a visible critical box leaves its required frame", () => {
    const result = evaluateSafeCriticalOverflows(
      snapshot({
        elements: [
          {
            id: "headline",
            selector: "#headline",
            criticalAttr: "",
            hasCritical: true,
            left: 0,
            top: 40,
            width: 400,
            height: 80,
            hidden: false,
          },
        ],
      }),
    );
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("safe_critical_overflow");
    expect(result.issues[0]?.severity).toBe("error");
    expect(result.issues[0]?.message).toMatch(/#headline/);
    expect(result.issues[0]?.message).toMatch(/vertical/);
    expect(result.issues[0]?.message).toMatch(/1\.5s/);
    expect(result.issues[0]?.message).toMatch(/left/);
    expect(result.overflows[0]?.frameId).toBe("vertical");
    expect(result.frames[0]).toMatchObject({ id: "vertical", width: 608, height: 1080 });
  });

  it("passes when the element stays fully inside the frame", () => {
    const result = evaluateSafeCriticalOverflows(
      snapshot({
        elements: [
          {
            id: "headline",
            selector: "#headline",
            criticalAttr: "vertical",
            hasCritical: true,
            left: 700,
            top: 40,
            width: 200,
            height: 80,
            hidden: false,
          },
        ],
      }),
    );
    expect(result.issues).toEqual([]);
    expect(result.overflows).toEqual([]);
  });

  it("skips hidden and off-clip elements", () => {
    const result = evaluateSafeCriticalOverflows(
      snapshot({
        elements: [
          {
            id: "gone",
            selector: "#gone",
            criticalAttr: "",
            hasCritical: true,
            left: 0,
            top: 0,
            width: 400,
            height: 80,
            hidden: true,
          },
          {
            id: "zero",
            selector: "#zero",
            criticalAttr: "",
            hasCritical: true,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            hidden: true,
          },
        ],
      }),
    );
    expect(result.issues).toEqual([]);
  });
});
