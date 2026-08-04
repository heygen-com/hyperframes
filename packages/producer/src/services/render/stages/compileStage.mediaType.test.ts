import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { EngineConfig } from "@hyperframes/engine";
import { runCompileStage } from "./compileStage.js";

const noopLog = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

function createCfg(): EngineConfig {
  return {
    chromeArgs: [],
    chromePath: undefined,
    captureCostMultiplier: 1,
    format: "jpeg",
    jpegQuality: 80,
    concurrency: "auto",
    coresPerWorker: 2.5,
    minParallelFrames: 120,
    largeRenderThreshold: 1000,
    disableGpu: false,
    browserGpuMode: "software",
    enableBrowserPool: false,
    browserTimeout: 120_000,
    protocolTimeout: 300_000,
    forceScreenshot: false,
    enableChunkedEncode: false,
    chunkSizeFrames: 360,
    enableStreamingEncode: false,
    streamingEncodeMaxDurationSeconds: 240,
    ffmpegEncodeTimeout: 600_000,
    ffmpegProcessTimeout: 300_000,
    ffmpegStreamingTimeout: 600_000,
    hdr: false,
    hdrAutoDetect: true,
    audioGain: 1,
    frameDataUriCacheLimit: 256,
    frameDataUriCacheBytesLimitMb: 1500,
    playerReadyTimeout: 45_000,
    renderReadyTimeout: 15_000,
    verifyRuntime: true,
    debug: false,
  };
}

describe("runCompileStage — asset media-type preflight", () => {
  let workDir: string | null = null;

  afterEach(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  });

  it("rejects the zero-video audio-under-image shape before extraction", async () => {
    workDir = mkdtempSync(join(tmpdir(), "compile-stage-media-type-"));
    const projectDir = join(workDir, "project");
    mkdirSync(projectDir);
    const htmlPath = join(projectDir, "index.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body>
        <div data-composition-id="root" data-width="320" data-height="180" data-duration="1">
          <img id="hero" src="voice.asset" data-start="0" data-end="1" />
        </div>
      </body></html>`,
    );
    const audioPath = join(projectDir, "voice.asset");
    const synth = spawnSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      audioPath,
    ]);
    expect(synth.status).toBe(0);

    await expect(
      runCompileStage({
        projectDir,
        workDir,
        htmlPath,
        entryFile: "index.html",
        job: {
          id: "media-type-test",
          config: { fps: { num: 30, den: 1 }, quality: "standard" },
          status: "queued",
          progress: 0,
          currentStage: "Queued",
          createdAt: new Date(0),
        },
        cfg: createCfg(),
        needsAlpha: false,
        log: noopLog,
        assertNotAborted: () => {},
      }),
    ).rejects.toMatchObject({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      owner: "user",
      retryable: false,
    });
  });
});
