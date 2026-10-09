// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
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

// Number-mode stats report one identity for every path, as Windows file ids above 2^53 can.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: { bigint?: boolean }) => {
    const stats = actual.statSync(path, options as never);
    return options?.bigint || !stats ? stats : { ...stats, dev: 1, ino: 2 ** 53 };
  }) as typeof actual.statSync;
  return { ...actual, statSync };
});

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
  it("tells two files apart even when their number inodes collide", () => {
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
