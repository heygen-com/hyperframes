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
import { fileURLToPath, pathToFileURL } from "node:url";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  type FileTarget,
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

interface TextureGroup {
  title: string;
  items: string[];
}

/** Hand-written prose rescued from a previously generated page. */
interface CarriedContent {
  /** Whole `## sections`, heading included, in their original order. */
  sections: string[];
  /** A human rewrote the usage prose — the generated version steps aside. */
  hasCustomUsage: boolean;
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

/**
 * Every `## Heading` this generator produces, now or in an earlier revision.
 * Anything on a page outside this set was written by a human, and is carried
 * across a regeneration rather than deleted. Lowercased for comparison.
 */
const GENERATED_HEADINGS = new Set([
  // current template
  "install",
  "add it to your video",
  "paste it into your composition",
  "change the colors",
  "change how it looks",
  "ask an agent for it",
  "make the texture move",
  "every texture",
  // headings earlier revisions emitted — dropped on purpose, never carried.
  // `usage` is deliberately NOT listed: the current template never emits it, and
  // it is a heading a human might reasonably write, so ownership stays explicit
  // (anything not in this set is hand-written) rather than sniffing the body.
  "details",
  "files",
  "source prompt",
  "agent usage",
  "animated texture",
  "texture examples",
  // the required reader continuation the generator emits last (see RELATED_TOPICS)
  "related topics",
]);

/**
 * Marks the start of the generated provenance footer (tags, credit, prompt).
 * That footer carries no heading of its own, so without this marker the section
 * parser below would swallow it into the preceding hand-written section and
 * re-emit it on every run.
 */
const FOOTER_MARKER = "{/* hf:generated-footer */}";

/**
 * Every Catalog page ends with this section — required by `docs/AGENTS.md`
 * ("Task, guide, Studio, and Catalog pages end with a `## Related topics`
 * section"). Emitted last so the page literally ends with it; listed in
 * GENERATED_HEADINGS so a regeneration never carries it forward as hand-written.
 */
const RELATED_TOPICS: readonly string[] = [
  "## Related topics",
  "",
  "- [Browse the complete Catalog](/catalog)",
  "- [Add assets and Catalog items in Studio](/studio/assets-and-blocks)",
  "- [Build a richer composition](/go-further)",
  "",
];

/**
 * Pull the hand-written `## sections` out of an already-generated page.
 * Returns the raw lines, heading included, in their original order.
 */
// Exported for the preservation fixture in
// packages/core/src/registry/catalogGeneratorInstructions.test.ts.
// fallow-ignore-next-line complexity
export function carriedSectionsFrom(pagePath: string): CarriedContent {
  const empty: CarriedContent = { sections: [], hasCustomUsage: false };
  if (!existsSync(pagePath)) return empty;
  let text: string;
  try {
    text = readFileSync(pagePath, "utf-8");
  } catch {
    return empty;
  }

  const sections: string[] = [];
  let hasCustomUsage = false;
  let heading: string | null = null;
  let buffer: string[] = [];

  // fallow-ignore-next-line complexity
  const flush = (): void => {
    if (!heading) return;
    while (buffer.length && buffer[0]!.trim() === "") buffer.shift();
    while (buffer.length && buffer.at(-1)!.trim() === "") buffer.pop();

    // Ownership is explicit: a section is generated iff its heading is one the
    // template emits (GENERATED_HEADINGS). Everything else is hand-written and
    // carried verbatim — no content heuristic that could misread custom prose as
    // generated and silently delete it on the next regeneration.
    const key = heading.toLowerCase();
    if (!GENERATED_HEADINGS.has(key) && buffer.length) {
      if (key === "usage") hasCustomUsage = true;
      sections.push(`## ${heading}`, "", ...buffer, "");
    }
    heading = null;
    buffer = [];
  };

  let inFence = false;
  for (const line of text.split("\n")) {
    // The footer marker begins the generated tail (provenance + Related topics).
    // Don't stop here: close the current section and keep scanning, so a human
    // `## section` appended *below* the generated tail is still carried forward
    // rather than silently dropped. The generated headings themselves are named
    // in GENERATED_HEADINGS, so the tail's own `## Related topics` is not carried.
    if (line.trim() === FOOTER_MARKER) {
      flush();
      continue;
    }
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    const match = !inFence && /^## (.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[1]!.trim();
      continue;
    }
    if (heading) buffer.push(line);
  }
  flush();

  return { sections, hasCustomUsage };
}

function typeDir(kind: ItemKind): string {
  return ITEM_TYPE_DIRS[kind === "block" ? "hyperframes:block" : "hyperframes:component"];
}

function textureGroupsFor(manifest: RegistryItem): TextureGroup[] {
  if (!("textureGroups" in manifest)) return [];
  const value = manifest.textureGroups;
  if (!Array.isArray(value)) return [];

  return value.filter((group): group is TextureGroup => {
    if (!group || typeof group !== "object") return false;
    if (!("title" in group) || typeof group.title !== "string") return false;
    if (!("items" in group) || !Array.isArray(group.items)) return false;
    return group.items.every((item: unknown) => typeof item === "string");
  });
}

function textureLabel(slug: string): string {
  return slug
    .split("-")
    .map((part) =>
      part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function textureSampleWord(slug: string): string {
  if (slug.includes("brick")) return "BRICK";
  if (slug.includes("concrete")) return "CONCRETE";
  if (slug.includes("plaster")) return "PLASTER";
  if (slug.includes("rock")) return "ROCK";
  if (slug.includes("onyx")) return "ONYX";
  if (slug.includes("marble")) return "MARBLE";
  if (slug.includes("travertine")) return "STONE";
  if (slug.includes("paving")) return "STONE";
  if (slug.includes("tiles")) return "TILE";
  if (slug.includes("ground")) return "GROUND";
  if (slug.includes("road")) return "ROAD";
  if (slug.includes("asphalt")) return "ASPHALT";
  if (slug.includes("wood-floor")) return "FLOOR";
  if (slug.includes("wood")) return "WOOD";
  if (slug.includes("bark")) return "BARK";
  if (slug.includes("diamond")) return "PLATE";
  if (slug.includes("metal")) return "METAL";
  if (slug.includes("lava")) return "LAVA";
  if (slug.includes("grass")) return "GRASS";
  if (slug.includes("carpet")) return "WOVEN";
  if (slug.includes("fabric")) return "FABRIC";
  if (slug.includes("snow")) return "SNOW";
  if (slug.includes("leather")) return "LEATHER";
  return slug.toUpperCase();
}

function textureMaskUrlFor(manifest: RegistryItem, texture: string): string {
  return `${catalogImageBase}/components/${manifest.name}/masks/${texture}.png`;
}

function generateTextureExamples(manifest: RegistryItem, textureGroups: TextureGroup[]): string[] {
  const lines: string[] = ["## Every texture", "", '<div className="hf-texture-example-groups">'];

  for (const group of textureGroups) {
    lines.push(
      "  <div>",
      `    <h3 className="hf-texture-example-title">${group.title}</h3>`,
      '    <div className="hf-texture-example-grid">',
    );
    for (const item of group.items) {
      const maskPath = textureMaskUrlFor(manifest, item);
      const textureClass = `hf-texture-${item}`;
      lines.push(
        `      <div className="hf-texture-example-card" style={{ "--mask-url": "url('${maskPath}')" }}>`,
        `        <div className="hf-texture-example-meta"><div className="hf-texture-example-label">${textureLabel(item)}</div><code className="hf-texture-example-class">${textureClass}</code></div>`,
        `        <div className="hf-texture-example-shadow"><div className="hf-texture-example-word">${textureSampleWord(item)}</div></div>`,
        `        <div className="hf-texture-example-usage">Use <code>hf-texture-text ${textureClass}</code></div>`,
        "      </div>",
      );
    }
    lines.push("    </div>", "  </div>");
  }

  lines.push("</div>", "");
  return lines;
}

function generateTextureAgentUsage(
  manifest: RegistryItem,
  textureGroups: TextureGroup[],
): string[] {
  const firstTexture = textureGroups[0]?.items[0] ?? "brick";
  const firstClass = `hf-texture-${firstTexture}`;
  const installedSnippet = `compositions/components/${manifest.name}/${manifest.name}.html`;

  return [
    "## Ask an agent for it",
    "",
    "Paste this to your coding agent:",
    "",
    "```text",
    `Use the ${manifest.title} catalog component.`,
    "",
    "1. From the project root, run:",
    `   npx hyperframes add ${manifest.name}`,
    "2. That command creates this installed snippet:",
    `   ${installedSnippet}`,
    "3. Open that file and paste the real <style> block",
    "   near the bottom into the composition once. That CSS defines",
    "   hf-texture-text and every hf-texture-* class.",
    "4. Apply this class to the target text:",
    `   class="hf-texture-text ${firstClass}"`,
    "5. For another material, copy one hf-texture-* class",
    "   from the Texture Examples cards.",
    "6. This is the proper way to apply drop shadow",
    "   to textured text: wrap the text and put",
    "   filter on the wrapper, not on the text.",
    "   Use this markup:",
    `   <div style="filter: drop-shadow(1px 2px 1px rgba(0,0,0,0.48))">`,
    `     <div class="hf-texture-text ${firstClass}">TEXT</div>`,
    "   </div>",
    "```",
    "",
    `Swap \`${firstClass}\` for the class on any texture card below. Every texture also needs the base class \`hf-texture-text\`.`,
    "",
  ];
}

function generateTextureAnimationExample(
  manifest: RegistryItem,
  textureGroups: TextureGroup[],
): string[] {
  const texture =
    textureGroups.flatMap((group) => group.items).find((item) => item === "lava") ??
    textureGroups[0]?.items[0] ??
    "brick";
  const textureClass = `hf-texture-${texture}`;
  const maskPath = textureMaskUrlFor(manifest, texture);

  return [
    "## Make the texture move",
    "",
    "Move the mask position on the text element. Keep the drop shadow on a wrapper so it follows the textured contour.",
    "",
    `<div className="hf-texture-animate-demo" style={{ "--mask-url": "url('${maskPath}')" }}>`,
    '  <div className="hf-texture-animate-meta">',
    '    <div className="hf-texture-animate-label">Animated mask position</div>',
    `    <code className="hf-texture-animate-class">hf-texture-text ${textureClass}</code>`,
    "  </div>",
    '  <div className="hf-texture-animate-shadow">',
    '    <div className="hf-texture-animate-word">MOTION</div>',
    "  </div>",
    "</div>",
    "",
    "```html",
    '<div class="texture-shadow">',
    `  <div class="hf-texture-text ${textureClass} animated-texture">MOTION</div>`,
    "</div>",
    "```",
    "",
    "```css",
    ".animated-texture {",
    "  --mask-size: 180% 180%;",
    "  --mask-position: 0% 50%;",
    "}",
    "```",
    "",
    "```js",
    "const tl = gsap.timeline({ paused: true });",
    'tl.to(".animated-texture", {',
    '  "--mask-position": "100% 50%",',
    "  duration: 1.2,",
    '  ease: "sine.inOut",',
    "  yoyo: true,",
    "  repeat: 1,",
    "}, 0);",
    'window.__timelines["my-composition"] = tl;',
    "```",
    "",
  ];
}

function generateTexturePreview(manifest: RegistryItem, textureGroups: TextureGroup[]): string[] {
  const sampleItems = textureGroups
    .map((group) => group.items[0])
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
  const lines: string[] = ['<div className="hf-texture-preview-panel">'];

  for (const item of sampleItems) {
    const maskPath = textureMaskUrlFor(manifest, item);
    lines.push(
      `  <div className="hf-texture-preview-card" style={{ "--mask-url": "url('${maskPath}')" }}>`,
      `    <div className="hf-texture-preview-label">${textureLabel(item)}</div>`,
      `    <div className="hf-texture-preview-shadow"><div className="hf-texture-preview-word">${textureSampleWord(item)}</div></div>`,
      "  </div>",
    );
  }

  lines.push("</div>", "");
  return lines;
}

function catalogPreviewFor(kind: ItemKind, manifest: RegistryItem): string | undefined {
  // The manifest is the source of truth. Thirteen items declare a preview with
  // a video and no poster, and that omission is deliberate — no .png was ever
  // produced for them.
  if (manifest.preview) return manifest.preview.poster;
  const dir = typeDir(kind);
  return `${catalogImageBase}/${dir}/${manifest.name}.png`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** "a", "a and b", "a, b, and c" */
function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** The file a reader actually opens — by type, not array position. */
function primaryFileFor(manifest: RegistryItem): FileTarget | undefined {
  return (
    manifest.files.find((f) => f.type === "hyperframes:composition") ??
    manifest.files.find((f) => f.type === "hyperframes:snippet") ??
    manifest.files[0]
  );
}

/**
 * One sentence naming what lands in the project — replaces the old three-column
 * File/Target/Type table. The `type` column was registry-internal jargon and the
 * `path` column was the source path inside this repo, which a reader never sees.
 */
function installOutcome(manifest: RegistryItem, primaryTarget: string): string {
  const primary = primaryFileFor(manifest);
  const others = manifest.files.filter((f) => f !== primary);
  if (others.length === 0) return `That writes one file: \`${primaryTarget}\`.`;

  const dirs = [...new Set(others.map((f) => f.target.split("/").slice(0, -1).join("/")))]
    .filter(Boolean)
    .map((d) => `\`${d}/\``);
  const noun = others.length === 1 ? "supporting file" : "supporting files";
  if (dirs.length === 0) return `That writes \`${primaryTarget}\` plus ${others.length} ${noun}.`;
  return `That writes \`${primaryTarget}\`, plus ${others.length} ${noun} under ${sentenceList(dirs)}.`;
}

/**
 * True when the installed file opens with an HTML comment. Only 13 of 36
 * component snippets do, so the old blanket "see the comment header in the
 * file" line was simply false on the rest.
 */
function hasCommentHeader(kind: ItemKind, manifest: RegistryItem): boolean {
  const primary = primaryFileFor(manifest);
  if (!primary) return false;
  const sourcePath = join(registryDir, typeDir(kind), manifest.name, primary.path);
  if (!existsSync(sourcePath)) return false;
  try {
    return readFileSync(sourcePath, "utf-8").trimStart().startsWith("<!--");
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity
function generateParams(manifest: RegistryItem): string[] {
  if (!("params" in manifest) || !Array.isArray(manifest.params) || !manifest.params.length) {
    return [];
  }
  const params = manifest.params;
  const allColors = params.every((p) => p.type === "color");
  const lines: string[] = [
    allColors ? "## Change the colors" : "## Change how it looks",
    "",
    "Set these CSS variables on the block:",
    "",
  ];
  for (const p of params) {
    const opts = p.options?.length
      ? ` Options: ${p.options.map((o) => `\`${o.value}\``).join(", ")}.`
      : "";
    lines.push(`- \`${p.key}\` — ${p.label}. Defaults to \`${p.default}\`.${opts}`);
  }
  lines.push("");
  return lines;
}

// fallow-ignore-next-line complexity
function generateItemMdx(
  kind: ItemKind,
  manifest: RegistryItem,
  carried: CarriedContent = { sections: [], hasCustomUsage: false },
): string {
  const tags = manifest.tags ?? [];
  const installCmd = `npx hyperframes add ${manifest.name}`;
  const source = manifest as RegistryItem & SourceMetadata;
  const textureGroups = textureGroupsFor(manifest);
  const primaryTarget = primaryFileFor(manifest)?.target ?? `compositions/${manifest.name}.html`;

  // Frontmatter only. Mintlify renders `title` as the H1 and `description` as
  // the standfirst, so repeating both in the body (as this generator used to)
  // printed each one twice on every page.
  const lines: string[] = [
    "---",
    `title: ${yamlString(manifest.title)}`,
    `description: ${yamlString(manifest.description)}`,
    "---",
    "",
  ];

  // 1. What it looks like, before anything else. Credits, tags and the source
  //    prompt used to sit above this and pushed the preview below the fold.
  if (textureGroups.length > 0) {
    lines.push(...generateTexturePreview(manifest, textureGroups));
  } else {
    const previewPath = `${catalogImageBase}/${typeDir(kind)}/${manifest.name}`;
    // Same source of truth as the index: a manifest that declares a preview
    // without a poster has no .png, and asking for one is a 403 the browser
    // fetches before the video.
    const posterUrl = catalogPreviewFor(kind, manifest);
    const poster = posterUrl ? ` poster="${posterUrl}"` : "";
    lines.push(
      `<video className="w-full aspect-video rounded-xl object-cover bg-zinc-100 dark:bg-zinc-800" src="${previewPath}.mp4"${poster} autoPlay muted loop playsInline />`,
      "",
    );
  }

  // 2. How to get it. A CodeGroup around a single block just drew an empty tab bar.
  lines.push(
    "## Install",
    "",
    "```bash Terminal",
    installCmd,
    "```",
    "",
    installOutcome(manifest, primaryTarget),
    "",
  );

  // Prerequisite where it bites: you need the flag to preview what you just installed.
  if (tags.includes("html-in-canvas")) {
    lines.push(
      "<Warning>",
      "  Live preview needs the `chrome://flags/#canvas-draw-element` flag switched on.",
      "  Rendering from the CLI switches it on for you. [How it",
      "  works](/guides/html-in-canvas)",
      "</Warning>",
      "",
    );
  }

  // 3. How to use it — unless a human already wrote that section, in which case
  //    their version is carried through below instead of being overwritten.
  if (carried.hasCustomUsage) {
    // nothing: the carried "## Usage" section covers it
  } else if (kind === "block" && isBlockItem(manifest)) {
    const w = manifest.dimensions.width;
    const h = manifest.dimensions.height;
    lines.push(
      "## Add it to your video",
      "",
      `It runs for ${manifest.duration} seconds at ${w}×${h}. Paste this into your composition:`,
      "",
      "```html index.html",
      "<div",
      `  data-composition-id="${manifest.name}"`,
      `  data-composition-src="${primaryTarget}"`,
      `  data-start="0"`,
      `  data-duration="${manifest.duration}"`,
      `  data-track-index="1"`,
      `  data-width="${w}"`,
      `  data-height="${h}"`,
      "></div>",
      "```",
      "",
      "Move it in time with `data-start`. Put it on a different timeline row with",
      "`data-track-index`. See [data attributes](/concepts/data-attributes) for the rest.",
      "",
    );
  } else if (textureGroups.length > 0) {
    lines.push(
      "## Paste it into your composition",
      "",
      `Open \`${primaryTarget}\`. Paste the real \`<style>\` element near the bottom into`,
      "your composition once. It defines `hf-texture-text` and every `hf-texture-*` class.",
      "",
      `Leave the texture PNGs in \`assets/${manifest.name}/masks/\`. The CSS looks for them there.`,
      "",
    );
  } else {
    lines.push(
      "## Paste it into your composition",
      "",
      `Open \`${primaryTarget}\` and copy what is inside into your own composition.`,
    );
    if (hasCommentHeader(kind, manifest)) {
      lines.push("The file opens with a comment header that walks you through it.");
    }
    lines.push(
      "",
      "A component has no size or duration of its own. It takes both from the composition",
      "you paste it into.",
      "",
    );
  }

  lines.push(...generateParams(manifest));

  if (textureGroups.length > 0) {
    lines.push(...generateTextureAgentUsage(manifest, textureGroups));
    lines.push(...generateTextureAnimationExample(manifest, textureGroups));
    lines.push(...generateTextureExamples(manifest, textureGroups));
  }

  // 4. Sections a human added to the previously generated page. Carried through
  //    verbatim so regenerating never silently deletes hand-written docs.
  if (carried.sections.length > 0) {
    lines.push(...carried.sections);
  }

  if (manifest.relatedSkill) {
    lines.push(`<Tip>Related skill: \`/${manifest.relatedSkill}\`</Tip>`, "");
  }

  // 5. Generated tail: provenance (the least of what a reader came for) and
  //    then the required `## Related topics` continuation, so the page ends with
  //    it per docs/AGENTS.md. The marker delimits everything generated below it.
  const footer: string[] = [];

  if (tags.length > 0) {
    footer.push(`Tagged ${tags.map((t) => `\`${t}\``).join(" ")}.`, "");
  }

  if (manifest.author) {
    const author = source.authorUrl ? `[${manifest.author}](${source.authorUrl})` : manifest.author;
    footer.push(`Created by ${author}.`, "");
  }

  if (source.sourcePrompt) {
    footer.push(
      '<Accordion title="The prompt this was built from">',
      "",
      "```text",
      source.sourcePrompt,
      "```",
      "",
      "</Accordion>",
      "",
    );
  }

  lines.push(FOOTER_MARKER, "", ...footer, ...RELATED_TOPICS);

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function main(): void {
  const items = discoverItems();
  const catalogIndex: CatalogEntry[] = [];

  // Read hand-written sections off the existing pages BEFORE deleting them, so
  // a regeneration adds template improvements without destroying prose someone
  // wrote by hand (e.g. the "Features" lists on the code-snippet pages).
  const carried = new Map<string, CarriedContent>();
  for (const { kind, manifest } of items) {
    const content = carriedSectionsFrom(
      join(docsDir, "catalog", typeDir(kind), `${manifest.name}.mdx`),
    );
    if (content.sections.length > 0) carried.set(manifest.name, content);
  }

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

    const mdx = generateItemMdx(kind, manifest, carried.get(manifest.name));
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
      preview: catalogPreviewFor(kind, manifest),
    });
  }

  // Write catalog-index.json
  const publicDir = join(docsDir, "public");
  mkdirSync(publicDir, { recursive: true });
  if (carried.size > 0) {
    console.log(`\n  ↻ carried hand-written sections through on ${carried.size} page(s)`);
  }

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
    "Code Animations": 0,
    Captions: 1,
    "HTML-in-Canvas": 2,
    "Social Overlays": 3,
    "Lower Thirds": 4,
    "Shader Transitions": 5,
    "CSS Transitions": 6,
    Showcases: 7,
    Data: 8,
    Effects: 9,
    Blocks: 10,
  };

  // fallow-ignore-next-line complexity
  function groupForItem(entry: CatalogEntry): string {
    const tags = entry.tags;
    // Two-tag combos for specific grouping
    if (tags.includes("transition") && tags.includes("shader")) return "Shader Transitions";
    if (tags.includes("transition") && tags.includes("showcase")) return "CSS Transitions";
    if (tags.includes("captions")) return "Captions";
    if (tags.includes("html-in-canvas")) return "HTML-in-Canvas";
    // Code animations (morph, flight, diff, …) — keyed on the code-animation tag so
    // they group separately from the static code-snippet themes.
    if (tags.includes("code-animation")) return "Code Animations";
    // Single-tag mapping
    if (tags.includes("lower-third")) return "Lower Thirds";
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
    const existingIdx = tabs.findIndex((t) => t.tab === "Catalog");
    const existing = existingIdx >= 0 ? tabs[existingIdx] : undefined;

    // Groups nobody here generated — e.g. the hand-added "Overview" pointing at
    // catalog/index. Rebuilding the tab used to drop them, which unlinked the
    // catalog landing page from the sidebar entirely.
    const isGeneratedPage = (p: unknown): boolean =>
      typeof p === "string" && /^catalog\/(blocks|components)\//.test(p);
    const handAddedGroups: unknown[] = (existing?.groups ?? []).filter(
      (g: { pages?: unknown[] }) => !(g.pages ?? []).some(isGeneratedPage),
    );

    const catalogTab = {
      tab: "Catalog",
      // Keep the icon a human chose for the tab.
      ...(existing?.icon ? { icon: existing.icon } : {}),
      groups: [...handAddedGroups, ...catalogGroups],
    };

    if (existingIdx >= 0) {
      // Leave the tab where it already sits, rather than re-homing it.
      tabs.splice(existingIdx, 1, catalogTab);
    } else {
      const docsIdx = tabs.findIndex((t) => t.tab === "Documentation");
      tabs.splice(docsIdx >= 0 ? docsIdx + 1 : 1, 0, catalogTab);
    }
    writeFileSync(docsJsonPath, JSON.stringify(docsJson, null, 2) + "\n", "utf-8");
    const totalPages = catalogGroups.reduce((n, g) => n + g.pages.length, 0);
    console.log(`  ✓ docs.json updated with ${catalogGroups.length} groups, ${totalPages} pages`);
  }

  console.log("\nDone.");
}

// Only regenerate when run directly, so the module can be imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
