import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Atomically allocate an owner-only preview directory under the OS temp root. */
export function createCatalogPreviewTempDir(itemName: string): string {
  return mkdtempSync(join(tmpdir(), `hf-catalog-${itemName}-`));
}
