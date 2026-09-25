import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampFileHfIds } from "./hfIdPersist.js";

describe("stampFileHfIds", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    const file = join(dir, "scene.html");
    writeFileSync(file, content, "utf-8");
    return file;
  }

  it("stamps ids and writes back through the same fd", () => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);
    const returned = stampFileHfIds(file);
    expect(returned).toContain('data-hf-id="hf-');
    expect(readFileSync(file, "utf-8")).toBe(returned);
  });

  it("replaces the stamped file and removes its temporary sibling", () => {
    const file = tmpFile(`<div class="clip" data-start="0" data-end="3">Hi</div>`);

    const returned = stampFileHfIds(file);

    expect(readFileSync(file, "utf-8")).toBe(returned);
    expect(readdirSync(file.replace(/\/[^/]+$/, ""))).toEqual(["scene.html"]);
  });

  it("does not rewrite an already-stamped file", () => {
    const file = tmpFile(`<div data-hf-id="hf-keep">Hi</div>`);
    const before = readFileSync(file, "utf-8");
    const returned = stampFileHfIds(file);
    expect(returned).toContain('data-hf-id="hf-keep"');
    expect(readFileSync(file, "utf-8")).toBe(before); // byte-identical, no write
  });

  it("returns null for a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    expect(stampFileHfIds(join(dir, "nope.html"))).toBeNull();
  });

  it("returns null for a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "hfid-stamp-test-"));
    tmpDirs.push(dir);
    expect(stampFileHfIds(dir)).toBeNull();
  });
});
