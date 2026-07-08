import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { compareVideos, type CompareVerdict } from "./compare.ts";

function runFfmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "ffmpeg failed");
  }
}

function makeTestClip(path: string, source: string): void {
  runFfmpeg(["-f", "lavfi", "-i", source, "-pix_fmt", "yuv420p", "-r", "5", "-t", "1", "-y", path]);
}

function finitePsnrValues(verdict: CompareVerdict): number[] {
  return verdict.checkpoints.flatMap((checkpoint) =>
    Number.isFinite(checkpoint.psnr) ? [checkpoint.psnr] : [],
  );
}

describe("GSAP baseline compare", () => {
  it("passes identical videos with no damaged checkpoints or screening flag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-compare-identical-"));
    try {
      const baseline = join(dir, "baseline.mp4");
      makeTestClip(baseline, "testsrc2=size=64x64:rate=5:duration=1");

      const verdict = await compareVideos({
        itemName: "identical-fixture",
        baselineVideo: baseline,
        candidateVideo: baseline,
        checkpointCount: 5,
        fps: 5,
      });

      assert.equal(verdict.verdict, "pass");
      assert.equal(verdict.screening_flag, false);
      assert.equal(verdict.second_baseline.ran, false);
      assert.equal(verdict.damaged_checkpoints.length, 0);
      assert.equal(finitePsnrValues(verdict).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags a synthetically degraded video as damaged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-compare-degraded-"));
    try {
      const baseline = join(dir, "baseline.mp4");
      const candidate = join(dir, "candidate.mp4");
      makeTestClip(baseline, "testsrc2=size=64x64:rate=5:duration=1");
      makeTestClip(candidate, "color=c=black:size=64x64:rate=5:duration=1");

      const verdict = await compareVideos({
        itemName: "degraded-fixture",
        baselineVideo: baseline,
        candidateVideo: candidate,
        checkpointCount: 5,
        fps: 5,
      });

      assert.equal(verdict.verdict, "damaged");
      assert.equal(verdict.damaged_checkpoints.length > 0, true);
      assert.equal(verdict.worst_checkpoints[0]?.psnr < 30, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
