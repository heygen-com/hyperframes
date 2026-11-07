#!/usr/bin/env tsx
/**
 * Mirror JSON Schemas from `packages/core/schemas/` into `docs/schema/` so
 * Mintlify serves them at `https://hyperframes.heygen.com/schema/*`. The core
 * copies stay authoritative — they're exported from `@hyperframes/core` for
 * npm consumers — and this script is the single contract that prevents the
 * docs mirror from drifting.
 *
 * Usage:
 *   bun run sync-schemas         # copy core → docs
 *   bun run sync-schemas --check # exit non-zero if copies are stale (CI)
 *
 * `docs/schema/hyperframes.json` and `docs/schema/hf-render-sidecar.json` are
 * authored directly in docs (no source in core), so this script skips them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_DIR = join(ROOT, "packages/core/schemas");
const TARGET_DIR = join(ROOT, "docs/schema");
const MIRRORED = ["registry.json", "registry-item.json"];

function main() {
  const checkOnly = process.argv.includes("--check");
  let drift = 0;

  for (const name of MIRRORED) {
    const source = readFileSync(join(SOURCE_DIR, name), "utf-8");
    const targetPath = join(TARGET_DIR, name);
    const target = (() => {
      try {
        return readFileSync(targetPath, "utf-8");
      } catch {
        return null;
      }
    })();

    if (target === source) {
      console.log(`  ✓ ${name} in sync`);
      continue;
    }

    drift++;
    if (checkOnly) {
      console.error(`  ✗ ${name} out of sync (run \`bun run sync-schemas\` to fix)`);
      continue;
    }
    writeFileSync(targetPath, source);
    console.log(`  → ${name} updated`);
  }

  if (checkOnly && drift > 0) {
    console.error(`\n${drift} schema${drift === 1 ? "" : "s"} drifted from source.`);
    process.exit(1);
  }
}

main();
