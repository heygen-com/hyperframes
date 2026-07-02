/**
 * Regression guard for HF#1731 / HF#1730 — pins the 0-based `framePaths`
 * key convention on `rebuildExtractedFramesFromPlanDir`.
 *
 * Why a separate file from `renderChunk.test.ts`: that file's top-level
 * `beforeAll` boots a Chrome smoke probe so the byte-identical-retry
 * assertions can soft-skip on hosts where chrome-headless-shell can't
 * initialize. The probe is a 5-15s tax on the whole module even when no
 * Chrome-dependent test runs. This file is pure-filesystem and stays
 * Chrome-free so the regression check runs in ~10ms on every PR.
 *
 * The bug: the consumer of `framePaths` is
 * `videoFrameExtractor.ts:getFrameAtTime`, which computes
 * `Math.floor(localTime * fps + 1e-9)` (0-based) and reads
 * `framePaths.get(frameIndex)`. The pre-fix code in
 * `rebuildExtractedFramesFromPlanDir` wrote `framePaths.set(i + 1, …)`
 * instead of `framePaths.set(i, …)`, so `framePaths.get(0)` returned
 * `undefined` at every `<video>`'s first-paint frame: the vid silently
 * dropped out of activePayloads, the injector didn't fire, and
 * BeginFrame screenshotted an empty composition (Y≈22 black flash for
 * one frame at each first-paint boundary). Symptom only reproduced in
 * distributed mode — local single-process renders take a different
 * code path (`videoFrameExtractor.ts:317`) that was already 0-based.
 *
 * This test must FAIL against the previous `i + 1` indexing and PASS
 * against the fix. Don't soften it into a "key set has expected size"
 * shape — the bug was specifically that `get(0)` returned undefined,
 * so assert that directly.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildExtractedFramesFromPlanDir } from "./renderChunk.js";
import type { PlanVideosJson } from "./shared.js";

function makeFramesDir(planDir: string, videoId: string, frameNames: string[]): void {
  const outputDir = join(planDir, "video-frames", videoId);
  mkdirSync(outputDir, { recursive: true });
  for (const name of frameNames) {
    // Contents don't matter — the function only lists + sorts the dir
    // and maps names to absolute paths. A single byte keeps the test
    // fast and stays well clear of any filesystem reservation quirks.
    writeFileSync(join(outputDir, name), "x", "utf-8");
  }
}

// The function never reads inside `metadata`, it just forwards it onto
// the returned `ExtractedFrames`. A bare cast spares us the full
// `VideoMetadata` shape per test.
const VIDEO_METADATA_STUB = {} as PlanVideosJson["extracted"][number]["metadata"];

describe("rebuildExtractedFramesFromPlanDir", () => {
  it("indexes framePaths 0-based (regression guard for HF#1731)", () => {
    const planDir = mkdtempSync(join(tmpdir(), "hf-rebuild-frames-0based-"));
    try {
      const videoId = "vid-0";
      // Zero-padded monotonic names — same shape `extractVideoFramesRange`
      // produces (`frame_%05d.jpg`).
      const frameNames = [
        "frame_00001.jpg",
        "frame_00002.jpg",
        "frame_00003.jpg",
        "frame_00004.jpg",
        "frame_00005.jpg",
      ];
      makeFramesDir(planDir, videoId, frameNames);

      const result = rebuildExtractedFramesFromPlanDir(planDir, [
        {
          videoId,
          srcPath: "/does/not/matter.mp4",
          framePattern: "frame_%05d.jpg",
          fps: 30,
          totalFrames: frameNames.length,
          metadata: VIDEO_METADATA_STUB,
        },
      ]);

      expect(result).toHaveLength(1);
      const extracted = result[0]!;
      expect(extracted.framePaths.size).toBe(frameNames.length);

      // The load-bearing assertion. `getFrameAtTime` calls
      // `framePaths.get(0)` for every video's first-paint frame
      // (localTime === 0 → frameIndex === 0). The pre-fix code's `i + 1`
      // indexing meant this returned `undefined` and the vid silently
      // dropped from activePayloads — that's HF#1731.
      const first = extracted.framePaths.get(0);
      expect(first).toBeDefined();
      expect(first).toBe(join(planDir, "video-frames", videoId, "frame_00001.jpg"));

      // Last frame at index N-1 (0-based) must resolve; index N must not.
      // Together with `get(0)` defined this fully pins the 0-based
      // contract — the pre-fix shape would have `get(N)` defined and
      // `get(0)` undefined.
      const last = extracted.framePaths.get(frameNames.length - 1);
      expect(last).toBe(join(planDir, "video-frames", videoId, "frame_00005.jpg"));
      expect(extracted.framePaths.get(frameNames.length)).toBeUndefined();
    } finally {
      rmSync(planDir, { recursive: true, force: true });
    }
  });

  it("preserves 0-based indexing across multiple videos in the same planDir", () => {
    // Multi-video shape — the HF#1731 repro was a back-to-back composition
    // (v1: 0-4s, v2: 4-8s, v3: 8-12s) and EVERY vid's first-paint frame
    // was PRISTINE black. The function must produce the 0-based contract
    // for every video in the manifest, not just the first.
    const planDir = mkdtempSync(join(tmpdir(), "hf-rebuild-frames-multi-"));
    try {
      makeFramesDir(planDir, "vid-a", ["frame_00001.jpg", "frame_00002.jpg"]);
      makeFramesDir(planDir, "vid-b", ["frame_00001.jpg", "frame_00002.jpg", "frame_00003.jpg"]);

      const result = rebuildExtractedFramesFromPlanDir(planDir, [
        {
          videoId: "vid-a",
          srcPath: "/a.mp4",
          framePattern: "frame_%05d.jpg",
          fps: 30,
          totalFrames: 2,
          metadata: VIDEO_METADATA_STUB,
        },
        {
          videoId: "vid-b",
          srcPath: "/b.mp4",
          framePattern: "frame_%05d.jpg",
          fps: 30,
          totalFrames: 3,
          metadata: VIDEO_METADATA_STUB,
        },
      ]);

      expect(result).toHaveLength(2);
      // Every video's `framePaths.get(0)` must resolve — pre-fix, all of
      // them returned undefined and every vid's first-paint dropped.
      expect(result[0]!.framePaths.get(0)).toBe(
        join(planDir, "video-frames", "vid-a", "frame_00001.jpg"),
      );
      expect(result[1]!.framePaths.get(0)).toBe(
        join(planDir, "video-frames", "vid-b", "frame_00001.jpg"),
      );
      // Cleanup ownership flag — chunk workers don't own the planDir's
      // video-frames tree (the controller does); a flip would cause the
      // injector cleanup to rm bytes another worker may still be reading.
      expect(result[0]!.ownedByLookup).toBe(false);
      expect(result[1]!.ownedByLookup).toBe(false);
    } finally {
      rmSync(planDir, { recursive: true, force: true });
    }
  });
});
