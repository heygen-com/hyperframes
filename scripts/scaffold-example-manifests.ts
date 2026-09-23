#!/usr/bin/env tsx
/**
 * Generate registry-item.json manifests for every example in registry/examples/,
 * without changing the top-level registry index.
 *
 * Reads the legacy registry/examples/templates.json (label + hint) and probes
 * each example's index.html for dimensions / duration data attributes.
 * Placeholder `__VIDEO_DURATION__` falls back to 10 (the init-time default).
 *
 * Idempotent — safe to re-run, but will overwrite any hand-edits. Intended as
 * one-shot scaffolding for PR 3.
 *
 * Usage:
 *   bun run scripts/scaffold-example-manifests.ts
 *   bun run scripts/scaffold-example-manifests.ts --only warm-grain
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ITEM_TYPE_DIRS,
  type FileTarget,
  type FileType,
  type RegistryItem,
  // Import from source, like every other script here: bun workspace linking
  // does not resolve for scripts outside packages/, so the package name
  // typechecks on a machine with a warm node_modules and fails in CI.
} from "../packages/core/src/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const examplesDir = resolve(repoRoot, "registry", ITEM_TYPE_DIRS["hyperframes:example"]);
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

function durationSeconds(rawDuration: string | undefined): number {
  return rawDuration === undefined || rawDuration === PLACEHOLDER_DURATION
    ? DEFAULT_DURATION_SECONDS
    : Number(rawDuration);
}

function probeCanvas(exampleDir: string): CanvasMeta {
  const html = readFileSync(join(exampleDir, "index.html"), "utf-8");
  const width = Number(extractAttr(html, "width") ?? 1920);
  const height = Number(extractAttr(html, "height") ?? 1080);
  const rawDuration = extractAttr(html, "duration");
  const duration = durationSeconds(rawDuration);
  return { width, height, duration };
}

function fileTypeFor(path: string): FileType {
  if (path.endsWith(".html")) return "hyperframes:composition";
  return "hyperframes:asset";
}

/** Walk the example dir and collect every tracked file (HTML + assets). */
function collectFiles(exampleDir: string): FileTarget[] {
  return readdirSync(exampleDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "registry-item.json")
    .map((entry) => {
      const path = relative(exampleDir, join(entry.parentPath, entry.name));
      return { path, target: path, type: fileTypeFor(path) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
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

function selectedExamples(): LegacyTemplateEntry[] {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const onDisk = readLegacyManifest().filter((entry) => !entry.bundled);
  if (!only) return onDisk;
  const filtered = onDisk.filter((entry) => entry.id === only);
  if (filtered.length === 0)
    throw new Error(
      `No example matches --only ${only}. Available: ${onDisk.map((entry) => entry.id).join(", ")}`,
    );
  return filtered;
}

function scaffoldExample(entry: LegacyTemplateEntry): void {
  const exampleDir = join(examplesDir, entry.id);
  try {
    statSync(exampleDir);
  } catch {
    console.warn(`skip ${entry.id}: directory not found at ${relative(repoRoot, exampleDir)}`);
    return;
  }
  writeItem(buildItem(entry));
}

function main(): void {
  const entries = selectedExamples();
  if (entries.length === 0)
    throw new Error("No examples found in registry/examples/templates.json");
  for (const entry of entries) scaffoldExample(entry);
}

main();
