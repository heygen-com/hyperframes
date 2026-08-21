import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Absolute path to the Terraform module shipped with this adapter.
 *
 * This module is built as `dist/terraform.js`, preserving the same one-level
 * relationship to the package-owned `terraform/` directory as the source
 * file. Consumers should use this API instead of resolving package.json,
 * which is not a stable public subpath.
 */
export function getTerraformModuleDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "terraform");
}
