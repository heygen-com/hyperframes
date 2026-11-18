import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
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

function makeToneClip(path: string, seconds: number): void {
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"];
  args.push(`color=c=red:s=16x16:r=5:d=${seconds}`, "-f", "lavfi", "-i", `sine=d=${seconds}`);
  args.push("-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", path);
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
    // A full-document sub-composition declares the default on its own <html>,
    // which inlining drops; only __hfVariablesByComp still carries it.
    writeFileSync(
      join(projectDir, "compositions", "card.html"),
      `<!doctype html><html data-composition-variables='[{"id":"src","type":"string","default":"assets/clip.mp4"}]'><body><div data-composition-id="card" data-width="16" data-height="16"><video id="v" muted src="../assets/placeholder.mp4" data-var-src="src" data-start="0" data-duration="60" data-track-index="0"></video></div></body></html>`,
    );
    writeFileSync(
      join(projectDir, "index-declared-default.html"),
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="60" data-width="16" data-height="16"><div data-composition-id="card" data-composition-src="compositions/card.html" data-start="0" data-duration="60" data-width="16" data-height="16"></div></main></body></html>`,
    );
    // Same mount with no authored data-composition-id: the flattened inner
    // root keeps the sub-composition's own id, which keys its table entry.
    writeFileSync(
      join(projectDir, "index-anonymous-host.html"),
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="60" data-width="16" data-height="16"><div data-composition-src="compositions/card.html" data-start="0" data-duration="60" data-width="16" data-height="16"></div></main></body></html>`,
    );
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  it("sends a clip its mount rebinds to a longer file through the browser probe", async () => {
    const entry = join(projectDir, "index.html");
    const options = { allowSystemFontCapture: false };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    // Compile reads the authored 3 s placeholder; only the browser knows the mount binds the 13 s clip.
    expect(compiled.videos.map((video) => video.src)).toEqual(["assets/placeholder.mp4"]);
    expect(hasVariableBoundMedia(compiled.html, undefined, compiled.variablesByComp)).toBe(true);
  });

  it("probes a clip bound to its sub-composition's own declared default", async () => {
    const entry = join(projectDir, "index-declared-default.html");
    const options = { allowSystemFontCapture: false };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    expect(compiled.videos.map((video) => video.src)).toEqual(["assets/placeholder.mp4"]);
    expect(compiled.variablesByComp).toEqual({ card: { src: "assets/clip.mp4" } });
    expect(hasVariableBoundMedia(compiled.html, undefined, compiled.variablesByComp)).toBe(true);
  });

  it("probes an anonymous mount whose default lives in the sub-composition's table entry", async () => {
    const entry = join(projectDir, "index-anonymous-host.html");
    const options = { allowSystemFontCapture: false };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    expect(compiled.videos.map((video) => video.src)).toEqual(["assets/placeholder.mp4"]);
    expect(compiled.variablesByComp).toEqual({ card: { src: "assets/clip.mp4" } });
    expect(hasVariableBoundMedia(compiled.html, undefined, compiled.variablesByComp)).toBe(true);
  });

  it("reads the length and the one sound lane from the clip a variable binds", async () => {
    makeToneClip(join(projectDir, "assets", "tone-3.mp4"), 3);
    makeToneClip(join(projectDir, "assets", "tone-13.mp4"), 13);
    writeFileSync(
      join(projectDir, "bound.html"),
      `<!doctype html><html data-composition-variables='[{"id":"clip","type":"string","default":"assets/tone-3.mp4"}]'><body><main data-composition-id="root" data-start="0" data-width="16" data-height="16"><video id="v" src="assets/tone-3.mp4" data-var-src="clip" data-start="0" data-track-index="0"></video></main></body></html>`,
    );
    const entry = join(projectDir, "bound.html");
    const options = { allowSystemFontCapture: false, variables: { clip: "assets/tone-13.mp4" } };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    expect(compiled.videos.map((v) => [v.src, Math.round(v.end)])).toEqual([
      ["assets/tone-13.mp4", 13],
    ]);
    expect(compiled.audios.map((a) => [a.src, Math.round(a.end)])).toEqual([
      ["assets/tone-13.mp4", 13],
    ]);
  });

  it("binds a declared default when no value is passed, and an audio element the same way", async () => {
    writeFileSync(
      join(projectDir, "audio.html"),
      `<!doctype html><html data-composition-variables='[{"id":"vo","type":"string","default":"assets/tone-13.mp4"}]'><body><main data-composition-id="root" data-start="0" data-width="16" data-height="16"><audio id="a" src="assets/tone-3.mp4" data-var-src="vo" data-start="0" data-track-index="0"></audio></main></body></html>`,
    );
    const entry = join(projectDir, "audio.html");
    const compiled = await compileForRender(projectDir, entry, projectDir, {
      allowSystemFontCapture: false,
    });

    expect(compiled.audios.map((a) => [a.src, Math.round(a.end)])).toEqual([
      ["assets/tone-13.mp4", 13],
    ]);
  });

  it("keeps the authored clip, and says why, when the bound value fails the URL gate", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const entry = join(projectDir, "bound.html");
    const options = { allowSystemFontCapture: false, variables: { clip: "javascript:alert(1)" } };
    const compiled = await compileForRender(projectDir, entry, projectDir, options);

    expect(compiled.videos.map((v) => [v.src, Math.round(v.end)])).toEqual([
      ["assets/tone-3.mp4", 3],
    ]);
    expect(warn.mock.calls.flat().join(" ")).toContain("unsafe URL protocol");
    warn.mockRestore();
  });
});
