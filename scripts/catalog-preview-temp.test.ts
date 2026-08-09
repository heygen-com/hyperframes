import { statSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { createCatalogPreviewTempDir } from "./catalog-preview-temp.js";

describe("catalog preview temporary directory", () => {
  it("atomically creates unique owner-only directories", () => {
    const first = createCatalogPreviewTempDir("thread-message-stack");
    const second = createCatalogPreviewTempDir("thread-message-stack");
    try {
      expect(first).not.toBe(second);
      expect(basename(first)).toMatch(/^hf-catalog-thread-message-stack-/);
      expect(statSync(first).mode & 0o777).toBe(0o700);
      expect(statSync(second).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
