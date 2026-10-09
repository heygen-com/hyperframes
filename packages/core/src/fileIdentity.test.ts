// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sameFile } from "./fileIdentity.js";

const dirs: string[] = [];
function dir(): string {
  const created = mkdtempSync(join(tmpdir(), "file-identity-"));
  dirs.push(created);
  return created;
}
afterEach(() => {
  for (const created of dirs.splice(0)) rmSync(created, { recursive: true, force: true });
});

describe("file identity", () => {
  it("tells two files apart", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    writeFileSync(join(root, "b"), "b");
    expect(sameFile(join(root, "a"), join(root, "b"))).toBe(false);
  });

  it("knows a hard link is the same file", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    linkSync(join(root, "a"), join(root, "hard"));
    expect(sameFile(join(root, "a"), join(root, "hard"))).toBe(true);
  });

  it("follows a symlink", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    symlinkSync(join(root, "a"), join(root, "link"));
    expect(sameFile(join(root, "a"), join(root, "link"))).toBe(true);
  });

  it("treats a missing path as no file", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    expect(sameFile(join(root, "missing"), join(root, "missing"))).toBe(false);
    expect(sameFile(join(root, "a"), join(root, "missing"))).toBe(false);
  });

  it("is the only place package sources compare inodes", () => {
    const packages = join(import.meta.dirname, "../..");
    // History records persist a number ino and always pair it with the folder's birth time.
    const allowed = new Set(["core/src/fileIdentity.ts", "studio-server/src/history/historyId.ts"]);
    const sources = readdirSync(packages)
      .filter((name) => existsSync(join(packages, name, "src")))
      .flatMap((name) =>
        readdirSync(join(packages, name, "src"), { recursive: true, encoding: "utf8" }).map(
          (path) => `${name}/src/${path.replaceAll("\\", "/")}`,
        ),
      );
    for (const path of allowed) expect(sources).toContain(path);
    const offenders = sources
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !allowed.has(path))
      .filter((path) =>
        /\.ino\b\s*[!=]==?|[!=]==?\s*[\w.?]+\.ino\b/.test(
          readFileSync(join(packages, path), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
