import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeSegmentPlanHash,
  probeSegmentFrameCount,
  readSegmentManifest,
  segmentDirFor,
  validateCompletedSegments,
  writeSegmentManifest,
  type SegmentManifest,
  type SegmentManifestEntry,
  type SegmentPlanHashInput,
} from "./segmentManifest.js";
import { planSegments, segmentOutputPath } from "./segmentPlan.js";

const hashInput: SegmentPlanHashInput = {
  compositionHash: "abc",
  cliVersion: "0.8.50",
  totalFrames: 9000,
  segmentFrames: 3000,
  fps: { num: 30, den: 1 },
  width: 1920,
  height: 1080,
  codec: "h264",
  preset: "ultrafast",
  quality: 28,
  bitrate: undefined,
  pixelFormat: "yuv420p",
  imageFormat: "jpeg",
  useGpu: false,
  outputWidth: 1920,
  outputHeight: 1080,
  motionBlur: "",
  pageMotionBlur: undefined,
  captureQuality: 80,
};

describe("computeSegmentPlanHash", () => {
  it("does not reuse authored-blur segments when page blur is explicitly off", () => {
    expect(computeSegmentPlanHash({ ...hashInput, pageMotionBlur: "off" })).not.toBe(
      computeSegmentPlanHash(hashInput),
    );
  });
  it("is stable and 16 hex chars", () => {
    const a = computeSegmentPlanHash(hashInput);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(computeSegmentPlanHash({ ...hashInput })).toBe(a);
  });

  it("changes when any byte-determining input changes", () => {
    // Every field here changes the encoded bytes, so reusing a segment across
    // a change in any of them would splice two different encodes together.
    const a = computeSegmentPlanHash(hashInput);
    expect(computeSegmentPlanHash({ ...hashInput, segmentFrames: 1500 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, quality: 18 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, compositionHash: "abd" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, cliVersion: "0.8.51" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, totalFrames: 8999 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, fps: { num: 60, den: 1 } })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, width: 1280 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, height: 720 })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, codec: "h265" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, preset: "slow" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, bitrate: "8M" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, pixelFormat: "yuv420p10le" })).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, imageFormat: "png" })).not.toBe(a);
    // Review findings on the Phase 2b PR: three byte-affecting inputs that
    // used to be missing. NVENC and libx264 both report codec "h264"; a DPR
    // change captures at a different pixel size than the composition's; a
    // motion-blur sample count changes every averaged frame.
    expect(computeSegmentPlanHash({ ...hashInput, useGpu: true })).not.toBe(a);
    expect(
      computeSegmentPlanHash({ ...hashInput, outputWidth: 3840, outputHeight: 2160 }),
    ).not.toBe(a);
    expect(computeSegmentPlanHash({ ...hashInput, motionBlur: '{"samplesPerFrame":32}' })).not.toBe(
      a,
    );
    expect(computeSegmentPlanHash({ ...hashInput, captureQuality: 100 })).not.toBe(a);
  });

  it("does not collide across adjacent field boundaries", () => {
    // The fields are joined; without a separator "ab"+"c" and "a"+"bc" would
    // hash identically and resume across a different composition.
    expect(
      computeSegmentPlanHash({ ...hashInput, compositionHash: "ab", cliVersion: "c0.8.50" }),
    ).not.toBe(computeSegmentPlanHash({ ...hashInput, compositionHash: "abc" }));
  });
});

describe("manifest io", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips and returns null when absent or malformed", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    expect(readSegmentManifest(dir)).toBeNull();
    const manifest: SegmentManifest = {
      version: 1,
      planHash: "0123456789abcdef",
      totalFrames: 7,
      segmentFrames: 3,
      completed: [
        {
          index: 0,
          startFrame: 0,
          endFrame: 3,
          path: join(dir, "segment_00000.mp4"),
          bytes: 10,
          completedAt: "2026-09-17T00:00:00.000Z",
        },
      ],
    };
    writeSegmentManifest(dir, manifest);
    expect(readSegmentManifest(dir)).toEqual(manifest);
    writeFileSync(join(dir, "segments.json"), "{not json");
    expect(readSegmentManifest(dir)).toBeNull();
  });

  it("rejects a manifest whose shape is wrong rather than resuming from it", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    writeFileSync(join(dir, "segments.json"), JSON.stringify({ version: 2, completed: [] }));
    expect(readSegmentManifest(dir)).toBeNull();
    writeFileSync(
      join(dir, "segments.json"),
      JSON.stringify({
        version: 1,
        planHash: "h",
        totalFrames: 3,
        segmentFrames: 3,
        completed: [{ index: 0, startFrame: 0 }],
      }),
    );
    expect(readSegmentManifest(dir)).toBeNull();
  });

  it("segmentDirFor nests under renders/.hf-segments", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    expect(segmentDirFor("/p/renders", "abc")).toBe(join("/p/renders", ".hf-segments", "abc"));
  });
});

describe("validateCompletedSegments", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const entry = (index: number, bytes = 2): SegmentManifestEntry => ({
    index,
    startFrame: index * 3,
    endFrame: index * 3 + 3,
    path: segmentOutputPath(dir, index),
    bytes,
    completedAt: "",
  });
  const manifestOf = (
    completed: SegmentManifestEntry[],
    totalFrames = completed.length * 3,
  ): SegmentManifest => ({ version: 1, planHash: "h", totalFrames, segmentFrames: 3, completed });
  const check = (
    totalFrames: number,
    probeFrames: (path: string) => Promise<number | null>,
    expectedHash = "h",
  ) => ({ expectedHash, segmentDir: dir, plan: planSegments(totalFrames, 3), probeFrames });

  it("keeps only segments whose file exists and whose frame count matches", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    const ok = segmentOutputPath(dir, 0);
    const short = segmentOutputPath(dir, 1);
    writeFileSync(ok, "xx");
    writeFileSync(short, "xx");
    const manifest = manifestOf([entry(0), entry(1), entry(2)]);
    const probe = async (p: string) => (p === ok ? 3 : p === short ? 2 : null);
    expect([...(await validateCompletedSegments(manifest, check(9, probe)))]).toEqual([0]);
  });

  it("rejects a segment whose size no longer matches the manifest", async () => {
    // A half-written file from a kill can still exist and still probe; the
    // recorded size is what proves it is the same file that was finished.
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    writeFileSync(segmentOutputPath(dir, 0), "x");
    const manifest = manifestOf([entry(0, 999)]);
    expect(
      (
        await validateCompletedSegments(
          manifest,
          check(3, async () => 3),
        )
      ).size,
    ).toBe(0);
  });

  it("a resume whose segment files were removed after a join captures them again rather than failing", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    // The manifest still lists them, but the join deleted the files.
    const manifest = manifestOf([entry(0), entry(1)]);
    let probed = 0;
    const probe = async () => {
      probed += 1;
      return 3;
    };
    expect((await validateCompletedSegments(manifest, check(6, probe))).size).toBe(0);
    expect(probed).toBe(0);
  });

  it("skips nothing when the plan hash differs", async () => {
    // The entry is otherwise perfectly reusable — present, right size, right
    // frame count — so only the hash check can reject it. With an empty
    // `completed` list this assertion would pass with the check deleted.
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    writeFileSync(segmentOutputPath(dir, 0), "xx");
    const manifest = { ...manifestOf([entry(0)]), planHash: "old" };
    const probe = async () => 3;
    expect((await validateCompletedSegments(manifest, check(3, probe, "old"))).size).toBe(1);
    expect((await validateCompletedSegments(manifest, check(3, probe, "new"))).size).toBe(0);
  });

  it("never opens the paths a manifest names, only the segment files the join reads", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    // A file that would pass every check if the manifest's own path were trusted.
    const elsewhere = join(dir, "elsewhere.mp4");
    writeFileSync(elsewhere, "xx");
    const named = [elsewhere, "/etc/hosts", "\\\\host\\share\\segment.mp4"];
    const manifest = manifestOf(named.map((path, index) => ({ ...entry(index), path })));
    const probed: string[] = [];
    const probe = async (path: string) => {
      probed.push(path);
      return 3;
    };
    expect((await validateCompletedSegments(manifest, check(9, probe))).size).toBe(0);
    expect(probed).toEqual([]);
  });

  it("re-captures a segment file that is a link, even to a finished segment", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    const target = join(dir, "real.mp4");
    writeFileSync(target, "xx");
    symlinkSync(target, segmentOutputPath(dir, 0));
    const manifest = manifestOf([entry(0)]);
    expect(
      (
        await validateCompletedSegments(
          manifest,
          check(3, async () => 3),
        )
      ).size,
    ).toBe(0);
  });

  it("ignores entries for segments this plan does not have", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-seg-"));
    for (const index of [0, 1, 5]) writeFileSync(segmentOutputPath(dir, index), "xx");
    const shifted = { ...entry(1), startFrame: 2, endFrame: 5 };
    const manifest = manifestOf([entry(0), shifted, entry(5), { ...entry(0), index: 0.5 }], 6);
    const probe = async () => 3;
    expect([...(await validateCompletedSegments(manifest, check(6, probe)))]).toEqual([0]);
  });
});

describe("probeSegmentFrameCount", () => {
  it("derives the count from duration and fps", async () => {
    const probe = async () => ({ videoStreamDurationSeconds: 50, fps: 30 });
    expect(await probeSegmentFrameCount("/s.mp4", probe)).toBe(1500);
  });

  it("returns null for anything it cannot trust, rather than a wrong count", async () => {
    // Each of these would otherwise produce a number that could match the
    // slice length by accident and let a bad segment be reused.
    expect(
      await probeSegmentFrameCount("/s.mp4", async () => ({
        videoStreamDurationSeconds: Number.NaN,
        fps: 30,
      })),
    ).toBeNull();
    expect(
      await probeSegmentFrameCount("/s.mp4", async () => ({
        videoStreamDurationSeconds: 50,
        fps: 0,
      })),
    ).toBeNull();
    expect(
      await probeSegmentFrameCount("/s.mp4", async () => {
        throw new Error("not a media file");
      }),
    ).toBeNull();
  });

  it("detects a truncated segment through its shorter duration", async () => {
    const probe = async () => ({ videoStreamDurationSeconds: 33.3, fps: 30 });
    expect(await probeSegmentFrameCount("/s.mp4", probe)).not.toBe(1500);
  });
});
