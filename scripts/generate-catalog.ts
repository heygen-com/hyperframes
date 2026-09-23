import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";
import { writeRegistryManifest } from "./generate-registry-items.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

export const GENERATED_CATALOG_PATHS = [
  "registry/registry.json",
  "docs/catalog/blocks",
  "docs/catalog/components",
  "docs/public/catalog-index.json",
  "docs/snippets/catalog-gallery-data.mdx",
  "docs/docs.json",
] as const;

export function generateCatalog(root = repoRoot): void {
  writeRegistryManifest(root);
  execFileSync(
    process.execPath,
    ["--import", "tsx", join(scriptsDir, "generate-catalog-pages.ts")],
    {
      cwd: repoRoot,
      env: { ...process.env, CATALOG_REPO_ROOT: root },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  execFileSync(process.execPath, [join(scriptsDir, "sync-docs-catalog.mjs"), join(root, "docs")], {
    cwd: repoRoot,
    env: { ...process.env, CATALOG_REPO_ROOT: root },
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log("Registry index, catalog pages, gallery data and navigation regenerated.");
}

runAsCommand(import.meta.url, async () => generateCatalog());
