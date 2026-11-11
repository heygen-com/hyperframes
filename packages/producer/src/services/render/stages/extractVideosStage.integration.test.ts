import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoElement } from "@hyperframes/engine";
import { resolveConfig } from "@hyperframes/engine";
import { runExtractVideosStage } from "./extractVideosStage.js";
import { createRenderJob } from "../../renderOrchestrator.js";

describe("deferring range extraction beside a variable-frame-rate source", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-defer-vfr-"));
  const synthesize = (name: string, input: string, filters: string[] = []) => {
    const result = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      input,
      ...filters,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(projectDir, name),
    ]);
    if (result.status !== 0) throw new Error(result.stderr.toString());
  };

  beforeAll(() => {
    synthesize("cfr.mp4", "testsrc2=s=64x36:r=30:d=6");
    synthesize("vfr.mp4", "testsrc2=s=64x36:d=10:rate=1/2", [
      "-vf",
      "select='eq(n,0)+eq(n,2)'",
      "-fps_mode",
      "vfr",
    ]);
  }, 30_000);
  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  const clip = (id: string): VideoElement => ({
    id,
    src: `${id}.mp4`,
    start: 0,
    end: 3,
    mediaStart: 0,
    loop: false,
    hasAudio: false,
  });

  const extract = (deferRangeExtraction: boolean | undefined) => {
    const compiledDir = join(projectDir, `compiled-${String(deferRangeExtraction)}`);
    mkdirSync(compiledDir, { recursive: true });
    return runExtractVideosStage({
      projectDir,
      compiledDir,
      job: createRenderJob({ fps: 30, quality: "standard", hdrMode: "force-sdr" }),
      cfg: resolveConfig({}),
      composition: {
        duration: 3,
        width: 64,
        height: 36,
        videos: [clip("cfr"), clip("vfr")],
        audios: [],
        images: [],
      },
      abortSignal: undefined,
      assertNotAborted: () => {},
      deferRangeExtraction,
    });
  };

  it("a VFR source beside a CFR one: the CFR source defers and the VFR source extracts in full", async () => {
    const { extractionResult } = await extract(true);
    const byId = new Map(extractionResult!.extracted.map((video) => [video.videoId, video]));

    const cfr = byId.get("cfr")!;
    expect(cfr.deferredRange).toBeDefined();
    expect(cfr.framePaths.size).toBe(0);
    expect(cfr.totalFrames).toBe(90);

    const vfr = byId.get("vfr")!;
    expect(vfr.metadata.isVFR).toBe(true);
    expect(vfr.deferredRange).toBeUndefined();
    expect(vfr.framePaths.size).toBeGreaterThan(0);
  }, 60_000);

  it("extracts every source in full when range extraction is not deferred", async () => {
    const { extractionResult } = await extract(undefined);
    expect(extractionResult!.extracted.some((video) => video.deferredRange)).toBe(false);
    const cfr = extractionResult!.extracted.find((video) => video.videoId === "cfr")!;
    expect(cfr.framePaths.size).toBe(90);
  }, 60_000);
});
