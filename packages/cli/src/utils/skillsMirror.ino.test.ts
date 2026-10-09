import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Number-mode stats report one identity for every path, as Windows file ids above 2^53 can.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const statSync = ((path: string, options?: { bigint?: boolean }) =>
    options?.bigint
      ? actual.statSync(path, options as never)
      : { ...actual.statSync(path), dev: 1, ino: 2 ** 53 }) as typeof actual.statSync;
  return { ...actual, statSync };
});

const { mirrorGlobalSkills } = await import("./skillsMirror.js");

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("mirrorGlobalSkills on colliding number inodes", () => {
  it("still mirrors an agent whose dir only collides with the store in number precision", () => {
    const home = mkdtempSync(join(tmpdir(), "mirror-ino-"));
    homes.push(home);
    mkdirSync(join(home, ".claude", "skills", "hyperframes"), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "hyperframes", "SKILL.md"), "# hf\n");
    mkdirSync(join(home, ".config", "goose"), { recursive: true });

    const { mirrored, skipped } = mirrorGlobalSkills({
      skills: ["hyperframes"],
      home,
      platform: "linux",
      env: {},
    });
    expect(skipped).toEqual([]);
    expect(mirrored.map((m) => m.agent)).toContain("goose");
  });
});
