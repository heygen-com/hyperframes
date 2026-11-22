import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPrivateProjectFileOff } from "./projectDisk.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "private-off-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  return dir;
}

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

describe.skipIf(!canLink)("the off-loop private-file check", () => {
  // fails without the fix: a path that is there but will not resolve (a link loop) was judged by its own spelling.
  it("refuses a path that is there but will not resolve", async () => {
    const dir = project();
    symlinkSync(join(dir, "assets", "b.txt"), join(dir, "assets", "a.txt"));
    symlinkSync(join(dir, "assets", "a.txt"), join(dir, "assets", "b.txt"));
    expect(await isPrivateProjectFileOff(dir, join(dir, "assets", "a.txt"))).toBe(true);
  });

  it("allows a plain file and a file not there yet, and refuses a link to a private file", async () => {
    const dir = project();
    writeFileSync(join(dir, "assets", "logo.txt"), "x");
    writeFileSync(join(dir, ".env"), "KEY=1");
    symlinkSync(join(dir, ".env"), join(dir, "assets", "notes.txt"));
    expect(await isPrivateProjectFileOff(dir, join(dir, "assets", "logo.txt"))).toBe(false);
    expect(await isPrivateProjectFileOff(dir, join(dir, "assets", "new.txt"))).toBe(false);
    expect(await isPrivateProjectFileOff(dir, join(dir, "assets", "notes.txt"))).toBe(true);
  });
});
