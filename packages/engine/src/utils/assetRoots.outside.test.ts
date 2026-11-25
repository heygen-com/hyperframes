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
const { assetRootsRefusal } = await import("./assetRoots.js");

describe("a media file outside the project", () => {
  it("is refused without being looked at", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-asset-roots-outside-"));
    const projectDir = join(root, "project");
    const outside = join(root, "outside.mov");
    try {
      mkdirSync(projectDir);
      writeFileSync(outside, "x");
      touched.length = 0;
      expect(assetRootsRefusal(outside, [projectDir])).toBe("outside the project folder");
      expect(touched.filter((path) => path.includes("outside.mov"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
