import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCachedPass, storePass } from "./checkCache.js";
import type { CheckReport } from "./checkTypes.js";

const PASS = { ok: true, findings: [] } as unknown as CheckReport;
const made: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the check cache", () => {
  it("stores a pass and replays it under the same key", () => {
    const project = temp("hf-check-cache-");
    storePass(project, "key", PASS);
    expect(readCachedPass(project, "key")?.ok).toBe(true);
    expect(readCachedPass(project, "other")).toBeUndefined();
  });

  // A received project can carry a link at the record or at a folder above it.
  it.skipIf(process.platform === "win32").each([
    ["check.json", [".hyperframes", "cache"], "check.json"],
    ["cache", [".hyperframes"], "cache"],
    [".hyperframes", [], ".hyperframes"],
  ])("never writes through a link at %s", (_what, folders, linked) => {
    const project = temp("hf-check-cache-");
    const outside = temp("hf-check-outside-");
    // The link's target holds what the write would land on, at each depth.
    mkdirSync(join(outside, "cache"), { recursive: true });
    for (const file of ["victim", join("cache", "check.json"), "check.json"])
      writeFileSync(join(outside, file), "the person's file");
    mkdirSync(join(project, ...folders), { recursive: true });
    const target = linked === "check.json" ? join(outside, "victim") : outside;
    symlinkSync(target, join(project, ...folders, linked));
    const before = readdirSync(outside, { recursive: true }).sort();

    storePass(project, "key", PASS);

    for (const file of ["victim", join("cache", "check.json"), "check.json"])
      expect(readFileSync(join(outside, file), "utf8")).toBe("the person's file");
    expect(readdirSync(outside, { recursive: true }).sort()).toEqual(before);
  });
});
