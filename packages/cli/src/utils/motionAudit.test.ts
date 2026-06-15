import { describe, expect, it } from "vitest";
import {
  collectSamplingTargets,
  evaluateMotion,
  type FrameSample,
  type MotionFrame,
} from "./motionAudit.js";
import type { LayoutIssue } from "./layoutAudit.js";
import type { MotionAssertion } from "./motionSpec.js";

const CANVAS = { width: 1920, height: 1080 };

function expectOne(issues: LayoutIssue[]): LayoutIssue {
  expect(issues).toHaveLength(1);
  const issue = issues[0];
  if (!issue) throw new Error("expected exactly one issue");
  return issue;
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function visible(r = rect(100, 100, 200, 80), opacity = 1): FrameSample {
  return { rect: r, opacity, visible: true };
}

const hidden: FrameSample = { rect: rect(0, 0, 0, 0), opacity: 0, visible: false };

/** Build frames at the given times; `at(time)` supplies per-selector samples + liveness. */
function frames(
  times: number[],
  at: (time: number) => {
    data?: Record<string, FrameSample | null>;
    liveness?: Record<string, string>;
  },
): MotionFrame[] {
  return times.map((time) => {
    const { data = {}, liveness = {} } = at(time);
    return { time, data, liveness: { "*": "x", ...liveness } };
  });
}

describe("appearsBy", () => {
  const assertion: MotionAssertion = { kind: "appearsBy", selector: "#h", bySec: 0.5 };

  it("passes when visible by the deadline", () => {
    const f = frames([0.1, 0.3, 0.6], (t) => ({ data: { "#h": t >= 0.3 ? visible() : hidden } }));
    expect(evaluateMotion(f, [assertion], CANVAS)).toEqual([]);
  });

  it("flags a late entrance with both times", () => {
    const f = frames([0.3, 0.83, 1.2], (t) => ({ data: { "#h": t >= 0.83 ? visible() : hidden } }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_appears_late");
    expect(issue.message).toContain("0.83s");
    expect(issue.message).toContain("0.5s");
  });

  it("flags an element that never reaches visible opacity", () => {
    const f = frames([0.3, 0.6], () => ({
      data: { "#h": { rect: rect(0, 0, 10, 10), opacity: 0.2, visible: true } },
    }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_appears_late");
    expect(issue.message).toContain("never");
  });

  it("flags a selector that matches nothing", () => {
    const f = frames([0.3, 0.6], () => ({ data: { "#h": null } }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_selector_missing");
  });
});

describe("before", () => {
  const assertion: MotionAssertion = { kind: "before", a: "#a", b: "#b" };

  it("passes when a appears before b", () => {
    const f = frames([0.2, 0.4], (t) => ({
      data: { "#a": visible(), "#b": t >= 0.4 ? visible() : hidden },
    }));
    expect(evaluateMotion(f, [assertion], CANVAS)).toEqual([]);
  });

  it("flags reversed order", () => {
    const f = frames([0.2, 0.4], (t) => ({
      data: { "#a": t >= 0.4 ? visible() : hidden, "#b": visible() },
    }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_out_of_order");
  });

  it("treats a simultaneous appearance as out of order (strict before)", () => {
    const f = frames([0.2, 0.4], () => ({ data: { "#a": visible(), "#b": visible() } }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_out_of_order");
  });
});

describe("staysInFrame", () => {
  const assertion: MotionAssertion = { kind: "staysInFrame", selector: ".card" };

  it("passes when the box stays inside the canvas", () => {
    const f = frames([0, 1, 2], () => ({ data: { ".card": visible(rect(100, 100, 200, 80)) } }));
    expect(evaluateMotion(f, [assertion], CANVAS)).toEqual([]);
  });

  it("flags drift past the right edge", () => {
    const f = frames([0, 1, 2], (t) => ({
      data: { ".card": visible(rect(t >= 2 ? 1850 : 100, 100, 200, 80)) },
    }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_off_frame");
    expect(issue.time).toBe(2);
  });

  it("ignores off-canvas position before the element is first visible", () => {
    const f = frames([0, 1], (t) => ({
      data: {
        ".card":
          t < 1
            ? { rect: rect(5000, 0, 100, 100), opacity: 0, visible: false }
            : visible(rect(100, 100, 200, 80)),
      },
    }));
    expect(evaluateMotion(f, [assertion], CANVAS)).toEqual([]);
  });
});

describe("keepsMoving", () => {
  it("passes when the signature changes every frame", () => {
    const assertion: MotionAssertion = { kind: "keepsMoving" };
    const f = frames([0, 1, 2, 3], (t) => ({ liveness: { "*": `sig-${t}` } }));
    expect(evaluateMotion(f, [assertion], CANVAS)).toEqual([]);
  });

  it("flags a static window longer than the threshold", () => {
    const assertion: MotionAssertion = { kind: "keepsMoving", maxStaticSec: 2 };
    // frozen 1s..4s (3s static) then moves
    const f = frames([0, 1, 2, 3, 4, 5], (t) => ({
      liveness: { "*": t >= 1 && t <= 4 ? "frozen" : `m-${t}` },
    }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_frozen");
    expect(issue.time).toBe(1);
  });

  it("scopes liveness to withinSelector", () => {
    const assertion: MotionAssertion = {
      kind: "keepsMoving",
      withinSelector: ".scene",
      maxStaticSec: 1,
    };
    // .scene frozen the whole time, whole-canvas "*" moving — only the scope matters
    const f = frames([0, 1, 2, 3], (t) => ({ liveness: { "*": `m-${t}`, ".scene": "frozen" } }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_frozen");
    expect(issue.selector).toBe(".scene");
  });

  it("flags a missing withinSelector instead of reporting it frozen", () => {
    const assertion: MotionAssertion = { kind: "keepsMoving", withinSelector: ".nope" };
    const f = frames([0, 1, 2], () => ({ liveness: { "*": "moving" } }));
    const issue = expectOne(evaluateMotion(f, [assertion], CANVAS));
    expect(issue.code).toBe("motion_selector_missing");
  });
});

describe("evaluateMotion edge cases", () => {
  it("returns nothing for an empty frame set", () => {
    expect(evaluateMotion([], [{ kind: "appearsBy", selector: "#h", bySec: 1 }], CANVAS)).toEqual(
      [],
    );
  });
});

describe("collectSamplingTargets", () => {
  it("collects selectors and liveness scopes without duplicates", () => {
    const targets = collectSamplingTargets([
      { kind: "appearsBy", selector: "#h", bySec: 0.5 },
      { kind: "before", a: "#h", b: "#cta" },
      { kind: "staysInFrame", selector: ".card" },
      { kind: "keepsMoving", withinSelector: ".scene" },
      { kind: "keepsMoving" },
    ]);
    expect(targets.selectors.sort()).toEqual(["#cta", "#h", ".card"]);
    expect(targets.livenessScopes.sort()).toEqual(["*", ".scene"]);
  });
});
