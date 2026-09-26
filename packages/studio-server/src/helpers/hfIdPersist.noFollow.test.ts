import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const swap = vi.hoisted(() => ({ to: "" }));
vi.mock("./atomicFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomicFile.js")>();
  const fs = await import("node:fs");
  return {
    ...actual,
    // A link to an outside file swapped in after the stamp's own no-follow checks.
    replaceFileAtomically: (...args: Parameters<typeof actual.replaceFileAtomically>) => {
      fs.rmSync(args[0]);
      fs.symlinkSync(swap.to, args[0]);
      return actual.replaceFileAtomically(...args);
    },
  };
});

const { stampFileHfIds } = await import("./hfIdPersist.js");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Windows needs a privilege to create symlinks.
it.skipIf(process.platform === "win32")(
  "stamps over a symlink swapped in at the path without writing through it",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-stamp-nofollow-"));
    dirs.push(dir);
    swap.to = join(dir, "outside.html");
    writeFileSync(swap.to, "outside");
    const file = join(dir, "index.html");
    writeFileSync(file, `<div class="clip"><p>Hi</p></div>`);

    stampFileHfIds(file);

    expect(readFileSync(swap.to, "utf-8")).toBe("outside");
    expect(readFileSync(file, "utf-8")).toContain("data-hf-id");
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
  },
);
