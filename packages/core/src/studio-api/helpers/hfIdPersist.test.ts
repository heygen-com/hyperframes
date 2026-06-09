import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeHfIds, persistHfIdsIfNeeded } from "./hfIdPersist.js";

describe("normalizeHfIds", () => {
  it("marks changed=true and adds data-hf-id to all body elements when untagged", () => {
    const raw = `<!doctype html><html><body><div><p>hello</p></div></body></html>`;
    const { html, changed } = normalizeHfIds(raw);
    expect(changed).toBe(true);
    expect(html).toContain('data-hf-id="hf-');
    const matches = html.match(/data-hf-id="hf-[a-z0-9]{4}"/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it("marks changed=false for already-normalized HTML (idempotent round-trip)", () => {
    const raw = `<!doctype html><html><body><div><p>hello</p></div></body></html>`;
    const first = normalizeHfIds(raw).html;
    const { html, changed } = normalizeHfIds(first);
    expect(changed).toBe(false);
    expect(html).toBe(first);
  });
});

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

  it("returned id matches id written to disk (serve-time == persist-time invariant)", () => {
    const raw = `<!doctype html><html><body><span>text</span></body></html>`;
    const file = tmpFile(raw);
    const result = persistHfIdsIfNeeded(file, raw);
    const onDisk = readFileSync(file, "utf-8");
    expect(result).toBe(onDisk);
  });
});
