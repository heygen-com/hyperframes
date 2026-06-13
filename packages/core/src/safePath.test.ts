import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafePath, resolveWithinProject } from "./safePath.js";

describe("isSafePath", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  // Mirror the repo convention (preview.test.ts): non-symlink-privileged Windows
  // runners can't create symlinks — skip those cases rather than crash the suite.
  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  it("allows the base directory itself", () => {
    const base = tmpDir("safepath-base-");
    expect(isSafePath(base, base)).toBe(true);
  });

  it("allows an existing nested path inside base", () => {
    const base = tmpDir("safepath-base-");
    const file = join(base, "assets", "logo.png");
    mkdirSync(join(base, "assets"));
    writeFileSync(file, "x");
    expect(isSafePath(base, file)).toBe(true);
  });

  it("allows a not-yet-existing write target inside base", () => {
    const base = tmpDir("safepath-base-");
    // Neither the dir nor the file exist yet — the create/write case.
    expect(isSafePath(base, join(base, "new", "deep", "file.txt"))).toBe(true);
  });

  it("rejects a `..` traversal that escapes base", () => {
    const base = tmpDir("safepath-base-");
    expect(isSafePath(base, join(base, "..", "..", "etc", "passwd"))).toBe(false);
  });

  it("rejects an existing file reached through a symlink that points outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    const secret = join(external, "secret.txt");
    writeFileSync(secret, "top secret");
    // project/link -> external/  (the classic in-project symlink escape)
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(isSafePath(base, join(base, "link", "secret.txt"))).toBe(false);
  });

  it("rejects a not-yet-existing write target whose parent is a symlink to outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    // base/link -> external; writing base/link/evil.txt would land in external.
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(isSafePath(base, join(base, "link", "evil.txt"))).toBe(false);
  });

  it("rejects a file symlink inside base that targets a file outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    const secret = join(external, "secret.txt");
    writeFileSync(secret, "top secret");
    if (!tryCreateSymlink(secret, join(base, "passwd"), "file")) return;
    expect(isSafePath(base, join(base, "passwd"))).toBe(false);
  });

  it("allows a symlink inside base that points to another location inside base", () => {
    const base = tmpDir("safepath-base-");
    const realDir = join(base, "real");
    mkdirSync(realDir);
    writeFileSync(join(realDir, "in.txt"), "x");
    if (!tryCreateSymlink(realDir, join(base, "alias"), "dir")) return;
    expect(isSafePath(base, join(base, "alias", "in.txt"))).toBe(true);
  });

  it("canonicalizes base too: a symlinked base path still admits in-base targets", () => {
    // Guards against one-sided realpath: when base is reached via a symlink
    // (as on macOS where tmpdir lives under /var -> /private/var), an in-base
    // target must still be accepted.
    const realBase = tmpDir("safepath-realbase-");
    const linkParent = tmpDir("safepath-linkparent-");
    const baseLink = join(linkParent, "baseLink");
    if (!tryCreateSymlink(realBase, baseLink, "dir")) return;
    writeFileSync(join(realBase, "file.txt"), "x");
    expect(isSafePath(baseLink, join(baseLink, "file.txt"))).toBe(true);
  });

  it("fails closed when the base directory does not exist", () => {
    const base = join(tmpdir(), "safepath-does-not-exist-zzz", "nope");
    expect(isSafePath(base, join(base, "file.txt"))).toBe(false);
  });
});

describe("resolveWithinProject", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  it("returns the resolved absolute path for an in-project relative path", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "assets/logo.png")).toBe(join(base, "assets", "logo.png"));
  });

  it("returns the resolved path for a not-yet-existing write target", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "new/deep/file.txt")).toBe(
      join(base, "new", "deep", "file.txt"),
    );
  });

  it("returns null for a `..` traversal that escapes the project", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "../../etc/passwd")).toBeNull();
  });

  it("returns null when the path resolves outside via an in-project symlink", () => {
    const base = tmpDir("rwp-base-");
    const external = tmpDir("rwp-external-");
    writeFileSync(join(external, "secret.txt"), "top secret");
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(resolveWithinProject(base, "link/secret.txt")).toBeNull();
  });
});
