// The HDR passthrough's frame deferral against real ffmpeg: a native HLG source is probed but not
// decoded, and the frames extracted later for a fallback are byte-identical to the ones a flag-off
// extraction writes. Needs ffmpeg with libx265: integration lane.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtractedFrames, VideoElement } from "@hyperframes/engine";
import { getFfmpegBinary, resolveConfig } from "@hyperframes/engine";
import { buildSourceClipArgs } from "../../../hdr-passthrough-harness/fixture.js";
import { extractAllDeferredFrames } from "../deferredVideoFrames.js";
import { runExtractVideosStage } from "./extractVideosStage.js";
import { createRenderJob } from "../../renderOrchestrator.js";

const FFMPEG = getFfmpegBinary();
const DURATION = 3;
const FPS = 30;

function frameDigests(video: ExtractedFrames): Map<number, string> {
  const digests = new Map<number, string>();
  for (const [index, path] of video.framePaths) {
    digests.set(index, createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  return digests;
}

describe("deferring a native HDR video's frames for the HDR passthrough", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-hdr-defer-"));

  beforeAll(() => {
    const hlg = spawnSync(
      FFMPEG,
      buildSourceClipArgs({
        outputPath: join(projectDir, "hlg.mp4"),
        durationSec: DURATION,
        width: 320,
        height: 180,
        fps: FPS,
        crf: 18,
      }),
    );
    if (hlg.status !== 0) throw new Error(hlg.stderr.toString());
    const sdr = spawnSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=320x180:r=${FPS}:d=${DURATION}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(projectDir, "sdr.mp4"),
    ]);
    if (sdr.status !== 0) throw new Error(sdr.stderr.toString());
  }, 60_000);
  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  const clip = (src: string): VideoElement => ({
    id: "source",
    src,
    start: 0,
    end: DURATION,
    mediaStart: 0,
    loop: false,
    hasAudio: true,
  });

  let run = 0;
  const extract = (src: string, deferNativeHdrFrames: boolean | undefined) => {
    const compiledDir = join(projectDir, `compiled-${run++}`);
    mkdirSync(compiledDir, { recursive: true });
    const composition = {
      duration: DURATION,
      width: 320,
      height: 180,
      videos: [clip(src)],
      audios: [],
      images: [],
    };
    const stage = runExtractVideosStage({
      projectDir,
      compiledDir,
      job: createRenderJob({ fps: FPS, quality: "standard" }),
      cfg: resolveConfig({}),
      composition,
      abortSignal: undefined,
      assertNotAborted: () => {},
      ...(deferNativeHdrFrames === undefined ? {} : { deferNativeHdrFrames }),
    });
    return stage.then((result) => ({ ...result, composition }));
  };

  it("flag off: the HLG source is extracted in full, as before", async () => {
    const eager = await extract("hlg.mp4", undefined);
    expect(eager.nativeHdrVideoIds.has("source")).toBe(true);
    expect(eager.nativeHdrFramesDeferred).toBe(false);
    const video = eager.extractionResult!.extracted[0]!;
    expect(video.deferredRange).toBeUndefined();
    expect(video.framePaths.size).toBe(DURATION * FPS);
  }, 60_000);

  it("eligible: no frames are decoded, and the later extraction matches the flag-off frames byte for byte", async () => {
    const eager = await extract("hlg.mp4", undefined);
    const deferred = await extract("hlg.mp4", true);
    expect(deferred.nativeHdrFramesDeferred).toBe(true);
    const eagerVideo = eager.extractionResult!.extracted[0]!;
    const video = deferred.extractionResult!.extracted[0]!;
    expect(video.deferredRange).toBeDefined();
    expect(video.framePaths.size).toBe(0);
    expect(deferred.extractionResult!.totalFramesExtracted).toBe(0);
    // Everything decided from Stage 2 before the frames exist is the same as flag off.
    expect(video.totalFrames).toBe(eagerVideo.totalFrames);
    expect(video.metadata).toEqual(eagerVideo.metadata);
    expect(deferred.videoReadinessSkipIds).toEqual(eager.videoReadinessSkipIds);
    expect(deferred.videoMetadataHints).toEqual(eager.videoMetadataHints);
    expect(deferred.composition.audios).toEqual(eager.composition.audios);
    expect(deferred.composition.videos).toEqual(eager.composition.videos);

    // The fallback: the frames the layered path reads, written where the lookup points.
    await extractAllDeferredFrames(deferred.extractionResult!.extracted, {
      fps: { num: FPS, den: 1 },
      cfg: resolveConfig({}),
    });
    expect(video.deferredRange).toBeUndefined();
    expect(video.framePaths.size).toBe(eagerVideo.framePaths.size);
    expect(deferred.frameLookup!.getFrame("source", 1.5)).toBe(video.framePaths.get(45)!);
    expect(frameDigests(video)).toEqual(frameDigests(eagerVideo));
  }, 120_000);

  it("an SDR source is extracted in full even when deferral is requested", async () => {
    const result = await extract("sdr.mp4", true);
    expect(result.nativeHdrVideoIds.size).toBe(0);
    expect(result.nativeHdrFramesDeferred).toBe(false);
    const video = result.extractionResult!.extracted[0]!;
    expect(video.deferredRange).toBeUndefined();
    expect(video.framePaths.size).toBe(DURATION * FPS);
  }, 60_000);
});
