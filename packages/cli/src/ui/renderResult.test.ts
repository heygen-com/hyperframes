import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferenceBackground } from "@hyperframes/producer";
import type { PageMotionBlurSummary } from "@hyperframes/engine";
import { MOTION_BLUR_FINGERPRINT_FIELDS } from "@hyperframes/core";
import { renderMachineResult } from "./renderResult.js";

const originalIsTTY = process.stdout.isTTY;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

function capture(run: () => void, terminal = false): string {
  Object.defineProperty(process.stdout, "isTTY", { value: terminal, configurable: true });
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  run();
  return output;
}

function parse(line: string): unknown {
  return JSON.parse(line.slice("@hf-result ".length));
}

describe("renderMachineResult", () => {
  it.each<ReferenceBackground>([
    { kind: "solid", rgb: [12, 34, 56] },
    { kind: "none" },
    { kind: "unsupported_non_solid" },
    { kind: "unknown" },
  ])("writes one versioned line carrying reference background %j", (reference) => {
    const line = capture(() => renderMachineResult({ reference_background: reference }, false));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().split("\n")).toHaveLength(1);
    expect(line.startsWith("@hf-result ")).toBe(true);
    expect(parse(line)).toEqual({
      version: 1,
      operation: "render",
      reference_background: reference,
    });
  });

  it("re-projects a malformed value to unknown at the final writer", () => {
    const line = capture(() =>
      renderMachineResult(
        { reference_background: { kind: "solid", rgb: [999, 0, 0], path: "/private/x" } } as never,
        false,
      ),
    );
    expect(parse(line)).toEqual({
      version: 1,
      operation: "render",
      reference_background: { kind: "unknown" },
    });
    expect(line).not.toContain("/private/x");
  });

  it("stays silent when the render measured nothing", () => {
    expect(capture(() => renderMachineResult({}, false))).toBe("");
  });

  it("stays silent for quiet mode, a terminal, or a container attached to a terminal", () => {
    const result = { reference_background: { kind: "none" } } as const;
    expect(capture(() => renderMachineResult(result, true))).toBe("");
    expect(capture(() => renderMachineResult(result, false), true)).toBe("");
    vi.stubEnv("HYPERFRAMES_STDOUT_IS_TTY", "1");
    expect(capture(() => renderMachineResult(result, false))).toBe("");
  });

  describe("motion blur summary", () => {
    const summary = (over: Partial<PageMotionBlurSummary> = {}): PageMotionBlurSummary => ({
      tier: "filter",
      reasonCode: "accelerated-canvas",
      movers: 4,
      failedFrames: 2,
      readEvents: true,
      fingerprint: {
        ...Object.fromEntries(MOTION_BLUR_FINGERPRINT_FIELDS.map((field) => [field, 0])),
        canvas2d: 3,
        threeD: 1,
      } as NonNullable<PageMotionBlurSummary["fingerprint"]>,
      ...over,
    });

    it("carries tier, movers, failed frames and all fingerprint counts next to the background", () => {
      const line = capture(() =>
        renderMachineResult(
          { reference_background: { kind: "none" }, motionBlur: summary() },
          false,
        ),
      );
      const parsed = parse(line) as { motion_blur: { fingerprint: Record<string, number> } };
      expect(parsed).toEqual({
        version: 1,
        operation: "render",
        reference_background: { kind: "none" },
        motion_blur: {
          tier: "filter",
          movers: 4,
          failed_frames: 2,
          fingerprint: expect.objectContaining({ canvas2d: 3, three_d: 1, svg_clip: 0 }),
        },
      });
      expect(Object.keys(parsed.motion_blur.fingerprint)).toHaveLength(14);
    });

    it("omits motion_blur when the render has no summary", () => {
      const line = capture(() =>
        renderMachineResult({ reference_background: { kind: "none" } }, false),
      );
      expect(parse(line)).toEqual({
        version: 1,
        operation: "render",
        reference_background: { kind: "none" },
      });
    });

    it("prints a line for a summary alone, without inventing a background", () => {
      const line = capture(() => renderMachineResult({ motionBlur: summary() }, false));
      const parsed = parse(line) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("reference_background");
      expect(parsed).toHaveProperty("motion_blur");
    });

    it("omits tier and fingerprint when the summary has none", () => {
      const line = capture(() =>
        renderMachineResult(
          { motionBlur: summary({ tier: null, fingerprint: null, movers: 0, failedFrames: 0 }) },
          false,
        ),
      );
      expect(parse(line)).toEqual({
        version: 1,
        operation: "render",
        motion_blur: { movers: 0, failed_frames: 0 },
      });
    });

    it("never prints free text, whatever the summary carries", () => {
      const line = capture(() =>
        renderMachineResult(
          {
            motionBlur: summary({
              reasonCode: "/private/clip.mp4 #secret-selector",
              tier: "/private/tier" as never,
              movers: "/private/movers" as never,
            }),
          },
          false,
        ),
      );
      expect(line).not.toContain("/private");
      expect(line).not.toContain("secret");
      expect(line).not.toContain("reason");
      expect(line).not.toContain("accelerated-canvas");
      expect(parse(line)).toMatchObject({ motion_blur: { movers: 0 } });
    });

    it("stays silent for quiet mode and a terminal even with a summary", () => {
      expect(capture(() => renderMachineResult({ motionBlur: summary() }, true))).toBe("");
      expect(capture(() => renderMachineResult({ motionBlur: summary() }, false), true)).toBe("");
    });
  });
});
