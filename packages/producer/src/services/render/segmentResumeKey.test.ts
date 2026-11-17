import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  it("replaces an empty or short key file with a usable one", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-resume-key-"));
    const path = join(dir, "segment-resume.key");
    writeFileSync(path, "short");
    const key = loadSegmentResumeKey(path);
    expect(key?.length).toBe(32);
    expect(readFileSync(path)).toEqual(key);
  });

  it("gives renders that create the key at the same time one shared key", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-resume-key-"));
    mkdirSync(join(dir, "config"));
    const path = join(dir, "config", "segment-resume.key");
    const moduleUrl = new URL("./segmentResumeKey.ts", import.meta.url).href;
    const script = `const { loadSegmentResumeKey } = await import(${JSON.stringify(moduleUrl)});
process.stdout.write(loadSegmentResumeKey(${JSON.stringify(path)})?.toString("hex") ?? "none");`;
    const runOne = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("bun", ["-e", script], {
          cwd: fileURLToPath(new URL(".", import.meta.url)),
        });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        child.on("error", reject);
        child.on("close", () => resolve(out));
      });
    const keys = await Promise.all(Array.from({ length: 8 }, runOne));
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(keys).size).toBe(1);
    expect(readFileSync(path).toString("hex")).toBe(keys[0]);
  }, 30_000);
});
