import { describe, expect, it } from "vitest";
import {
  buildLayoutSampleTimes,
  buildTransitionSampleTimes,
  computeOverflow,
  collapseStaticLayoutIssues,
  limitLayoutIssues,
  mergeSampleTimes,
  summarizeLayoutIssues,
  formatLayoutIssue,
  type LayoutIssue,
} from "./layoutAudit.js";

describe("buildTransitionSampleTimes (#1380)", () => {
  it("samples boundaries plus the midpoint of each segment between them", () => {
    // The #1380 repro: capA fades out 11.33–11.55, capB slams in 11.35–11.69.
    // The collision window 11.35–11.55 only shows both captions half-visible
    // away from the exact boundaries — the midpoints land inside it.
    const result = buildTransitionSampleTimes({
      duration: 20,
      boundaries: [11.33, 11.55, 11.35, 11.69],
    });
    expect(result.times).toEqual([11.33, 11.34, 11.35, 11.45, 11.55, 11.62, 11.69]);
    expect(result.dropped).toBe(0);
  });

  it("drops boundaries outside the composition and dedupes repeats", () => {
    const result = buildTransitionSampleTimes({
      duration: 10,
      boundaries: [2, 2, -1, 10.5, NaN, 4],
    });
    expect(result.times).toEqual([2, 3, 4]);
    expect(result.dropped).toBe(0);
  });

  it("returns an empty list without a valid duration", () => {
    expect(buildTransitionSampleTimes({ duration: 0, boundaries: [1, 2] })).toEqual({
      times: [],
      dropped: 0,
    });
  });

  it("samples every collected boundary when no cap is given", () => {
    const boundaries = Array.from({ length: 200 }, (_, i) => i * 0.05);
    const result = buildTransitionSampleTimes({ duration: 10, boundaries });
    // 200 boundaries + 199 segment midpoints, all distinct after rounding.
    expect(result.times.length).toBe(399);
    expect(result.dropped).toBe(0);
  });

  it("caps only on explicit request, reporting the omitted count and keeping the extremes", () => {
    const boundaries = Array.from({ length: 200 }, (_, i) => i * 0.05);
    const result = buildTransitionSampleTimes({ duration: 10, boundaries, cap: 40 });
    expect(result.times.length).toBeLessThanOrEqual(40);
    expect(result.dropped).toBe(399 - result.times.length);
    expect(result.times[0]).toBe(0);
    expect(result.times[result.times.length - 1]).toBeCloseTo(9.95, 3);
  });

  it("merges with even-spacing samples into one deduplicated ascending list", () => {
    expect(mergeSampleTimes([1, 3, 5], [3, 2.5, 7])).toEqual([1, 2.5, 3, 5, 7]);
  });
});

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
      infoCount: 0,
      issueCount: 3,
    });
  });

  it("tracks info findings separately from warnings and errors", () => {
    expect(summarizeLayoutIssues([issue("canvas_overflow", "info")])).toEqual({
      ok: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
      issueCount: 1,
    });
  });

  it("collapses repeated static issues across sampled timestamps", () => {
    const collapsed = collapseStaticLayoutIssues([
      { ...issue("text_box_overflow", "error"), time: 1 },
      { ...issue("text_box_overflow", "error"), time: 3 },
      { ...issue("text_box_overflow", "error"), time: 5 },
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      time: 1,
      firstSeen: 1,
      lastSeen: 5,
      occurrences: 3,
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

  it("formats collapsed issue time ranges", () => {
    const formatted = formatLayoutIssue({
      ...issue("text_box_overflow", "error"),
      time: 1,
      firstSeen: 1,
      lastSeen: 5,
      occurrences: 3,
    });

    expect(formatted).toContain("t=1-5s (3 samples)");
  });

  it("limits returned issues by severity before truncating", () => {
    const limited = limitLayoutIssues(
      [
        { ...issue("canvas_overflow", "info"), time: 1 },
        { ...issue("text_box_overflow", "error"), time: 2 },
      ],
      1,
    );

    expect(limited).toMatchObject({
      totalIssueCount: 2,
      truncated: true,
      issues: [{ code: "text_box_overflow", severity: "error" }],
    });
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
