#!/usr/bin/env tsx
/**
 * Generate Catalog MDX Pages + Index
 *
 * Walks registry/blocks/ and registry/components/, reads each item's
 * registry-item.json, and emits:
 *
 *   docs/catalog/blocks/<name>.mdx       — per-block detail page
 *   docs/catalog/components/<name>.mdx   — per-component detail page
 *   docs/public/catalog-index.json       — flat manifest for the grid page
 *
 * Run before building docs (e.g., in a Mintlify pre-build script):
 *   npx tsx scripts/generate-catalog-pages.ts
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  type RegistryItem,
  isBlockItem,
  ITEM_TYPE_DIRS,
} from "../packages/core/src/registry/types.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = resolve(repoRoot, "registry");
const docsDir = resolve(repoRoot, "docs");
const catalogImageBase = "https://static.heygen.ai/hyperframes-oss/docs/images/catalog";

// ── Types ──────────────────────────────────────────────────────────────────

type ItemKind = "block" | "component";

interface SourceMetadata {
  authorUrl?: string;
  sourcePrompt?: string;
}

interface CatalogEntry {
  name: string;
  type: ItemKind;
  title: string;
  description: string;
  tags: string[];
  /** Relative href within the docs site. */
  href: string;
  /** Preview poster image path (relative to docs root). */
  preview?: string;
}

// ── Discovery ──────────────────────────────────────────────────────────────

function discoverItems(): { kind: ItemKind; manifest: RegistryItem }[] {
  const items: { kind: ItemKind; manifest: RegistryItem }[] = [];
  const registryManifest = JSON.parse(
    readFileSync(join(registryDir, "registry.json"), "utf-8"),
  ) as { items?: { name: string; type: string }[] };

  for (const item of registryManifest.items ?? []) {
    const kind =
      item.type === "hyperframes:block"
        ? "block"
        : item.type === "hyperframes:component"
          ? "component"
          : null;

    if (!kind) continue;

    const manifestPath = join(registryDir, typeDir(kind), item.name, "registry-item.json");
    if (!existsSync(manifestPath)) {
      console.warn(`  ⚠ Skipping ${item.name}: missing ${manifestPath}`);
      continue;
    }

    let manifest: RegistryItem;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
    } catch (err) {
      console.warn(`  ⚠ Skipping ${manifestPath}: ${(err as Error).message}`);
      continue;
    }
    items.push({ kind, manifest });
  }

  return items.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

// ── MDX generation ─────────────────────────────────────────────────────────

function typeLabel(kind: ItemKind): string {
  return kind === "block" ? "Block" : "Component";
}

function typeDir(kind: ItemKind): string {
  return ITEM_TYPE_DIRS[kind === "block" ? "hyperframes:block" : "hyperframes:component"];
}

function generateItemMdx(kind: ItemKind, manifest: RegistryItem): string {
  const tags = manifest.tags ?? [];
  const tagBadges = tags.map((t) => `\`${t}\``).join(" ");
  const installCmd = `npx hyperframes add ${manifest.name}`;
  const source = manifest as RegistryItem & SourceMetadata;

  const lines: string[] = [
    "---",
    `title: "${manifest.title.replace(/"/g, '\\"')}"`,
    `description: "${manifest.description.replace(/"/g, '\\"')}"`,
    "---",
    "",
    `# ${manifest.title}`,
    "",
    manifest.description,
    "",
  ];

  if (tagBadges) {
    lines.push(tagBadges, "");
  }

  if (tags.includes("html-in-canvas")) {
    lines.push(
      `<Warning>`,
      `**Requires Chrome flag.** Enable \`chrome://flags/#canvas-draw-element\` for live preview. Rendering via CLI enables the flag automatically. [Learn more](/guides/html-in-canvas).`,
      `</Warning>`,
      "",
    );
  }

  if (manifest.author) {
    const author = source.authorUrl ? `[${manifest.author}](${source.authorUrl})` : manifest.author;
    lines.push(`Created by ${author}.`, "");
  }

  if (source.sourcePrompt) {
    lines.push("## Source Prompt", "", "```text", source.sourcePrompt, "```", "");
  }

  // Preview video with poster — muted loop, no autoPlay (matches examples page).
  const previewPath = `${catalogImageBase}/${typeDir(kind)}/${manifest.name}`;
  lines.push(
    `<video className="w-full aspect-video rounded-xl object-cover bg-zinc-100 dark:bg-zinc-800" src="${previewPath}.mp4" poster="${previewPath}.png" autoPlay muted loop playsInline />`,
    "",
  );

  // Install command
  lines.push(
    "## Install",
    "",
    "<CodeGroup>",
    "",
    "```bash Terminal",
    installCmd,
    "```",
    "",
    "</CodeGroup>",
    "",
  );

  // Details
  if (kind === "block" && manifest.dimensions && manifest.duration) {
    lines.push(
      "## Details",
      "",
      `| Property | Value |`,
      `| --- | --- |`,
      `| Type | ${typeLabel(kind)} |`,
      `| Dimensions | ${manifest.dimensions.width}×${manifest.dimensions.height} |`,
      `| Duration | ${manifest.duration}s |`,
      "",
    );
  } else {
    lines.push(
      "## Details",
      "",
      `| Property | Value |`,
      `| --- | --- |`,
      `| Type | ${typeLabel(kind)} |`,
      "",
    );
  }

  // Files
  lines.push("## Files", "", "| File | Target | Type |", "| --- | --- | --- |");
  for (const f of manifest.files) {
    lines.push(`| \`${f.path}\` | \`${f.target}\` | ${f.type} |`);
  }
  lines.push("");

  // Usage hint — find the primary file by type, not array position.
  const primaryFile =
    manifest.files.find((f) => f.type === "hyperframes:composition") ??
    manifest.files.find((f) => f.type === "hyperframes:snippet") ??
    manifest.files[0];
  const primaryTarget = primaryFile?.target ?? `compositions/${manifest.name}.html`;

  if (kind === "block" && isBlockItem(manifest)) {
    const w = manifest.dimensions.width;
    const h = manifest.dimensions.height;
    lines.push(
      "## Usage",
      "",
      "After installing, add the block to your host composition:",
      "",
      "```html",
      `<div data-composition-id="${manifest.name}" data-composition-src="${primaryTarget}" data-start="0" data-duration="${manifest.duration}" data-track-index="1" data-width="${w}" data-height="${h}"></div>`,
      "```",
      "",
    );
  } else {
    lines.push(
      "## Usage",
      "",
      `Open \`${primaryTarget}\` and paste its contents into your composition. See the comment header in the file for detailed instructions.`,
      "",
    );
  }

  // Related skill
  if (manifest.relatedSkill) {
    lines.push(`<Tip>Related skill: \`/${manifest.relatedSkill}\`</Tip>`, "");
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const items = discoverItems();
  const catalogIndex: CatalogEntry[] = [];

  // Clean previous generated output so deleted items don't leave stale pages.
  // Only remove the generated subdirectories, not the entire catalog/ dir
  // (which may contain hand-written pages like an overview).
  for (const sub of ["blocks", "components"]) {
    const dir = join(docsDir, "catalog", sub);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }

  console.log(`Generating catalog pages for ${items.length} item(s)...\n`);

  for (const { kind, manifest } of items) {
    const dir = typeDir(kind);
    const outDir = join(docsDir, "catalog", dir);
    mkdirSync(outDir, { recursive: true });

    const mdx = generateItemMdx(kind, manifest);
    const outPath = join(outDir, `${manifest.name}.mdx`);
    writeFileSync(outPath, mdx, "utf-8");
    console.log(`  ✓ catalog/${dir}/${manifest.name}.mdx`);

    catalogIndex.push({
      name: manifest.name,
      type: kind,
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags ?? [],
      href: `/catalog/${dir}/${manifest.name}`,
      preview: `${catalogImageBase}/${dir}/${manifest.name}.png`,
    });
  }

  // Write catalog-index.json
  const publicDir = join(docsDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const indexPath = join(publicDir, "catalog-index.json");
  writeFileSync(indexPath, JSON.stringify(catalogIndex, null, 2) + "\n", "utf-8");
  console.log(`\n  ✓ public/catalog-index.json (${catalogIndex.length} items)`);

  // Update docs.json navigation with generated catalog pages.
  const docsJsonPath = join(docsDir, "docs.json");
  const docsJson = JSON.parse(readFileSync(docsJsonPath, "utf-8"));
  const tabs = docsJson.navigation?.tabs;
  if (!Array.isArray(tabs)) {
    console.warn("  ⚠ docs.json has no navigation.tabs — skipping nav update");
    console.log("\nDone.");
    return;
  }

  // Build catalog groups by category (first tag), like shadcn/ui.
  // Items with the same first tag are grouped together. Items without tags
  // go into an "Other" group. Groups are sorted with a priority order.
  const GROUP_ORDER: Record<string, number> = {
    "HTML-in-Canvas": 0,
    "Social Overlays": 2,
    "Shader Transitions": 3,
    "CSS Transitions": 4,
    Showcases: 5,
    Data: 6,
    Effects: 7,
    Blocks: 8,
  };

  function groupForItem(entry: CatalogEntry): string {
    const tags = entry.tags;
    // Two-tag combos for specific grouping
    if (tags.includes("transition") && tags.includes("shader")) return "Shader Transitions";
    if (tags.includes("transition") && tags.includes("showcase")) return "CSS Transitions";
    // HTML-in-Canvas and Captions categories
    if (tags.includes("html-in-canvas")) return "HTML-in-Canvas";
    // Single-tag mapping
    if (tags.includes("social")) return "Social Overlays";
    if (tags.includes("transition"))
      return entry.type === "component" ? "Effects" : "CSS Transitions";
    if (tags.includes("showcase") || tags.includes("3d")) return "Showcases";
    if (tags.includes("data") || tags.includes("chart") || tags.includes("ascii")) return "Data";
    if (entry.type === "component") return "Effects";
    // Remaining blocks
    return "Blocks";
  }

  const groupMap = new Map<string, string[]>();
  for (const entry of catalogIndex) {
    const group = groupForItem(entry);
    const dir = entry.type === "block" ? "blocks" : "components";
    const page = `catalog/${dir}/${entry.name}`;
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(page);
  }

  const catalogGroups = [...groupMap.entries()]
    .sort(([a], [b]) => (GROUP_ORDER[a] ?? 50) - (GROUP_ORDER[b] ?? 50))
    .map(([group, pages]) => ({ group, pages }));

  if (catalogGroups.length > 0) {
    // Replace or insert the Catalog tab
    const existingIdx = tabs.findIndex((t) => t.tab === "Catalog");
    const catalogTab = { tab: "Catalog", groups: catalogGroups };
    // Remove existing Catalog tab if present, then insert at position 1
    // (after Documentation, before Packages).
    if (existingIdx >= 0) {
      tabs.splice(existingIdx, 1);
    }
    const docsIdx = tabs.findIndex((t) => t.tab === "Documentation");
    tabs.splice(docsIdx >= 0 ? docsIdx + 1 : 1, 0, catalogTab);
    writeFileSync(docsJsonPath, JSON.stringify(docsJson, null, 2) + "\n", "utf-8");
    const totalPages = catalogGroups.reduce((n, g) => n + g.pages.length, 0);
    console.log(`  ✓ docs.json updated with ${catalogGroups.length} groups, ${totalPages} pages`);
  }

  console.log("\nDone.");
}

main();
