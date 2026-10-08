import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashProjectDir } from "./projectHash.js";

const projects: string[] = [];
function project(files: Record<string, string | Buffer>): string {
  const directory = mkdtempSync(join(tmpdir(), "hf-project-hash-"));
  projects.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}
afterEach(() => {
  for (const directory of projects.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("hashProjectDir", () => {
  it("distinguishes file content from another file path", () => {
    const combined = project({ a: "bc\0def" });
    const split = project({ a: "", bc: "def" });
    expect(hashProjectDir(combined)).not.toBe(hashProjectDir(split));
  });

  it("distinguishes binary content from multiple file records", () => {
    const content = Buffer.from([0, 255, 128, 1]);
    const combined = project({ a: Buffer.concat([Buffer.from("asset\0"), content]) });
    const split = project({ a: "", asset: content });
    expect(hashProjectDir(combined)).not.toBe(hashProjectDir(split));
  });

  it("is stable across directory locations and file creation order", () => {
    const first = project({ "nested/b": "雪😀", a: "" });
    const second = project({ a: "", "nested/b": "雪😀" });
    expect(hashProjectDir(first)).toMatch(/^[a-f0-9]{16}$/);
    expect(hashProjectDir(first)).toBe(hashProjectDir(second));
  });

  it("includes paths and empty files", () => {
    expect(hashProjectDir(project({ a: "same" }))).not.toBe(hashProjectDir(project({ b: "same" })));
    expect(hashProjectDir(project({}))).not.toBe(hashProjectDir(project({ a: "" })));
  });

  it("ignores skipped top-level directories", () => {
    const base = { "index.html": "same" };
    const first = project(base);
    const second = project({ ...base, "node_modules/package/ignored": "different" });
    expect(hashProjectDir(first)).toBe(hashProjectDir(second));
  });

  it("includes nested directories with a skipped top-level name", () => {
    const first = project({ "assets/node_modules/content": "first" });
    const second = project({ "assets/node_modules/content": "second" });
    expect(hashProjectDir(first)).not.toBe(hashProjectDir(second));
  });
});
