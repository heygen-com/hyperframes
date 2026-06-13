import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupPathForResponse, snapshotBeforeWrite } from "./backupJournal";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-backup-journal-"));
  tempDirs.push(projectDir);
  return projectDir;
}

describe("snapshotBeforeWrite", () => {
  it("copies the current file bytes before overwrite", () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    const file = join(projectDir, "compositions", "scene.html");
    writeFileSync(file, "before");

    const result = snapshotBeforeWrite(projectDir, file);
    writeFileSync(file, "after");

    expect(result.backupPath && existsSync(result.backupPath)).toBe(true);
    expect(readFileSync(result.backupPath!, "utf-8")).toBe("before");
    expect(backupPathForResponse(projectDir, result.backupPath)).toMatch(
      /^\.hyperframes\/backup\//,
    );
  });

  it("creates backups for zero-byte files", () => {
    const projectDir = createProjectDir();
    const file = join(projectDir, "empty.html");
    writeFileSync(file, "");

    const result = snapshotBeforeWrite(projectDir, file);

    expect(result.backupPath && existsSync(result.backupPath)).toBe(true);
    expect(readFileSync(result.backupPath!, "utf-8")).toBe("");
  });

  it("prunes older backups for the same file", () => {
    const projectDir = createProjectDir();
    const file = join(projectDir, "index.html");
    writeFileSync(file, "0");

    for (let i = 1; i <= 5; i += 1) {
      writeFileSync(file, String(i));
      snapshotBeforeWrite(projectDir, file, { keepPerFile: 3 });
    }

    expect(readdirSync(join(projectDir, ".hyperframes", "backup"))).toHaveLength(3);
  });

  it("does not prune backups for paths with colliding sanitized names", () => {
    const projectDir = createProjectDir();
    const first = join(projectDir, "My File.html");
    const second = join(projectDir, "My_File.html");
    writeFileSync(first, "space");
    writeFileSync(second, "underscore");

    snapshotBeforeWrite(projectDir, first, { keepPerFile: 1 });
    snapshotBeforeWrite(projectDir, second, { keepPerFile: 1 });

    const backups = readdirSync(join(projectDir, ".hyperframes", "backup"));
    expect(backups).toHaveLength(2);
    expect(
      backups
        .map((name) => readFileSync(join(projectDir, ".hyperframes", "backup", name), "utf-8"))
        .sort(),
    ).toEqual(["space", "underscore"]);
  });
});
