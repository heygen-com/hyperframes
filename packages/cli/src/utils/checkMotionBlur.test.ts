import { describe, expect, it } from "vitest";
import {
  type MotionBlurProbe,
  dropMotionBlurConsoleEcho,
  motionBlurDrafts,
} from "./checkMotionBlur.js";

const off = (reasonCode: string | null, reason = "because"): MotionBlurProbe => ({
  state: "off",
  tier: null,
  reason,
  reasonCode,
  movers: 0,
});

describe("motionBlurDrafts", () => {
  it("says nothing without an opt-in to read, or when blur works", () => {
    expect(motionBlurDrafts(null)).toEqual([]);
    expect(
      motionBlurDrafts({ state: "on", tier: "capture", reason: null, reasonCode: null, movers: 2 }),
    ).toEqual([]);
    expect(
      motionBlurDrafts({ state: "on", tier: "capture", reason: null, reasonCode: null, movers: 1 }),
    ).toEqual([]);
  });

  it.each([
    [
      "accelerated-canvas",
      /in sub-compositions too.*render that effect separately.*drop data-motion-blur/,
    ],
    ["backface-visibility", /mirrored.*3D flip/],
    ["iframe-in-root", /<iframe>, <object>, <embed> or custom element out of the composition root/],
    ["root-transform", /child element instead of the composition root/],
    ["root-opacity", /child element instead of the composition root/],
    ["root-blend-mode", /mix-blend-mode on a child element/],
    ["nested-capture-canvas", /inner <canvas layoutsubtree>/],
    ["something-new", /drop data-motion-blur/],
  ])("warns with a concrete fix for %s", (code, hint) => {
    const [finding, ...rest] = motionBlurDrafts(off(code, "the reason text"));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      code: "motion_blur_off",
      severity: "warning",
      message: 'data-motion-blur="on" is set but blur is off: the reason text',
    });
    expect(finding?.fixHint).toMatch(hint);
  });

  it("informs, with the reason and a way back to capture, when the filter fallback draws it", () => {
    const filter = (reasonCode: string, movers = 2): MotionBlurProbe => ({
      state: "on",
      tier: "filter",
      reason: "a WebGL canvas is in the page",
      reasonCode,
      movers,
    });
    const [finding, ...rest] = motionBlurDrafts(filter("accelerated-canvas"));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      code: "motion_blur_filter_fallback",
      severity: "info",
      message: expect.stringContaining("a WebGL canvas is in the page"),
      fixHint: expect.stringContaining("only softens zoom and rotation"),
    });
    expect(finding?.fixHint).toContain("render that effect separately");
    expect(motionBlurDrafts(filter("accelerated-canvas", 0))[0]?.code).toBe(
      "motion_blur_no_movers",
    );
    expect(motionBlurDrafts(filter("translation-only"))).toEqual([]);
    expect(motionBlurDrafts(filter("tier-attribute"))).toEqual([]);
  });

  it("only informs, once, when the browser cannot run html-in-canvas", () => {
    const drafts = motionBlurDrafts(off("unsupported-browser", "html-in-canvas is unavailable"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ code: "motion_blur_unverified", severity: "info" });
    expect(drafts[0]?.message).toContain("drawn with the filter fallback");
  });

  it("informs when blur is on but nothing moves", () => {
    expect(
      motionBlurDrafts({ state: "on", tier: "capture", reason: null, reasonCode: null, movers: 0 }),
    ).toMatchObject([
      {
        code: "motion_blur_no_movers",
        severity: "info",
        fixHint: expect.stringContaining("data-motion-blur-events"),
      },
    ]);
  });
});

describe("dropMotionBlurConsoleEcho", () => {
  const echo = { code: "console_warning", message: "[motion-blur] off: because" };
  const other = { code: "console_warning", message: "something else" };
  const found = motionBlurDrafts(off("root-transform"));

  it("drops the runtime's own off-line once a finding says it", () => {
    expect(dropMotionBlurConsoleEcho([echo, other], found)).toEqual([other]);
  });

  it("leaves every console warning alone when there is no finding", () => {
    expect(dropMotionBlurConsoleEcho([echo, other], [])).toEqual([echo, other]);
  });
});
