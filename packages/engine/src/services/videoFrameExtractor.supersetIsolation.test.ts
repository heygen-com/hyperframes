import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";

// Enough extraction slots that one render waiting inside ffmpeg never starves the other.
vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  availableParallelism: () => 16,
}));

// Lets a test hold one source's superset ffmpeg until it says so.
const held = vi.hoisted(() => ({
  source: "",
  reached: () => {},
  release: Promise.resolve(),
}));

vi.mock("../utils/runFfmpeg.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../utils/runFfmpeg.js")>();
  return {
    ...real,
    runFfmpeg: vi.fn(async (args: string[], opts?: Parameters<typeof real.runFfmpeg>[1]) => {
      if (args.includes(held.source) && args.some((arg) => arg.includes("__superset-"))) {
        held.reached();
        await held.release;
      }
      return real.runFfmpeg(args, opts);
    }),
  };
});

const { extractAllVideoFrames, extractVideoFramesRange } = await import("./videoFrameExtractor.js");
const { runFfmpeg } = await import("../utils/runFfmpeg.js");

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!HAS_FFMPEG)("superset extraction in concurrent renders", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-superset-isolation-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function synth(name: string, lavfi: string): Promise<string> {
    const src = join(dir, name);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", lavfi],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src],
    ]);
    expect(made.success, made.stderr).toBe(true);
    return src;
  }

  // Two overlapping, frame-aligned trims of one source: a render extracts them as one superset group.
  const overlappingTrims = (prefix: string, src: string): VideoElement[] =>
    [0, 2].map((mediaStart, i) => ({
      ...{ id: `${prefix}-${i}`, src, start: 0, end: 4, mediaStart },
      ...{ loop: false, hasAudio: false },
    }));

  const render = (videos: VideoElement[], out: string, cacheDir: string) =>
    extractAllVideoFrames(videos, dir, { fps: 30, outputDir: join(dir, out) }, undefined, {
      extractCacheDir: cacheDir,
    });

  const supersetFolders = (root: string): string[] =>
    readdirSync(root).filter((name) => name.startsWith("__superset-"));

  async function expectOwnFrames(
    result: Awaited<ReturnType<typeof extractAllVideoFrames>>,
    videos: VideoElement[],
  ): Promise<void> {
    expect(result.errors).toEqual([]);
    for (const video of videos) {
      const extracted = result.extracted.find((item) => item.videoId === video.id);
      expect(extracted?.totalFrames).toBe(120);
      const direct = await extractVideoFramesRange(
        video.src,
        `direct-${video.id}`,
        video.mediaStart,
        4,
        { fps: 30, outputDir: join(dir, "direct"), format: "jpg" },
      );
      for (const frame of [0, 60, 119]) {
        const own = readFileSync(direct.framePaths.get(frame)!);
        const got = readFileSync(extracted!.framePaths.get(frame)!);
        expect(got.equals(own), `${video.id} frame ${frame}`).toBe(true);
      }
    }
  }

  it("keeps each render's frames and folder its own while another runs in the same process", async () => {
    const cacheDir = mkdtempSync(join(dir, "cache-"));
    const first = overlappingTrims("first", await synth("first.mp4", "testsrc2=d=10:s=320x180"));
    const second = overlappingTrims(
      "second",
      await synth("second.mp4", "mandelbrot=s=320x180,trim=duration=10"),
    );

    let release = () => {};
    const reached = new Promise<void>((resolve) => {
      held.source = first[0]!.src;
      held.reached = resolve;
      held.release = new Promise<void>((done) => (release = done));
    });
    const firstRender = render(first, "out-first", cacheDir);
    try {
      await reached;
      const firstFolders = supersetFolders(cacheDir);
      expect(firstFolders).toHaveLength(1);

      // The second render runs start to finish, cleanup included, while the first waits mid-extraction.
      await expectOwnFrames(await render(second, "out-second", cacheDir), second);
      expect(existsSync(join(cacheDir, firstFolders[0]!))).toBe(true);
    } finally {
      release();
    }
    await expectOwnFrames(await firstRender, first);
    expect(supersetFolders(cacheDir)).toEqual([]);
  }, 120_000);
});
