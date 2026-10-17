import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, type ExtractionResult, type VideoElement } from "@hyperframes/engine";
import { afterEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ dir: "" }));

vi.mock("@hyperframes/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/engine")>();
  return {
    ...real,
    extractAllVideoFrames: async (
      videos: VideoElement[],
      _baseDir: string,
      options: { outputDir?: string },
    ): Promise<ExtractionResult> => {
      const transform = options.outputDir?.endsWith("_sdr") ? "sdr" : "original";
      const outputDir = join(cache.dir, transform);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, "frame_00001.jpg"), transform);
      const video = videos[0]!;
      return {
        success: true,
        extracted: [
          {
            videoId: video.id,
            srcPath: video.src,
            outputDir,
            framePattern: "frame_%05d.jpg",
            fps: 30,
            totalFrames: 1,
            metadata: { durationSeconds: 1, width: 2, height: 2, fps: 30 } as never,
            framePaths: new Map([[0, join(outputDir, "frame_00001.jpg")]]),
          },
        ],
        errors: [],
        totalFramesExtracted: 1,
        durationMs: 0,
        phaseBreakdown: {} as never,
      };
    },
  };
});

import { createRenderJob } from "../../renderOrchestrator.js";
import { runExtractVideosStage } from "./extractVideosStage.js";

describe("tone-mapping a clip to SDR after extraction", () => {
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([false, true])(
    "serves the tone-mapped frames, not the cached original (copy frames: %s)",
    async (materializeSymlinks) => {
      root = mkdtempSync(join(tmpdir(), "hf-sdr-restage-"));
      cache.dir = join(root, "cache");
      const compiledDir = join(root, "compiled");
      mkdirSync(compiledDir);
      const video = { id: "clip", src: "clip.mp4", start: 0, end: 1, mediaStart: 0 };
      const stage = await runExtractVideosStage({
        projectDir: root,
        compiledDir,
        job: createRenderJob({
          fps: { num: 30, den: 1 },
          quality: "standard",
          hdrMode: "force-sdr",
        }),
        cfg: resolveConfig(),
        composition: {
          duration: 1,
          videos: [{ ...video, loop: false, hasAudio: false }],
          audios: [],
          images: [],
          width: 2,
          height: 2,
        },
        abortSignal: undefined,
        assertNotAborted: () => {},
        materializeSymlinks,
      });

      await stage.toneMapVideosToSdr(new Set(["clip"]));

      const frame = stage.frameLookup?.getFrame("clip", 0);
      expect(frame && readFileSync(frame, "utf-8")).toBe("sdr");
    },
  );
});
