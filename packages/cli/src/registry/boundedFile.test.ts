import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { readBoundedRegistryFile } from "./boundedFile.js";
it("reads regular files up to the bound and rejects oversized or non-file cache entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-cache-bound-"));
  try {
    const path = join(dir, "cache");
    writeFileSync(path, "1234");
    expect(readBoundedRegistryFile(path, 4).toString()).toBe("1234");
    expect(() => readBoundedRegistryFile(path, 3)).toThrow(/limit/);
    expect(() => readBoundedRegistryFile(dir, 100)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
