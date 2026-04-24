import { describe, expect, it } from "vitest";
import {
  buildLayoutSampleTimes,
  computeOverflow,
  summarizeLayoutIssues,
  formatLayoutIssue,
  type LayoutIssue,
} from "./layoutAudit.js";

describe("layoutAudit helpers", () => {
  it("samples the whole duration using stable midpoint timestamps", () => {
    expect(buildLayoutSampleTimes({ duration: 10, samples: 5 })).toEqual([1, 3, 5, 7, 9]);
  });

  it("prefers explicit timestamps and keeps them inside the composition duration", () => {
    expect(buildLayoutSampleTimes({ duration: 10, samples: 5, at: [0, 2.5, 12, -1, NaN] })).toEqual(
      [0, 2.5],
    );
  });

  it("computes per-side overflow beyond a tolerance", () => {
    const overflow = computeOverflow(
      { left: 88, top: 102, right: 231, bottom: 181, width: 143, height: 79 },
      { left: 100, top: 100, right: 220, bottom: 180, width: 120, height: 80 },
      2,
    );

    expect(overflow).toEqual({ left: 12, right: 11 });
  });

  it("returns no overflow when the subject only exceeds the box within tolerance", () => {
    const overflow = computeOverflow(
      { left: 99, top: 100, right: 221, bottom: 180, width: 122, height: 80 },
      { left: 100, top: 100, right: 220, bottom: 180, width: 120, height: 80 },
      2,
    );

    expect(overflow).toBeNull();
  });

  it("summarizes errors and warnings separately", () => {
    const issues: LayoutIssue[] = [
      issue("text_box_overflow", "error"),
      issue("canvas_overflow", "warning"),
      issue("clipped_text", "error"),
    ];

    expect(summarizeLayoutIssues(issues)).toEqual({
      ok: false,
      errorCount: 2,
      warningCount: 1,
      issueCount: 3,
    });
  });

  it("formats issues with timestamp, selector, container, and fix hint", () => {
    const formatted = formatLayoutIssue({
      ...issue("text_box_overflow", "error"),
      time: 3.25,
      selector: "#headline",
      containerSelector: ".bubble",
      text: "Quarterly plan",
      overflow: { right: 18, bottom: 7 },
      fixHint: "Increase container padding or reduce font-size.",
    });

    expect(formatted).toContain("t=3.25s");
    expect(formatted).toContain("#headline");
    expect(formatted).toContain("inside .bubble");
    expect(formatted).toContain("right 18px, bottom 7px");
    expect(formatted).toContain("Fix: Increase container padding");
  });
});

function issue(code: LayoutIssue["code"], severity: LayoutIssue["severity"]): LayoutIssue {
  return {
    code,
    severity,
    time: 1,
    selector: ".label",
    message: "Layout issue",
    rect: { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 },
    overflow: { right: 8 },
    fixHint: "Adjust layout.",
  };
}
