import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Atomically allocate an owner-only preview directory under the OS temp root.
 *
 * `mkdtemp` rather than a name built from `Date.now()`: it picks the random
 * suffix and creates the directory 0700 in one syscall, so nothing can
 * pre-create or symlink the path between choosing the name and making it.
 */
export function createCatalogPreviewTempDir(itemName: string): string {
  return mkdtempSync(join(tmpdir(), `hf-catalog-${itemName}-`));
}
