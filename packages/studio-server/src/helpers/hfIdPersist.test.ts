import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistHfIdsIfNeeded, stampFileHfIds } from "./hfIdPersist.js";

describe("persistHfIdsIfNeeded", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hfid-test-"));
    tmpDirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, content, "utf-8");
    return file;
  }

  it("writes data-hf-id to disk when source is untagged", () => {
    const raw = `<!doctype html><html><body><div>hello</div></body></html>`;
    const file = tmpFile(raw);
    const returned = persistHfIdsIfNeeded(file, raw);
    expect(returned).toContain('data-hf-id="hf-');
    const onDisk = readFileSync(file, "utf-8");
    expect(onDisk).toContain('data-hf-id="hf-');
    expect(onDisk).toBe(returned);
  });

  it("does not rewrite disk when source is already tagged", () => {
    const raw = `<!doctype html><html><body><div>hello</div></body></html>`;
    const file = tmpFile(raw);
    const tagged = persistHfIdsIfNeeded(file, raw);
    const diskAfterFirst = readFileSync(file, "utf-8");
    const returned2 = persistHfIdsIfNeeded(file, tagged);
    expect(returned2).toBe(tagged);
    expect(readFileSync(file, "utf-8")).toBe(diskAfterFirst);
  });

  it("does not rewrite when source is already tagged with non-standard HTML formatting", () => {
    // Single-quoted attrs would cause a false-positive write under string-equality
    // change detection; count-based detection handles this correctly.
    const alreadyTagged = `<!doctype html><html><body><div data-hf-id='hf-ab12'>hello</div></body></html>`;
    const file = tmpFile(alreadyTagged);
    persistHfIdsIfNeeded(file, alreadyTagged);
    expect(readFileSync(file, "utf-8")).toBe(alreadyTagged);
  });

  it("returned id matches id written to disk (serve-time == persist-time invariant)", () => {
    const raw = `<!doctype html><html><body><span>text</span></body></html>`;
    const file = tmpFile(raw);
    const result = persistHfIdsIfNeeded(file, raw);
    const onDisk = readFileSync(file, "utf-8");
    expect(result).toBe(onDisk);
  });

  it("skips write if file was modified concurrently (TOCTOU guard)", () => {
    const old = `<!doctype html><html><body><div>original</div></body></html>`;
    const newer = `<!doctype html><html><body><div>modified by user</div></body></html>`;
    // Disk has newer content — simulates a concurrent save after the server read old.
    const file = tmpFile(newer);
    const returned = persistHfIdsIfNeeded(file, old);
    // Serve-time HTML gets ids based on what we read.
    expect(returned).toContain('data-hf-id="hf-');
    // Disk must not be overwritten — user's concurrent save is preserved.
    expect(readFileSync(file, "utf-8")).toBe(newer);
  });
});

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
