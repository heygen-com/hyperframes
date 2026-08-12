#!/usr/bin/env tsx
/**
 * Backfill preview URLs in registry block + component manifests.
 *
 * - Blocks: adds `preview: { video, poster }` using the deterministic CDN pattern
 * - Components: normalizes bare-string `preview` to `{ video }` object format
 *
 * Usage:
 *   npx tsx scripts/backfill-block-previews.ts           # all items
 *   npx tsx scripts/backfill-block-previews.ts --dry-run  # preview changes only
 */

import { readdirSync, readFileSync, writeFileSync, type Dirent } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = resolve(repoRoot, "registry");

const CDN_BASE = "https://static.heygen.ai/hyperframes-oss/docs/images/catalog";

const dryRun = process.argv.includes("--dry-run");

interface Preview {
  video?: string;
  poster?: string;
}

let updated = 0;
let skipped = 0;

function tryReadManifest(manifestPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeManifest(manifestPath: string, manifest: Record<string, unknown>): void {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function backfillBlocks() {
  const blocksDir = join(registryDir, "blocks");
  let entries: Dirent[];
  try {
    entries = readdirSync(blocksDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(blocksDir, entry.name, "registry-item.json");
    const manifest = tryReadManifest(manifestPath);
    if (!manifest) continue;

    const preview: Preview = {
      video: `${CDN_BASE}/blocks/${entry.name}.mp4`,
      poster: `${CDN_BASE}/blocks/${entry.name}.png`,
    };

    const existing = manifest.preview as Preview | undefined;
    if (existing?.video === preview.video && existing?.poster === preview.poster) {
      skipped++;
      continue;
    }

    manifest.preview = preview;

    if (dryRun) {
      console.log(`[dry-run] ${entry.name}: would set preview →`, preview);
    } else {
      writeManifest(manifestPath, manifest);
    }
    updated++;
  }
}

function normalizeComponents() {
  const componentsDir = join(registryDir, "components");
  let entries: Dirent[];
  try {
    entries = readdirSync(componentsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(componentsDir, entry.name, "registry-item.json");
    const manifest = tryReadManifest(manifestPath);
    if (!manifest) continue;
    if (!manifest.preview) continue;

    if (typeof manifest.preview === "string") {
      manifest.preview = { video: manifest.preview };

      if (dryRun) {
        console.log(
          `[dry-run] ${entry.name}: normalize string → { video: "${(manifest.preview as Preview).video}" }`,
        );
      } else {
        writeManifest(manifestPath, manifest);
      }
      updated++;
    } else {
      skipped++;
    }
  }
}

backfillBlocks();
normalizeComponents();

console.log(
  `\n${dryRun ? "[dry-run] " : ""}Done: ${updated} updated, ${skipped} already up-to-date`,
);
