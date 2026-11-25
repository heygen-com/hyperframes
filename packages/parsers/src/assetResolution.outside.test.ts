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
const { resolveProjectRelativeSrc } = await import("./assetResolution.js");

describe("a media src that climbs out of the project", () => {
  it("is never looked for outside it", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-src-outside-"));
    const projectDir = join(root, "project");
    try {
      mkdirSync(projectDir);
      writeFileSync(join(root, "outside.mov"), "x");
      touched.length = 0;
      resolveProjectRelativeSrc("../outside.mov", projectDir, projectDir);
      expect(touched.filter((path) => !path.startsWith(projectDir))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
