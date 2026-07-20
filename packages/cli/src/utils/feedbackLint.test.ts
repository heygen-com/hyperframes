import { describe, expect, it } from "vitest";

import {
  COMPOSITION_STRUCTURE_RATING_CEILING,
  VISUAL_DEFECT_KEYWORDS,
  lintFeedbackComment,
  mentionsVisualDefect,
} from "./feedbackLint.js";

describe("lintFeedbackComment", () => {
  it("returns no warnings for a perfect rating regardless of comment", () => {
    expect(lintFeedbackComment({ rating: 10, comment: "black frame at 0.5s, no REPRO" })).toEqual(
      [],
    );
  });

  it("returns no warnings when the comment is missing or blank", () => {
    expect(lintFeedbackComment({ rating: 6, comment: undefined })).toEqual([]);
    expect(lintFeedbackComment({ rating: 6, comment: "" })).toEqual([]);
    expect(lintFeedbackComment({ rating: 6, comment: "   \n  " })).toEqual([]);
  });

  it("warns on non-10 comments missing REPRO COMMAND:", () => {
    const warnings = lintFeedbackComment({
      rating: 6,
      comment: "fast but crashed after a bit",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("missing-repro-command");
    expect(warnings[0]?.message).toContain("REPRO COMMAND:");
  });

  it("stays silent when the reporter already included a REPRO COMMAND: block", () => {
    const warnings = lintFeedbackComment({
      rating: 4,
      comment: [
        "cloudrun submission kept timing out.",
        "REPRO COMMAND: cd project && npx hyperframes cloudrun submit",
        "EXPECTED / ACTUAL: uploads / hangs at seek",
      ].join("\n"),
    });
    expect(warnings).toEqual([]);
  });

  it("warns on rating<=7 visual-defect comments missing COMPOSITION_STRUCTURE:", () => {
    const warnings = lintFeedbackComment({
      rating: 5,
      comment: [
        "REPRO COMMAND: cd proj && npx hyperframes render",
        "EXPECTED / ACTUAL: output correct / black frame at 0.5s",
      ].join("\n"),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("missing-composition-structure");
    expect(warnings[0]?.message).toContain("COMPOSITION_STRUCTURE:");
    expect(warnings[0]?.message).toContain("buildCompositionCensus");
  });

  it("skips the composition-structure warning above the rating ceiling", () => {
    const warnings = lintFeedbackComment({
      rating: COMPOSITION_STRUCTURE_RATING_CEILING + 1,
      comment: [
        "REPRO COMMAND: cd proj && npx hyperframes render",
        "minor black bar on the right edge; workaround with --resolution landscape",
      ].join("\n"),
    });
    // Missing structure warning is suppressed at rating 8+.
    expect(warnings.filter((w) => w.code === "missing-composition-structure")).toEqual([]);
  });

  it("skips the composition-structure warning when no visual-defect keyword is present", () => {
    const warnings = lintFeedbackComment({
      rating: 4,
      comment: [
        "docker mode always fails on Alpine",
        "REPRO COMMAND: docker run ... && npx hyperframes doctor --docker",
      ].join("\n"),
    });
    expect(warnings.filter((w) => w.code === "missing-composition-structure")).toEqual([]);
  });

  it("emits both warnings when a low-rating visual comment lacks both markers", () => {
    const warnings = lintFeedbackComment({
      rating: 3,
      comment: "flicker at every scene boundary",
    });
    expect(new Set(warnings.map((w) => w.code))).toEqual(
      new Set(["missing-repro-command", "missing-composition-structure"]),
    );
  });
});

describe("mentionsVisualDefect", () => {
  it.each(VISUAL_DEFECT_KEYWORDS.map((kw) => kw as string))(
    "matches keyword %j case-insensitively",
    (kw) => {
      expect(mentionsVisualDefect(`Reports a ${kw.toUpperCase()} issue`)).toBe(true);
    },
  );

  it("returns false for comments about non-visual friction", () => {
    expect(mentionsVisualDefect("cli hangs on init prompt in non-TTY shells")).toBe(false);
    expect(mentionsVisualDefect("cloudrun deploy expired auth token")).toBe(false);
  });

  it("does not match on partial-word false positives (word boundary)", () => {
    // The classic false positives Rames flagged in review.
    expect(mentionsVisualDefect("scribbled on the blackboard")).toBe(false);
    expect(mentionsVisualDefect("added to blacklist yesterday")).toBe(false);
    expect(mentionsVisualDefect("brought a blanket to the office")).toBe(false);
    expect(mentionsVisualDefect("let me visualize the graph")).toBe(false);
    expect(mentionsVisualDefect("that's a corruptible pointer")).toBe(false);
  });

  it("does not fire on `render` — CLI's primary command, too noisy", () => {
    // `hyperframes render` is the CLI's core command; comments like
    // "render OOMed at 118s" are build/perf issues, not visual defects.
    expect(mentionsVisualDefect("render OOMed at 118s")).toBe(false);
    expect(mentionsVisualDefect("render hung on Alpine")).toBe(false);
    expect(mentionsVisualDefect("preview render command took forever")).toBe(false);
  });

  it("still matches the real defect words in prose", () => {
    expect(mentionsVisualDefect("output is a black frame at 0.5s")).toBe(true);
    expect(mentionsVisualDefect("the whole sequence flickers hard")).toBe(false); // "flickers" (plural) — accepted false-neg
    expect(mentionsVisualDefect("the whole sequence has a flicker at 2s")).toBe(true);
    expect(mentionsVisualDefect("wrong frame at t=0.3")).toBe(true);
  });
});

describe("marker-check case-insensitivity", () => {
  it("does not warn when the reporter uses lowercase `Repro command:`", () => {
    // Case asymmetry fix (C5): marker checks match `mentionsVisualDefect`'s
    // case-normalization, so compliance in any case is honored.
    const warnings = lintFeedbackComment({
      rating: 5,
      comment: [
        "cloudrun submission kept timing out.",
        "Repro command: cd project && npx hyperframes cloudrun submit",
      ].join("\n"),
    });
    expect(warnings.filter((w) => w.code === "missing-repro-command")).toEqual([]);
  });

  it("does not double-warn when reporter uses lowercase `composition_structure:`", () => {
    const warnings = lintFeedbackComment({
      rating: 4,
      comment: [
        "REPRO COMMAND: cd proj && npx hyperframes render",
        "composition_structure:",
        "  elements: video=1 audio=0 img=0 svg=0 canvas=0 subComps=0",
        "black frame at 0.5s",
      ].join("\n"),
    });
    expect(warnings.filter((w) => w.code === "missing-composition-structure")).toEqual([]);
  });
});
