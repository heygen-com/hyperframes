import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash } from "./receivedContent.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("contentHash", () => {
  it("skips a large file that names no others, and still hashes a large script", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-received-content-"));
    const large = Buffer.alloc(16 * 1024 * 1024 + 1, "x");
    writeFileSync(join(dir, "archive.zip"), large);
    writeFileSync(join(dir, "bundle.js"), large);
    writeFileSync(join(dir, "small.zip"), "x");
    expect(contentHash(join(dir, "archive.zip"))).toBeNull();
    expect(contentHash(join(dir, "bundle.js"))).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(join(dir, "small.zip"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
