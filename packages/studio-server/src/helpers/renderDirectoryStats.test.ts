import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRenderDirectoryStats } from "./renderDirectoryStats";

describe("readRenderDirectoryStats", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function sequenceDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-render-stats-"));
    roots.push(dir);
    return dir;
  }

  it("counts frame_NNNNNN.png files, sums every file into size, and detects audio.m4a", () => {
    const dir = sequenceDir();
    writeFileSync(join(dir, "frame_000000.png"), "aaaa");
    writeFileSync(join(dir, "frame_000001.png"), "bb");
    writeFileSync(join(dir, "frame_1.png"), "x");
    writeFileSync(join(dir, "audio.m4a"), "ccc");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested", "frame_000002.png"), "ignored");

    expect(readRenderDirectoryStats(dir)).toEqual({ frameCount: 2, size: 10, audioSidecar: true });
  });

  it("reports audioSidecar: false when audio.m4a is absent", () => {
    const dir = sequenceDir();
    writeFileSync(join(dir, "frame_000000.png"), "a");
    expect(readRenderDirectoryStats(dir)).toEqual({ frameCount: 1, size: 1, audioSidecar: false });
  });

  it("throws for a path that is not a directory", () => {
    const dir = sequenceDir();
    const file = join(dir, "render.mp4");
    writeFileSync(file, "x");
    expect(() => readRenderDirectoryStats(file)).toThrow();
  });
});
