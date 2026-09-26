import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realpathSync = Object.assign((path: string) => actual.realpathSync(path), {
    native: () => {
      throw Object.assign(new Error("EISDIR: illegal operation on a directory"), {
        code: "EISDIR",
      });
    },
  });
  return { ...actual, realpathSync, default: { ...actual, realpathSync } };
});

const { isSafePath } = await import("./safePath.js");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("still resolves paths on a volume whose native realpath refuses with EISDIR", () => {
  const base = mkdtempSync(join(tmpdir(), "safepath-eisdir-"));
  dirs.push(base);
  expect(isSafePath(base, join(base, "file.txt"))).toBe(true);
  expect(isSafePath(base, join(tmpdir(), "outside.txt"))).toBe(false);
});
