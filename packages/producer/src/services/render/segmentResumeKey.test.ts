import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSegmentResumeKey } from "./segmentResumeKey.js";

describe("loadSegmentResumeKey", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates one private key and returns it on every later load", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-resume-key-"));
    const path = join(dir, "config", "segment-resume.key");
    const first = loadSegmentResumeKey(path);
    expect(first?.length).toBe(32);
    expect(loadSegmentResumeKey(path)).toEqual(first);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("gives each install its own key", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-resume-key-"));
    const a = loadSegmentResumeKey(join(dir, "a", "segment-resume.key"));
    const b = loadSegmentResumeKey(join(dir, "b", "segment-resume.key"));
    expect(a).not.toBeNull();
    expect(a).not.toEqual(b);
  });

  it("returns null when the config folder cannot be created", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-resume-key-"));
    const blocker = join(dir, "not-a-folder");
    writeFileSync(blocker, "");
    expect(loadSegmentResumeKey(join(blocker, "segment-resume.key"))).toBeNull();
  });
});
