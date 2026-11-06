import { mkdirSync, mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import type { EngineConfig, ExtractedFrames, VideoElement } from "@hyperframes/engine";
import { type extractDeferredFrames, shownDeferredFrameIndexes } from "./deferredVideoFrames.js";
import { createSegmentVideoFrames } from "./segmentVideoFrames.js";

const root = mkdtempSync(join(tmpdir(), "hf-segment-video-frames-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const metadata = {
  durationSeconds: 4,
  videoStreamDurationSeconds: 4,
  videoStreamStartSeconds: 0,
  width: 64,
  height: 36,
  fps: 30,
  videoCodec: "h264",
  hasAudio: false,
  isVFR: false,
  hasAlpha: false,
  colorSpace: null,
};

const base = (videoId: string, totalFrames: number): ExtractedFrames => ({
  videoId,
  srcPath: `/source/${videoId}.mp4`,
  outputDir: "",
  framePattern: "frame_%05d.jpg",
  fps: 30,
  totalFrames,
  metadata,
  framePaths: new Map(),
});

const deferredVideo = (videoId: string): ExtractedFrames => ({
  ...base(videoId, 75),
  deferredRange: { startTime: 1.5, durationSeconds: 2.5, format: "jpg" },
});

const wholeVideo = (videoId: string): ExtractedFrames => ({
  ...base(videoId, 75),
  outputDir: "/full-extraction/whole",
  framePaths: new Map(
    Array.from({ length: 75 }, (_, i) => [i, `/full-extraction/whole/frame_${i + 1}.jpg`]),
  ),
});

const element = (id: string, start: number, end: number): VideoElement => ({
  id,
  src: `${id}.mp4`,
  start,
  end,
  mediaStart: 1.5,
  loop: false,
  hasAudio: false,
});

const fps = { num: 30, den: 1 };
const cfg = { ffmpegProcessTimeout: 1000 } as EngineConfig;
const slice = (index: number, startFrame: number, endFrame: number) => ({
  index,
  startFrame,
  endFrame,
});
const span = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => start + i);

/** Stands in for the extractor: writes the frames the slice shows, as the real one names them. */
function fakeExtractor() {
  const calls: Array<{ outputRoot: string; frames: number[]; sourceOf: string[] }> = [];
  const extractFrames = async (input: Parameters<typeof extractDeferredFrames>[0]) => {
    const frames = [...input.frames];
    const shown = shownDeferredFrameIndexes(input, frames, input.fps);
    calls.push({
      outputRoot: input.outputRoot,
      frames,
      sourceOf: input.extracted.filter((v) => v.deferredRange).map((v) => input.sourceOf(v)),
    });
    return input.extracted
      .filter((video) => video.deferredRange)
      .map((video) => {
        const outputDir = join(input.outputRoot, video.videoId);
        const framePaths = new Map<number, string>();
        for (const index of shown.get(video.videoId) ?? []) {
          mkdirSync(outputDir, { recursive: true });
          const path = join(outputDir, `frame_${String(index + 1).padStart(5, "0")}.jpg`);
          writeFileSync(path, "x");
          framePaths.set(index, path);
        }
        return { ...video, outputDir, framePaths, ownedByLookup: false };
      });
  };
  return { calls, extractFrames };
}

function setup(extra: Partial<Parameters<typeof createSegmentVideoFrames>[0]> = {}) {
  const served: string[] = [];
  const dir = mkdtempSync(join(root, "work-"));
  const extractor = fakeExtractor();
  const segmentVideoFrames = createSegmentVideoFrames({
    videos: [element("clip", 0, 4), element("whole", 0, 4)],
    extracted: [deferredVideo("clip"), wholeVideo("whole")],
    fps,
    rootDir: dir,
    cfg,
    injectorOptions: {
      frameSrcResolver: (path) => {
        served.push(path);
        return `http://frames/${path}`;
      },
    },
    extractFrames: extractor.extractFrames,
    ...extra,
  });
  const page = { evaluate: async () => [] } as never;
  return {
    dir,
    served,
    extractor,
    segmentVideoFrames,
    workerFrames: segmentVideoFrames.forWorker(),
    page,
  };
}

describe("createSegmentVideoFrames", () => {
  it("extracts only the frames a slice shows, under that slice's own folder", async () => {
    const { dir, served, extractor, workerFrames, page } = setup();
    await workerFrames.prepare(slice(1, 30, 45));

    const folder = join(dir, "segment-frames", "segment_00001");
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0]!.outputRoot).toBe(folder);
    expect(extractor.calls[0]!.frames).toEqual(span(30, 45));
    expect(readdirSync(join(folder, "clip")).sort()).toEqual(
      span(30, 45).map((i) => `frame_${String(i + 1).padStart(5, "0")}.jpg`),
    );

    await workerFrames.hook(page, 31 / 30);
    expect(served).toContain(join(folder, "clip", "frame_00032.jpg"));
  });

  it("forFrames extracts just the given frames ahead of time and release removes them", async () => {
    const { dir, served, extractor, segmentVideoFrames, page } = setup();
    const frames = await segmentVideoFrames.forFrames([0, 40, 74], "calibration");

    const folder = join(dir, "segment-frames", "calibration");
    expect(extractor.calls[0]!.outputRoot).toBe(folder);
    expect(extractor.calls[0]!.frames).toEqual([0, 40, 74]);
    expect(readdirSync(join(folder, "clip")).sort()).toEqual([
      "frame_00001.jpg",
      "frame_00041.jpg",
      "frame_00075.jpg",
    ]);

    await frames.injector()!(page, 40 / 30);
    expect(served).toContain(join(folder, "clip", "frame_00041.jpg"));

    frames.release();
    expect(existsSync(folder)).toBe(false);
    expect(() => frames.release()).not.toThrow();
  });

  it("forFrames leaves no folder behind when its extraction fails", async () => {
    const { dir, segmentVideoFrames } = setup({
      extractFrames: async (input) => {
        mkdirSync(join(input.outputRoot, "clip"), { recursive: true });
        throw new Error("aborted");
      },
    });
    await expect(segmentVideoFrames.forFrames([0], "calibration")).rejects.toThrow("aborted");
    expect(existsSync(join(dir, "segment-frames", "calibration"))).toBe(false);
  });

  it("release removes the folder and a second release does nothing", async () => {
    const { dir, workerFrames } = setup();
    await workerFrames.prepare(slice(2, 60, 75));
    const folder = join(dir, "segment-frames", "segment_00002");
    expect(existsSync(folder)).toBe(true);

    workerFrames.release();
    expect(existsSync(folder)).toBe(false);
    expect(() => workerFrames.release()).not.toThrow();
  });

  it("a video that was fully extracted is served from its existing frames and never extracted again", async () => {
    const { served, extractor, workerFrames, page } = setup();
    await workerFrames.prepare(slice(0, 0, 15));

    await workerFrames.hook(page, 3 / 30);
    expect(served).toContain("/full-extraction/whole/frame_4.jpg");
    // The extractor is handed the whole list and picks out the deferred ones; the full one has no source read.
    expect(extractor.calls[0]!.sourceOf).toEqual(["/source/clip.mp4"]);
    expect(existsSync(join(extractor.calls[0]!.outputRoot, "whole"))).toBe(false);
  });

  it("a slice showing no deferred video extracts nothing", async () => {
    const dir = mkdtempSync(join(root, "work-"));
    const segmentVideoFrames = createSegmentVideoFrames({
      videos: [element("later", 10, 12)],
      extracted: [deferredVideo("later")],
      fps,
      rootDir: dir,
      cfg,
      injectorOptions: {},
      sourceOf: () => {
        throw new Error("a slice that shows no video must not read a source");
      },
    });
    const workerFrames = segmentVideoFrames.forWorker();

    await workerFrames.prepare(slice(0, 0, 15));

    const folder = join(dir, "segment-frames", "segment_00000");
    expect(readdirSync(folder).flatMap((entry) => readdirSync(join(folder, entry)))).toEqual([]);
  });

  it("a prepare that fails mid-extraction leaves no folder behind", async () => {
    const { dir, workerFrames } = setup({
      extractFrames: async (input) => {
        mkdirSync(join(input.outputRoot, "clip"), { recursive: true });
        writeFileSync(join(input.outputRoot, "clip", "frame_00001.jpg"), "x");
        throw new Error("aborted");
      },
    });

    await expect(workerFrames.prepare(slice(3, 90, 105))).rejects.toThrow("aborted");

    expect(existsSync(join(dir, "segment-frames", "segment_00003"))).toBe(false);
  });
  describe("outside a prepared window", () => {
    const onDemandFolders = (dir: string) => {
      const root = join(dir, "segment-frames");
      return existsSync(root) ? readdirSync(root).filter((n) => n.startsWith("on-demand_")) : [];
    };

    /** Records, at injection time, whether the folder the served frame lives in still existed. */
    function setupWatching() {
      const seen: Array<{ path: string; existed: boolean }> = [];
      const made = setup({
        injectorOptions: {
          frameSrcResolver: (path) => {
            seen.push({ path, existed: existsSync(path) });
            return `http://frames/${path}`;
          },
        },
      });
      return { ...made, seen };
    }

    it("before any prepare, the hook extracts and injects the frame asked for, then removes its folder", async () => {
      const { dir, seen, extractor, workerFrames, page } = setupWatching();

      await workerFrames.hook(page, 31 / 30);

      expect(extractor.calls).toHaveLength(1);
      expect(extractor.calls[0]!.frames).toEqual([31]);
      expect(
        extractor.calls[0]!.outputRoot.startsWith(join(dir, "segment-frames", "on-demand_")),
      ).toBe(true);
      const clip = seen.find((s) => s.path.includes("/clip/"));
      expect(clip).toEqual({ path: expect.stringContaining("frame_00032.jpg"), existed: true });
      // The fully extracted video is injected too, from its own frames.
      expect(seen.some((s) => s.path === "/full-extraction/whole/frame_32.jpg")).toBe(true);
      expect(onDemandFolders(dir)).toEqual([]);
    });

    it("asks for the held frame too when the capture holds footage for a motion-blur sample", async () => {
      const { extractor, workerFrames, page } = setupWatching();

      await workerFrames.hook(page, 32 / 30, 30 / 30);

      expect(extractor.calls[0]!.frames).toEqual([32, 30]);
    });

    it("after release, the hook extracts on demand again", async () => {
      const { dir, seen, extractor, workerFrames, page } = setupWatching();
      await workerFrames.prepare(slice(1, 30, 45));
      await workerFrames.hook(page, 31 / 30);
      expect(extractor.calls).toHaveLength(1);

      workerFrames.release();
      await workerFrames.hook(page, 61 / 30);

      expect(extractor.calls).toHaveLength(2);
      expect(extractor.calls[1]!.frames).toEqual([61]);
      expect(
        seen.some((s) => s.path.includes("on-demand_") && s.path.includes("frame_00062.jpg")),
      ).toBe(true);
      expect(onDemandFolders(dir)).toEqual([]);
    });

    it("fresh returns an independent hook that also extracts on demand", async () => {
      const { dir, seen, extractor, workerFrames, page } = setupWatching();
      await workerFrames.prepare(slice(1, 30, 45));

      const fresh = workerFrames.hook.fresh!();
      expect(fresh).not.toBe(workerFrames.hook);
      // The worker's window is prepared, yet the fresh hook still reads its own frames.
      await fresh(page, 40 / 30);

      expect(extractor.calls).toHaveLength(2);
      expect(extractor.calls[1]!.frames).toEqual([40]);
      expect(
        seen.some((s) => s.path.includes("on-demand_") && s.path.includes("frame_00041.jpg")),
      ).toBe(true);
      expect(onDemandFolders(dir)).toEqual([]);
      expect(typeof fresh.fresh).toBe("function");
    });

    it("an on-demand extraction that fails removes its folder and rethrows", async () => {
      const { dir, workerFrames, page } = setup({
        extractFrames: async (input) => {
          mkdirSync(join(input.outputRoot, "clip"), { recursive: true });
          writeFileSync(join(input.outputRoot, "clip", "frame_00001.jpg"), "x");
          throw new Error("aborted");
        },
      });

      await expect(workerFrames.hook(page, 31 / 30)).rejects.toThrow("aborted");

      expect(onDemandFolders(dir)).toEqual([]);
    });

    it("gives two workers different folders", async () => {
      const { extractor, segmentVideoFrames, workerFrames, page } = setup();
      const other = segmentVideoFrames.forWorker();

      await Promise.all([workerFrames.hook(page, 31 / 30), other.hook(page, 31 / 30)]);

      expect(new Set(extractor.calls.map((call) => call.outputRoot)).size).toBe(2);
    });
  });
});
