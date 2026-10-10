import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// Each render gets its own copy of the clip: new path and mtime, same bytes.
const source = vi.hoisted(() => ({ clip: "" }));
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    const local = join(destDir, "clip.mp4");
    copyFileSync(source.clip, local);
    return local;
  },
}));

const hashing = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("./extractionCache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extractionCache.js")>();
  return {
    ...actual,
    readContentSha256: async (path: string) => {
      hashing.paths.push(path);
      return actual.readContentSha256(path);
    },
  };
});

const { extractAllVideoFrames } = await import("./videoFrameExtractor.js");

describe.skipIf(process.platform === "win32")("extractAllVideoFrames downloaded sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-render-owned-"));
  const cacheDir = join(dir, "cache");
  let red = "";
  let blue = "";
  let green = "";

  async function synth(color: string, seconds = 1): Promise<string> {
    const clip = join(dir, `${color}-${seconds}s.mp4`);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=32x16:d=${seconds}:r=30`],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip],
    ]);
    expect(made.success, made.stderr).toBe(true);
    return clip;
  }

  function clipElement(src: string, id = "clip", end = 1): VideoElement {
    return { id, src, start: 0, end, mediaStart: 0, loop: false, hasAudio: false };
  }

  // The producer downloads a remote src at compile time into the render's compiled dir;
  // a distributed plan also copies the whole project there (`subdir: "."`).
  function renderCompiledCopy(
    name: string,
    videos = [clipElement("_remote_media/clip.mp4")],
    { deferRangeExtraction = false, subdir = "_remote_media" } = {},
  ) {
    const compiledDir = join(dir, name, "compiled");
    mkdirSync(join(compiledDir, subdir), { recursive: true });
    copyFileSync(source.clip, join(compiledDir, subdir, "clip.mp4"));
    const outputDir = join(compiledDir, "frames");
    return extractAllVideoFrames(
      videos,
      join(dir, "project"),
      {
        ...{ fps: 30, outputDir, deferRangeExtraction },
        contentKeyedDirs: [join(compiledDir, "_remote_media")],
      },
      undefined,
      { extractCacheDir: cacheDir },
      compiledDir,
    );
  }

  function firstFrameBytes(result: Awaited<ReturnType<typeof extractAllVideoFrames>>): Buffer {
    const frame = result.extracted[0]?.framePaths.get(0);
    if (!frame) throw new Error("missing first frame");
    return readFileSync(frame);
  }

  function renderRemoteSrc(name: string) {
    const outputDir = join(dir, name);
    mkdirSync(outputDir, { recursive: true });
    return extractAllVideoFrames(
      [clipElement("https://cdn.example.com/clip.mp4")],
      dir,
      { fps: 30, outputDir },
      undefined,
      { extractCacheDir: cacheDir },
    );
  }

  beforeAll(async () => {
    mkdirSync(join(dir, "project"), { recursive: true });
    red = await synth("red");
    blue = await synth("blue");
    green = await synth("green");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a re-render reuses the frames of a video copied into its compiled dir", async () => {
    source.clip = red;
    const first = await renderCompiledCopy("compiled-1");
    const second = await renderCompiledCopy("compiled-2");
    expect(first.errors).toEqual([]);
    expect(first.phaseBreakdown.cacheMisses).toBe(1);
    expect(second.errors).toEqual([]);
    expect(second.phaseBreakdown.cacheHits).toBe(1);
    expect(second.phaseBreakdown.cacheMisses).toBe(0);
    expect(second.extracted[0]?.totalFrames).toBe(first.extracted[0]?.totalFrames);
    expect(firstFrameBytes(second).equals(firstFrameBytes(first))).toBe(true);
  });

  it("a re-render reuses the frames of a video the extractor downloaded itself", async () => {
    source.clip = blue;
    await renderRemoteSrc("remote-1");
    const second = await renderRemoteSrc("remote-2");
    expect(second.errors).toEqual([]);
    expect(second.phaseBreakdown.cacheHits).toBe(1);
  });

  it("a render-owned video whose bytes changed extracts again", async () => {
    source.clip = red;
    await renderCompiledCopy("changed-1");
    source.clip = green;
    const changed = await renderCompiledCopy("changed-2");
    expect(changed.errors).toEqual([]);
    expect(changed.phaseBreakdown.cacheHits).toBe(0);
    expect(changed.phaseBreakdown.cacheMisses).toBe(1);
  });

  it("hashes a file once however many videos use it", async () => {
    source.clip = red;
    hashing.paths = [];
    const result = await renderCompiledCopy("shared", [
      clipElement("_remote_media/clip.mp4", "a"),
      { ...clipElement("_remote_media/clip.mp4", "b"), start: 1, mediaStart: 0.5, end: 1.5 },
    ]);
    expect(result.errors).toEqual([]);
    expect(hashing.paths).toHaveLength(1);
  });

  it("does not hash a video whose extraction is deferred", async () => {
    source.clip = await synth("yellow", 3);
    hashing.paths = [];
    const result = await renderCompiledCopy(
      "deferred",
      [clipElement("_remote_media/clip.mp4", "clip", 3)],
      { deferRangeExtraction: true },
    );
    expect(result.errors).toEqual([]);
    expect(result.extracted[0]?.deferredRange).toBeDefined();
    expect(hashing.paths).toEqual([]);
  });

  it("keeps a project copy outside the download dirs on its path key", async () => {
    source.clip = red;
    hashing.paths = [];
    const first = await renderCompiledCopy("copy-1", [clipElement("clip.mp4")], { subdir: "." });
    const second = await renderCompiledCopy("copy-2", [clipElement("clip.mp4")], { subdir: "." });
    expect(second.errors).toEqual([]);
    expect(first.phaseBreakdown.cacheHits + second.phaseBreakdown.cacheHits).toBe(0);
    expect(hashing.paths).toEqual([]);
  });

  it("does not hash when the cache is off", async () => {
    source.clip = red;
    hashing.paths = [];
    const compiledDir = join(dir, "cache-off", "compiled");
    mkdirSync(join(compiledDir, "_remote_media"), { recursive: true });
    copyFileSync(source.clip, join(compiledDir, "_remote_media", "clip.mp4"));
    const result = await extractAllVideoFrames(
      [clipElement("_remote_media/clip.mp4")],
      join(dir, "project"),
      {
        ...{ fps: 30, outputDir: join(compiledDir, "frames") },
        contentKeyedDirs: [join(compiledDir, "_remote_media")],
      },
      undefined,
      {},
      compiledDir,
    );
    expect(result.errors).toEqual([]);
    expect(hashing.paths).toEqual([]);
  });
});
