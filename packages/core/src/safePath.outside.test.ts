import { describe, expect, it, vi } from "vitest";

const touched = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async () => {
  const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const watched =
    <A extends unknown[], R>(call: (path: string, ...rest: A) => R) =>
    (path: string, ...rest: A): R => {
      touched.push(String(path));
      return call(path, ...rest);
    };
  const realpathSync = Object.assign(watched(fs.realpathSync), {
    native: watched(fs.realpathSync.native),
  });
  const mocked = {
    ...fs,
    existsSync: watched(fs.existsSync),
    lstatSync: watched(fs.lstatSync),
    statSync: watched(fs.statSync),
    realpathSync,
  };
  return { ...mocked, default: mocked };
});

const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { isSafePath } = await import("./safePath.js");

describe("isSafePath on a path spelled outside the base", () => {
  it("answers no without looking at it, and still looks inside", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-safe-path-outside-"));
    const projectDir = join(root, "project");
    const outside = join(root, "outside.mov");
    try {
      mkdirSync(projectDir);
      writeFileSync(outside, "x");
      writeFileSync(join(projectDir, "clip.mov"), "x");
      touched.length = 0;
      expect(isSafePath(projectDir, outside)).toBe(false);
      expect(touched.filter((path) => path.includes("outside.mov"))).toEqual([]);
      expect(isSafePath(projectDir, join(projectDir, "clip.mov"))).toBe(true);
      expect(isSafePath(projectDir, join(projectDir, "..intro.mp4"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
