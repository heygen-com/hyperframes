import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLocalModel } from "../packages/cli/src/registry/localModel.ts";
import { generateRegistryManifest } from "./generate-registry-items.ts";
import { runAsCommand } from "./entrypoint.ts";

export async function generateCatalog(): Promise<void> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  generateRegistryManifest(root);
  if (!(await ensureLocalModel()))
    throw new Error("Could not download the pinned catalog embedding model.");
  const run = (script: string) => execFileSync("bun", [script], { cwd: root, stdio: "inherit" });
  run("scripts/catalog/build-local-vectors.ts");
  // Rebuild the entire payload tree so removed items and orphaned assets disappear.
  rmSync(join(root, "docs/public/catalog"), { recursive: true, force: true });
  run("scripts/generate-catalog-payloads.ts");
  run("scripts/generate-catalog-pages.ts");
  run("scripts/sync-docs-catalog.mjs");
}

runAsCommand(import.meta.url, generateCatalog);
