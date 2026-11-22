import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// A volume whose native realpath refuses every path with EISDIR, as some Windows RAM disks do.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const realpath = () =>
    Promise.reject(
      Object.assign(new Error("EISDIR: illegal operation on a directory"), { code: "EISDIR" }),
    );
  return { ...actual, realpath, default: { ...actual, realpath } };
});

const { isPrivateProjectFileOff } = await import("./projectDisk.js");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  // fails without the fix: native realpath failed at every level, so the check compared the link's own spelling and
  // served the project's .env under an innocuous name.
  it("refuses an innocuously named link to a private file on a volume whose native realpath refuses", async () => {
    const project = mkdtempSync(join(tmpdir(), "private-eisdir-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    writeFileSync(join(project, ".env"), "KEY=1");
    symlinkSync(join(project, ".env"), join(project, "assets", "notes.txt"));
    expect(await isPrivateProjectFileOff(project, join(project, "assets", "notes.txt"))).toBe(true);
  });
});
