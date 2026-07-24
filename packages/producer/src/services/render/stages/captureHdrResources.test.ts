import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateHdrExtractionBytes, planHdrResources } from "./captureHdrResources.js";
import type { CompositionMetadata } from "../shared.js";

function videoComposition(src: string): CompositionMetadata {
  return {
    duration: 5,
    width: 1920,
    height: 1080,
    audios: [],
    images: [],
    videos: [{ id: "a-roll", src, start: 0, end: 5, mediaStart: 0, loop: false, hasAudio: false }],
  };
}

describe("planHdrResources non-ASCII src resolution (PRINFRA-349)", () => {
  it("decodes a percent-encoded CJK <video src> back to the real on-disk path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-hdr-cjk-"));
    try {
      const realName = "视频1.mp4";
      writeFileSync(join(projectDir, realName), "x");
      // The compiled DOM carries the URL-encoded attribute value.
      const encoded = encodeURIComponent(realName); // %E8%A7%86%E9%A2%911.mp4
      const prep = planHdrResources({
        composition: videoComposition(encoded),
        nativeHdrVideoIds: new Set(["a-roll"]),
        nativeHdrImageIds: new Set(),
        projectDir,
        compiledDir: projectDir,
      });
      // Must be the decoded filesystem path ffmpeg can open, not the %-encoded string.
      expect(prep.hdrVideoSrcPaths.get("a-roll")).toBe(join(projectDir, realName));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("leaves an ASCII src untouched", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-hdr-ascii-"));
    try {
      writeFileSync(join(projectDir, "clip.mp4"), "x");
      const prep = planHdrResources({
        composition: videoComposition("clip.mp4"),
        nativeHdrVideoIds: new Set(["a-roll"]),
        nativeHdrImageIds: new Set(),
        projectDir,
        compiledDir: projectDir,
      });
      expect(prep.hdrVideoSrcPaths.get("a-roll")).toBe(join(projectDir, "clip.mp4"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("estimateHdrExtractionBytes", () => {
  it("sums 6 bytes per pixel per frame across videos", () => {
    // 10s @ 30fps of 1920x1080 = 300 frames * 1920*1080*6
    expect(
      estimateHdrExtractionBytes([{ durationSeconds: 10, width: 1920, height: 1080 }], 30),
    ).toBe(300 * 1920 * 1080 * 6);
  });

  it("accumulates multiple videos and rounds frame counts up", () => {
    const bytes = estimateHdrExtractionBytes(
      [
        { durationSeconds: 1.5, width: 100, height: 100 },
        { durationSeconds: 0.05, width: 100, height: 100 },
      ],
      30,
    );
    expect(bytes).toBe((45 + 2) * 100 * 100 * 6);
  });

  it("treats negative durations as empty", () => {
    expect(estimateHdrExtractionBytes([{ durationSeconds: -3, width: 100, height: 100 }], 30)).toBe(
      0,
    );
  });
});
