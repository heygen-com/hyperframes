import { statSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCatalogPreviewTempDir } from "./catalog-preview-temp.js";

describe("catalog preview temporary directory", () => {
  it("atomically creates unique owner-only directories", () => {
    const first = createCatalogPreviewTempDir("thread-message-stack");
    const second = createCatalogPreviewTempDir("thread-message-stack");
    try {
      assert.notEqual(first, second);
      assert.match(basename(first), /^hf-catalog-thread-message-stack-/);
      assert.equal(statSync(first).mode & 0o777, 0o700);
      assert.equal(statSync(second).mode & 0o777, 0o700);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
