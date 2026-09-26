import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ followLinks?: boolean } | undefined>);
vi.mock("./atomicFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./atomicFile.js")>();
  return {
    ...actual,
    replaceFileAtomically: (...args: Parameters<typeof actual.replaceFileAtomically>) => {
      calls.push(args[4]);
      return actual.replaceFileAtomically(...args);
    },
  };
});

const { stampFileHfIds } = await import("./hfIdPersist.js");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("stamps with a write that never follows a symlink swapped in at the path", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-stamp-nofollow-"));
  dirs.push(dir);
  const file = join(dir, "index.html");
  writeFileSync(file, `<div class="clip"><p>Hi</p></div>`);

  stampFileHfIds(file);

  expect(calls).toEqual([{ followLinks: false }]);
});
