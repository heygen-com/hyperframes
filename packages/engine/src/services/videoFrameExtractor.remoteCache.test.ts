import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// A download copies the current clip into the render's own dir: new path and mtime every render.
const download = vi.hoisted(() => ({ source: "" }));
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    const local = join(destDir, "clip.mp4");
    copyFileSync(download.source, local);
    return local;
  },
}));

const { extractAllVideoFrames } = await import("./videoFrameExtractor.js");

describe.skipIf(process.platform === "win32")("extractAllVideoFrames remote video cache", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-remote-cache-"));
  const cacheDir = join(dir, "cache");
  const video: VideoElement = {
    ...{ id: "remote", src: "https://cdn.example.com/clip.mp4", start: 0, end: 1 },
    ...{ mediaStart: 0, loop: false, hasAudio: false },
  };
  let red = "";
  let blue = "";

  async function synth(name: string, color: string): Promise<string> {
    const clip = join(dir, `${name}.mp4`);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=32x16:d=1:r=30`],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clip],
    ]);
    expect(made.success, made.stderr).toBe(true);
    return clip;
  }

  function render(name: string) {
    const outputDir = join(dir, name);
    mkdirSync(outputDir, { recursive: true });
    return extractAllVideoFrames([video], dir, { fps: 30, outputDir }, undefined, {
      extractCacheDir: cacheDir,
    });
  }

  beforeAll(async () => {
    red = await synth("red", "red");
    blue = await synth("blue", "blue");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a re-render of the same remote video reuses its extracted frames", async () => {
    download.source = red;
    const first = await render("render-1");
    const second = await render("render-2");
    expect(first.errors).toEqual([]);
    expect(first.phaseBreakdown.cacheMisses).toBe(1);
    expect(second.errors).toEqual([]);
    expect(second.phaseBreakdown.cacheHits).toBe(1);
    expect(second.phaseBreakdown.cacheMisses).toBe(0);
  });

  it("a remote video whose bytes changed extracts again", async () => {
    download.source = red;
    await render("render-3");
    download.source = blue;
    const changed = await render("render-4");
    expect(changed.errors).toEqual([]);
    expect(changed.phaseBreakdown.cacheHits).toBe(0);
    expect(changed.phaseBreakdown.cacheMisses).toBe(1);
  });
});
