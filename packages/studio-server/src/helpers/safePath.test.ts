// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walkDir } from "./safePath";

const hooks = vi.hoisted(() => ({ unreadable: new Map<string, string>() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    readdirSync: ((dir: string, ...rest: unknown[]) => {
      const code = hooks.unreadable.get(dir);
      if (code) throw Object.assign(new Error(`${code}: ${dir}`), { code });
      return (fs.readdirSync as (...args: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync,
  };
});

const tempDirs: string[] = [];

afterEach(() => {
  hooks.unreadable.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-safe-path-"));
  tempDirs.push(projectDir);
  return projectDir;
}

describe("walkDir", () => {
  it("hides internal HyperFrames backup files from project listings", () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, ".hyperframes", "backup"), { recursive: true });
    mkdirSync(join(projectDir, ".hyperframes", "examples"), { recursive: true });
    mkdirSync(join(projectDir, ".cache", "examples"), { recursive: true });
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(join(projectDir, ".hyperframes", "backup", "snapshot.html"), "backup");
    writeFileSync(join(projectDir, ".hyperframes", "examples", "preset.html"), "preset");
    writeFileSync(join(projectDir, ".cache", "examples", "preset.html"), "preset");
    writeFileSync(join(projectDir, "compositions", "scene.html"), "scene");

    const files = walkDir(projectDir);
    expect(files).toContain(".cache/examples/preset.html");
    expect(files).toContain(".hyperframes/examples/preset.html");
    expect(files).toContain("compositions/scene.html");
    expect(files).not.toContain(".hyperframes/backup/snapshot.html");
  });

  it.each(["EACCES", "ENOENT"])("skips a subfolder whose listing fails with %s", (code) => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "locked"));
    mkdirSync(join(projectDir, "compositions"));
    writeFileSync(join(projectDir, "locked", "hidden.html"), "hidden");
    writeFileSync(join(projectDir, "compositions", "scene.html"), "scene");
    writeFileSync(join(projectDir, "index.html"), "root");
    hooks.unreadable.set(join(projectDir, "locked"), code);

    expect(walkDir(projectDir).sort()).toEqual(["compositions/scene.html", "index.html"]);
  });

  it("still throws when the project folder itself cannot be listed", () => {
    const projectDir = createProjectDir();
    hooks.unreadable.set(projectDir, "EACCES");

    expect(() => walkDir(projectDir)).toThrow("EACCES");
  });
});
