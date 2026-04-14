#!/usr/bin/env tsx
/**
 * Generate registry-item.json manifests for every example in registry/examples/,
 * plus the top-level registry/registry.json manifest.
 *
 * Reads the legacy registry/examples/templates.json (label + hint) and probes
 * each example's index.html for dimensions / duration data attributes.
 * Placeholder `__VIDEO_DURATION__` falls back to 10 (the init-time default).
 *
 * Idempotent — safe to re-run, but will overwrite any hand-edits. Intended as
 * one-shot scaffolding for PR 3.
 *
 * Usage:
 *   bun run scripts/generate-registry-items.ts
 *   bun run scripts/generate-registry-items.ts --only warm-grain
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ITEM_TYPE_DIRS,
  type FileTarget,
  type FileType,
  type RegistryItem,
  type RegistryManifest,
} from "@hyperframes/core";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const examplesDir = resolve(repoRoot, "registry", ITEM_TYPE_DIRS["hyperframes:example"]);
const registryManifestPath = resolve(repoRoot, "registry/registry.json");
const legacyManifestPath = resolve(examplesDir, "templates.json");

const DEFAULT_DURATION_SECONDS = 10;
const PLACEHOLDER_DURATION = "__VIDEO_DURATION__";

interface LegacyTemplateEntry {
  id: string;
  label: string;
  hint: string;
  bundled: boolean;
}

interface LegacyManifest {
  templates: LegacyTemplateEntry[];
}

function readLegacyManifest(): LegacyTemplateEntry[] {
  try {
    const raw = readFileSync(legacyManifestPath, "utf-8");
    const parsed = JSON.parse(raw) as LegacyManifest;
    return parsed.templates;
  } catch {
    // templates.json was the bootstrap source and has been deleted. Fall back
    // to scanning existing registry-item.json files and reconstructing entries.
    return scanExistingItems();
  }
}

function scanExistingItems(): LegacyTemplateEntry[] {
  const entries: LegacyTemplateEntry[] = [];
  for (const dir of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const itemPath = join(examplesDir, dir.name, "registry-item.json");
    try {
      const item = JSON.parse(readFileSync(itemPath, "utf-8")) as RegistryItem;
      entries.push({ id: item.name, label: item.title, hint: item.description, bundled: false });
    } catch {
      // No manifest — skip.
    }
  }
  return entries;
}

function extractAttr(html: string, attr: string): string | undefined {
  const match = new RegExp(`data-${attr}="([^"]*)"`).exec(html);
  return match?.[1];
}

interface CanvasMeta {
  width: number;
  height: number;
  duration: number;
}

function probeCanvas(exampleDir: string): CanvasMeta {
  const html = readFileSync(join(exampleDir, "index.html"), "utf-8");
  const width = Number(extractAttr(html, "width") ?? 1920);
  const height = Number(extractAttr(html, "height") ?? 1080);
  const rawDuration = extractAttr(html, "duration");
  const duration =
    rawDuration === undefined || rawDuration === PLACEHOLDER_DURATION
      ? DEFAULT_DURATION_SECONDS
      : Number(rawDuration);
  return { width, height, duration };
}

function fileTypeFor(path: string): FileType {
  if (path.endsWith(".html")) return "hyperframes:composition";
  return "hyperframes:asset";
}

/** Walk the example dir and collect every tracked file (HTML + assets). */
function collectFiles(exampleDir: string): FileTarget[] {
  const files: FileTarget[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        // Skip the registry-item.json itself if it already exists from a
        // prior run; we're regenerating it.
        if (entry.name === "registry-item.json") continue;
        const rel = relative(exampleDir, full);
        files.push({ path: rel, target: rel, type: fileTypeFor(rel) });
      }
    }
  };
  walk(exampleDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function buildItem(entry: LegacyTemplateEntry): RegistryItem {
  // The `blank` template is bundled inside the CLI package; don't generate a
  // manifest in registry/examples/ for it.
  const exampleDir = join(examplesDir, entry.id);
  const canvas = probeCanvas(exampleDir);
  const files = collectFiles(exampleDir);

  return {
    $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
    name: entry.id,
    type: "hyperframes:example",
    title: entry.label,
    description: entry.hint,
    dimensions: { width: canvas.width, height: canvas.height },
    duration: canvas.duration,
    files,
  };
}

function writeItem(item: RegistryItem): void {
  if (item.type !== "hyperframes:example") return;
  const out = join(examplesDir, item.name, "registry-item.json");
  writeFileSync(out, JSON.stringify(item, null, 2) + "\n", "utf-8");
  console.log(`wrote ${relative(repoRoot, out)}`);
}

function writeRegistryManifest(items: RegistryItem[]): void {
  const manifest: RegistryManifest = {
    $schema: "https://hyperframes.heygen.com/schema/registry.json",
    name: "hyperframes",
    homepage: "https://hyperframes.heygen.com",
    items: items.map((item) => ({ name: item.name, type: item.type })),
  };
  writeFileSync(registryManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`wrote ${relative(repoRoot, registryManifestPath)}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

  const legacy = readLegacyManifest();
  // Skip bundled templates (e.g. `blank`) — they live inside the CLI package,
  // not under registry/examples/.
  const onDisk = legacy.filter((t) => !t.bundled);
  const filtered = only ? onDisk.filter((t) => t.id === only) : onDisk;

  if (filtered.length === 0) {
    console.error(
      only
        ? `No example matches --only ${only}. Available: ${onDisk.map((t) => t.id).join(", ")}`
        : "No examples found in registry/examples/templates.json",
    );
    process.exit(1);
  }

  const items: RegistryItem[] = [];
  for (const entry of filtered) {
    const exampleDir = join(examplesDir, entry.id);
    try {
      statSync(exampleDir);
    } catch {
      console.warn(`skip ${entry.id}: directory not found at ${relative(repoRoot, exampleDir)}`);
      continue;
    }
    const item = buildItem(entry);
    writeItem(item);
    items.push(item);
  }

  // Only rewrite the top-level manifest on a full-run (not --only).
  if (!only) {
    writeRegistryManifest(items);
  }
}

main();
