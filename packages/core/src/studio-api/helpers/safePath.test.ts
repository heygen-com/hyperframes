import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkDir } from "./safePath";

const tempDirs: string[] = [];

afterEach(() => {
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
});
