import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateGoldenDiff,
  goldenBaselinePath,
  goldenTimeFileName,
  listGoldenBaselineTimesMs,
  parseGoldenManifest,
  parseGoldenTimeFileName,
  readGoldenManifest,
  resolveGoldenConfig,
  resolveGoldenSampleTimes,
  timeMsFromSeconds,
} from "./baseline.js";
import type { PixelDiffResult } from "./pixelDiff.js";

function diffResult(overrides: Partial<PixelDiffResult>): PixelDiffResult {
  return {
    width: 4,
    height: 4,
    totalPixels: 16,
    diffPixels: 0,
    aaPixels: 0,
    diffRatio: 0,
    maxDelta: 0,
    dimensionMismatch: false,
    diff: new Uint8Array(64),
    ...overrides,
  };
}

describe("golden path conventions", () => {
  it("encodes sample times as millisecond PNG filenames", () => {
    expect(timeMsFromSeconds(1.5)).toBe(1500);
    expect(timeMsFromSeconds(0)).toBe(0);
    expect(timeMsFromSeconds(2.0004)).toBe(2000);
    expect(goldenTimeFileName(1500)).toBe("1500.png");
    expect(goldenBaselinePath("/proj", "intro", 1500)).toBe(
      join("/proj", "golden", "intro", "1500.png"),
    );
  });

  it("parses only bare <timeMs>.png names back into times", () => {
    expect(parseGoldenTimeFileName("1500.png")).toBe(1500);
    expect(parseGoldenTimeFileName("0.png")).toBe(0);
    expect(parseGoldenTimeFileName("golden.json")).toBeNull();
    expect(parseGoldenTimeFileName("1500-diff.png")).toBeNull();
    expect(parseGoldenTimeFileName("1.5.png")).toBeNull();
    expect(parseGoldenTimeFileName("1500.PNG")).toBeNull();
  });
});

describe("parseGoldenManifest", () => {
  it("accepts a fully populated manifest", () => {
    const manifest = parseGoldenManifest(
      JSON.stringify({
        times: [0, 1.5, 3],
        threshold: 0.05,
        maxDiffRatio: 0.001,
        ignoreAntialiasing: false,
      }),
      "golden.json",
    );
    expect(manifest).toEqual({
      times: [0, 1.5, 3],
      threshold: 0.05,
      maxDiffRatio: 0.001,
      ignoreAntialiasing: false,
    });
  });

  it("accepts an empty object and ignores unknown fields", () => {
    expect(parseGoldenManifest("{}", "golden.json")).toEqual({});
    expect(parseGoldenManifest('{"note":"hi"}', "golden.json")).toEqual({});
  });

  it("rejects malformed input with the offending field named", () => {
    expect(() => parseGoldenManifest("not json", "golden.json")).toThrow(/not valid JSON/);
    expect(() => parseGoldenManifest("[1,2]", "golden.json")).toThrow(/JSON object/);
    expect(() => parseGoldenManifest('{"times":[]}', "golden.json")).toThrow(/"times"/);
    expect(() => parseGoldenManifest('{"times":[-1]}', "golden.json")).toThrow(/"times"/);
    expect(() => parseGoldenManifest('{"times":["a"]}', "golden.json")).toThrow(/"times"/);
    expect(() => parseGoldenManifest('{"threshold":2}', "golden.json")).toThrow(/"threshold"/);
    expect(() => parseGoldenManifest('{"maxDiffRatio":-0.1}', "golden.json")).toThrow(
      /"maxDiffRatio"/,
    );
    expect(() => parseGoldenManifest('{"ignoreAntialiasing":"yes"}', "golden.json")).toThrow(
      /"ignoreAntialiasing"/,
    );
  });
});

describe("golden directory scanning", () => {
  it("lists baseline times from filenames and reads the manifest beside them", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-golden-test-"));
    try {
      const compDir = join(dir, "golden", "intro");
      mkdirSync(compDir, { recursive: true });
      writeFileSync(join(compDir, "1500.png"), "png");
      writeFileSync(join(compDir, "0.png"), "png");
      writeFileSync(join(compDir, "notes.txt"), "ignore me");
      writeFileSync(join(compDir, "golden.json"), JSON.stringify({ times: [0, 1.5] }));

      expect(listGoldenBaselineTimesMs(dir, "intro")).toEqual([0, 1500]);
      expect(readGoldenManifest(dir, "intro")).toEqual({ times: [0, 1.5] });
      expect(listGoldenBaselineTimesMs(dir, "missing")).toEqual([]);
      expect(readGoldenManifest(dir, "missing")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveGoldenSampleTimes", () => {
  it("prefers the explicit override, then the manifest, then baseline filenames", () => {
    const input = {
      atOverride: [1, 2],
      manifestTimes: [3, 4],
      baselineTimesMs: [5000, 6000],
      duration: 10,
    };
    expect(resolveGoldenSampleTimes(input)).toEqual([1, 2]);
    expect(resolveGoldenSampleTimes({ ...input, atOverride: undefined })).toEqual([3, 4]);
    expect(
      resolveGoldenSampleTimes({ ...input, atOverride: undefined, manifestTimes: undefined }),
    ).toEqual([5, 6]);
  });

  it("falls back to the snapshot command's default spread with a readable tail", () => {
    const times = resolveGoldenSampleTimes({ duration: 10 });
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    // The final sample backs off the exact duration so it is not a blank frame.
    expect(times[4]).toBeLessThan(10);
    expect(times[4]).toBeGreaterThan(9);
  });

  it("throws when no duration and no times are available", () => {
    expect(() => resolveGoldenSampleTimes({ duration: 0 })).toThrow(/duration/);
  });
});

describe("resolveGoldenConfig", () => {
  it("applies defaults, manifest values, and CLI overrides in that order", () => {
    expect(resolveGoldenConfig(null)).toEqual({
      threshold: 0.1,
      maxDiffRatio: 0,
      ignoreAntialiasing: true,
    });
    expect(
      resolveGoldenConfig({ threshold: 0.02, maxDiffRatio: 0.005, ignoreAntialiasing: false }),
    ).toEqual({ threshold: 0.02, maxDiffRatio: 0.005, ignoreAntialiasing: false });
    expect(resolveGoldenConfig({ threshold: 0.02 }, { threshold: 0.3 }).threshold).toBe(0.3);
  });
});

describe("evaluateGoldenDiff", () => {
  it("fails on dimension changes regardless of ratio budget", () => {
    expect(evaluateGoldenDiff(diffResult({ dimensionMismatch: true }), 1)).toBe(
      "dimension-mismatch",
    );
  });

  it("passes at or under the allowed diff ratio and fails above it", () => {
    expect(evaluateGoldenDiff(diffResult({ diffRatio: 0 }), 0)).toBe("pass");
    expect(evaluateGoldenDiff(diffResult({ diffRatio: 0.001 }), 0.001)).toBe("pass");
    expect(evaluateGoldenDiff(diffResult({ diffRatio: 0.0011 }), 0.001)).toBe("pixel-diff");
    expect(evaluateGoldenDiff(diffResult({ diffRatio: 0.0001 }), 0)).toBe("pixel-diff");
  });
});
