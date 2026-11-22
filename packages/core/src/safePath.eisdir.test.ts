import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const realpath = () =>
    Promise.reject(
      Object.assign(new Error("EISDIR: illegal operation on a directory"), { code: "EISDIR" }),
    );
  return { ...actual, realpath, default: { ...actual, realpath } };
});

const { isSafePath, realpathOff } = await import("./safePath.js");
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

// fails without the fix: off the event loop a link on such a volume never resolved, so the private-file check read it
// under its innocuous spelling.
// Windows makes a link only with the right to (an admin, or Developer Mode); without it these cases can't be set up,
// and where a run must cover them (HF_LINKS_REQUIRED) that fails instead of skipping.
const canLink = (() => {
  const dir = mkdtempSync(join(tmpdir(), "link-probe-"));
  try {
    symlinkSync(join(dir, "a"), join(dir, "b"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
if (!canLink && process.env.HF_LINKS_REQUIRED)
  throw new Error(
    "this machine cannot make links, which these tests need (HF_LINKS_REQUIRED is set)",
  );

it.skipIf(!canLink)(
  "resolves a link off the event loop on a volume whose native realpath refuses with EISDIR",
  async () => {
    const base = mkdtempSync(join(tmpdir(), "safepath-eisdir-"));
    dirs.push(base);
    writeFileSync(join(base, ".env"), "KEY=1");
    symlinkSync(join(base, ".env"), join(base, "notes.txt"));
    expect(await realpathOff(join(base, "notes.txt"))).toBe(realpathSync(join(base, ".env")));
  },
);
