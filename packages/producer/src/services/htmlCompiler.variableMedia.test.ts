import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "./htmlCompiler.js";
import { hasVariableBoundMedia } from "./render/stages/probeStage.js";

function makeClip(path: string, seconds: number): void {
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  const source = `color=c=red:s=16x16:r=5:d=${seconds}`;
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source];
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path);
  const made = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (made.status !== 0) throw new Error(made.stderr || "failed to create fixture");
}

describe("compileForRender variable-bound media", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-compiler-var-media-"));

  beforeAll(() => {
    mkdirSync(join(projectDir, "compositions"));
    mkdirSync(join(projectDir, "assets"));
    makeClip(join(projectDir, "assets", "placeholder.mp4"), 3);
    makeClip(join(projectDir, "assets", "clip.mp4"), 13);
    writeFileSync(
      join(projectDir, "compositions", "clip.html"),
      `<template id="clip-template"><div data-composition-id="clip" data-width="16" data-height="16"><video id="v" muted src="../assets/placeholder.mp4" data-var-src="src" data-start="0" data-duration="60" data-track-index="0"></video></div></template>`,
    );
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="60" data-width="16" data-height="16"><div data-composition-id="clip" data-composition-src="compositions/clip.html" data-start="0" data-duration="60" data-width="16" data-height="16" data-variable-values='{"src":"assets/clip.mp4"}'></div></main></body></html>`,
    );
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  it("sends a clip its mount rebinds to a longer file through the browser probe", async () => {
    const entry = join(projectDir, "index.html");
    const options = { allowSystemFontCapture: false };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    // Compile reads the authored 3 s placeholder; only the browser knows the mount binds the 13 s clip.
    expect(compiled.videos.map((video) => video.src)).toEqual(["assets/placeholder.mp4"]);
    expect(hasVariableBoundMedia(compiled.html, undefined)).toBe(true);
  });
});
