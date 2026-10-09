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
  const collide = <T extends (...args: never[]) => unknown>(real: T) =>
    ((target: never, options?: { bigint?: boolean }) =>
      options?.bigint
        ? real(target, options as never)
        : { ...(real(target) as object), dev: 1, ino: 2 ** 53 }) as unknown as T;
  return { ...actual, statSync: collide(actual.statSync), lstatSync: collide(actual.lstatSync) };
});

const { fileIdentity, sameFile } = await import("./fileIdentity.js");

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
    expect(sameFile(join(root, "a"), join(root, "b"), false)).toBe(false);
  });

  it("knows a hard link is the same file", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    linkSync(join(root, "a"), join(root, "hard"));
    expect(sameFile(join(root, "a"), join(root, "hard"))).toBe(true);
  });

  it("follows a symlink unless asked not to", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    symlinkSync(join(root, "a"), join(root, "link"));
    expect(sameFile(join(root, "a"), join(root, "link"))).toBe(true);
    expect(sameFile(join(root, "a"), join(root, "link"), false)).toBe(false);
  });

  it("treats a missing path as no file", () => {
    const root = dir();
    writeFileSync(join(root, "a"), "a");
    expect(fileIdentity(join(root, "missing"))).toBeUndefined();
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
          (path) => `${name}/src/${path}`,
        ),
      );
    expect(sources).toContain("core/src/fileIdentity.ts");
    const offenders = sources
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !allowed.has(path))
      .filter((path) =>
        /\.ino\s*[!=]==|[!=]==\s*[\w.?]+\.ino\b/.test(readFileSync(join(packages, path), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
