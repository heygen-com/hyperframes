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

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
} from "node:fs";
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
  "variables",
  "source",
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
    if (!item) continue;
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

/**
 * Where the browser asks for a preview.
 *
 * Mintlify serves docs/public under `/public`, not the root. This is verified
 * against the live site, where /public/images/... answers 200 and the same path
 * without the prefix answers 404, so the prefix is load-bearing rather than a
 * quirk of the local dev server.
 */
function playerPreviewUrl(kind: ItemKind, manifest: RegistryItem): string {
  return `/public/catalog/preview/${typeDir(kind)}/${manifest.name}.html`;
}

/**
 * Puts the values from `?hfv=<json>` where a composition looks for them, and
 * nowhere else.
 *
 * Two readers, because there are two ways a preview consumes variables:
 *   - `window.__hfVariables` — what `getVariables()` merges over the declared
 *     defaults in a composition that reads them itself.
 *   - `data-variable-values` on the host element — what the runtime loader
 *     layers over a mounted sub-composition's defaults.
 *
 * `hfv` is written with `encodeURIComponent` and read back with
 * `URLSearchParams.get`, which is its inverse: `encodeURIComponent` escapes
 * both space (`%20`) and plus (`%2B`), the only two characters the two codecs
 * disagree about, so form-decoding its output is lossless. Reading with
 * `decodeURIComponent` instead is not safe here, because anything on the path
 * that re-serializes the query as form data — the player used to — writes
 * spaces as `+`, and percent-decoding leaves those `+` in the value.
 *
 * This runs from the end of `<body>`: late enough that every host element is
 * parsed, and early enough that the runtime — which the player injects on a
 * 200ms poll after load — has not started resolving them.
 *
 * Only hosts pointing at `ownFile` are stamped. A demo is free to mount other
 * scenes, and their variables are not the ones this page documents.
 */
export function variableBootstrap(ownFile: string): string {
  return [
    "<script>",
    "  (function () {",
    "    var raw = new URLSearchParams(location.search).get('hfv');",
    "    if (raw === null) return;",
    "    var v;",
    "    try { v = JSON.parse(raw); } catch (e) { return; }",
    "    if (!v || typeof v !== 'object') return;",
    "    window.__hfVariables = v;",
    "    var hosts = document.querySelectorAll('[data-composition-src]');",
    "    for (var i = 0; i < hosts.length; i++) {",
    "      var src = (hosts[i].getAttribute('data-composition-src') || '').split('?')[0];",
    `      if (src.slice(src.lastIndexOf('/') + 1) !== ${JSON.stringify(ownFile)}) continue;`,
    "      hosts[i].setAttribute('data-variable-values', JSON.stringify(v));",
    "    }",
    "  })();",
    "</script>",
  ].join("\n");
}

/** Insert `snippet` immediately before `</body>`, or at the end of a document
 *  that never opened one. */
function appendToBody(html: string, snippet: string): string {
  const close = html.toLowerCase().lastIndexOf("</body>");
  if (close === -1) return `${html}\n${snippet}\n`;
  return `${html.slice(0, close)}${snippet}\n${html.slice(close)}`;
}

/** The `<body>` background the demo chose, so a generated host does not put a
 *  light-on-dark piece on white. Falls back to the near-black the registry
 *  demos overwhelmingly use. */
function demoBackground(html: string): string {
  // 97 of the demos paint the frame on their #demo stage rather than on body.
  // Reading only body handed every one of them the near-black fallback, which
  // showed each ink-on-light primitive as dark grey on near black. #demo wins
  // when both declare one: it is the element that fills the frame.
  const declared = (selector: RegExp): string | undefined => {
    for (const rule of html.matchAll(selector)) {
      const found = /background(?:-color)?\s*:\s*([^;}]+)/i.exec(rule[1] ?? "");
      if (found?.[1]) return found[1].trim();
    }
    return undefined;
  };
  return (
    declared(/(?<![\w.#-])#demo\s*\{([^}]*)\}/gi) ??
    declared(/(?<![\w.#-])(?:html\s*,\s*)?body\s*\{([^}]*)\}/gi) ??
    "#0b0c0e"
  );
}

/**
 * The one inline script a demo uses to build its timeline, and the id it
 * registers it under.
 *
 * Null unless the demo has exactly one such script registering exactly one id.
 * That is the shape all 59 of these demos ship; anything else is not worth
 * guessing at, and the caller falls back to a shell with no motion of its own.
 */
function demoTimelineScript(demoHtml: string): { code: string; id: string } | null {
  const scripts = [...demoHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? "")
    .filter((code) => code.includes("__timelines"));
  const code = scripts.length === 1 ? scripts[0] : null;
  if (code == null) return null;
  const ids = new Set(
    [...code.matchAll(/__timelines\[\s*["']([^"']+)["']\s*\]/g)].map((m) => m[1]),
  );
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  return id ? { code, id } : null;
}

/** Whether a composition builds a timeline of its own. The recipe in the
 *  trailing comment of a snippet does not count: a comment animates nothing. */
function ownsTimeline(html: string): boolean {
  return html.replace(/<!--[\s\S]*?-->/g, "").includes("__timelines");
}

/** Whether mounting a composition would draw anything. Several of these items
 *  are "add this class to your own element" snippets — a <style> and a <script>
 *  and no markup — so a shell that mounts one renders an empty box. */
function hasRenderableMarkup(html: string): boolean {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
      .trim().length > 0
  );
}

/**
 * The demo's timeline, rebuilt against the mounted composition.
 *
 * Most of these items are snippets — markup, CSS and a variable reader, and no
 * timeline at all. What animates them is a recipe in a trailing comment, whose
 * only executable copy is the demo's script. Mounting the snippet by itself
 * therefore renders a still frame, which is the one thing a motion catalog
 * cannot ship.
 *
 * That script selects the primitive's own classes, and the runtime mounts a
 * sub-composition into this same document, so the selectors resolve. Running it
 * once the mount has landed and nesting the timeline it builds under the
 * shell's root gets the demo's motion and the panel's values at the same time.
 */
function timelineTransplant(rootId: string, demoTimeline: { code: string; id: string }): string {
  const demoId = JSON.stringify(demoTimeline.id);
  return [
    "    <script>",
    "      (function () {",
    '        var mount = document.getElementById("hf-vars-mount");',
    "        // The mount is filled asynchronously, and the demo script selects",
    "        // what it fills it with, so it cannot run before then.",
    "        var observer = new MutationObserver(build);",
    "        observer.observe(mount, { childList: true, subtree: true });",
    "        build();",
    "        function build() {",
    "          if (!mount.firstElementChild) return;",
    "          observer.disconnect();",
    demoTimeline.code.replace(/\s+$/, ""),
    `          var child = window.__timelines[${demoId}];`,
    `          delete window.__timelines[${demoId}];`,
    '          if (!child || typeof child.paused !== "function") return;',
    "          child.paused(false);",
    `          window.__timelines[${JSON.stringify(rootId)}].add(child, 0);`,
    "        }",
    "      })();",
    "    </script>",
  ].join("\n");
}

/**
 * A composition that exists only to mount this item, for items whose demo
 * hard-codes what the variables are supposed to control.
 *
 * 60 of the 173 items that declare variables ship a demo predating them: the
 * markup and CSS are written out literally, so no value delivered to that
 * document can move anything. Mounting the item's own file is the only way the
 * preview answers the panel. The cost is the demo's framing and, for the items
 * whose motion lives in the demo rather than the file, its motion.
 *
 * ponytail: fixed 1920×1080 for components (what they are authored against);
 * per-item sizing would need a signal no manifest carries.
 */
function writeVariablesHost(
  destDir: string,
  manifest: RegistryItem,
  ownFile: string,
  demoHtml: string,
  demoTimeline: { code: string; id: string } | null,
): string {
  const width = isBlockItem(manifest) ? manifest.dimensions.width : 1920;
  const height = isBlockItem(manifest) ? manifest.dimensions.height : 1080;
  const duration = isBlockItem(manifest) ? manifest.duration : 5;
  const rootId = `${manifest.name}-variables-preview`;

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    `    <meta name="viewport" content="width=${width}, height=${height}" />`,
    `    <title>${manifest.title} variables preview</title>`,
    "    <style>",
    `      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: ${demoBackground(demoHtml)}; }`,
    `      #hf-vars-root { position: relative; width: ${width}px; height: ${height}px; }`,
    "      #hf-vars-mount { position: absolute; inset: 0; display: grid; place-items: center; }",
    "    </style>",
    '    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
    "  </head>",
    "  <body>",
    `    <div id="hf-vars-root" data-composition-id="${rootId}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${duration}" data-fps="30">`,
    `      <div id="hf-vars-mount" class="clip" data-composition-id="${manifest.name}" data-composition-src="./${ownFile}" data-start="0" data-duration="${duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div>`,
    "    </div>",
    "    <script>",
    "      window.__timelines = window.__timelines || {};",
    `      window.__timelines[${JSON.stringify(rootId)}] = gsap.timeline({ paused: true });`,
    "    </script>",
    ...(demoTimeline ? [timelineTransplant(rootId, demoTimeline)] : []),
    variableBootstrap(ownFile),
    "  </body>",
    "</html>",
    "",
  ].join("\n");

  writeFileSync(join(destDir, VARIABLES_HOST_FILE), html);
  return VARIABLES_HOST_FILE;
}

const VARIABLES_HOST_FILE = "__hf-variables-preview.html";

/**
 * The wrapper for an item the explorer drives.
 *
 * A composition reads its variables once, at init, so a new value can only
 * arrive by loading the composition again. That reload is deliberately kept one
 * frame deep: the explorer talks to this wrapper, and only the player's own
 * iframe reloads. The page, the wrapper and the panel never blink, and the
 * playhead is carried across so a change mid-shot does not throw the reader
 * back to frame zero.
 *
 * Values travel in the query string rather than a message into the composition
 * because they have to be readable before its first script runs. The path is
 * untouched, so `data-composition-src="./sibling.html"` still resolves.
 *
 * Every hop re-encodes with `encodeURIComponent` and reads with
 * `URLSearchParams.get`, so a value is percent-encoded on the wire no matter
 * how it arrived — including from a player build that form-encoded it.
 */
export function variablePreviewWrapper(src: string): string[] {
  return [
    '<hyperframes-player id="p" controls muted></hyperframes-player>',
    "<script>",
    "  const player = document.getElementById('p');",
    `  const BASE = ${JSON.stringify(src)};`,
    "  const load = (values) => player.setAttribute('src', values ? BASE + '?hfv=' + values : BASE);",
    "",
    "  // Retry until the clock actually moves. `ready` can flip before the runtime",
    "  // the player injects for a mounted sub-composition has finished wiring up, and",
    "  // a play() that lands in that window silently does nothing. It gives up rather",
    "  // than spinning forever: in a hidden tab the rAF clock never advances at all.",
    "  let poll = null;",
    "  const arm = (resumeAt) => {",
    "    clearInterval(poll);",
    "    let last = -1;",
    "    let tries = 0;",
    "    let seeked = false;",
    "    poll = setInterval(() => {",
    "      if (player.ready) {",
    "        if (!seeked) {",
    "          seeked = true;",
    "          if (resumeAt > 0) player.seek(resumeAt);",
    "        }",
    "        player.play();",
    "      }",
    "      if (seeked && player.currentTime > 0 && player.currentTime !== last) {",
    "        clearInterval(poll);",
    "        return;",
    "      }",
    "      last = player.currentTime;",
    "      if (++tries > 150) clearInterval(poll);",
    "    }, 100);",
    "  };",
    "",
    "  const initial = new URLSearchParams(location.search).get('hfv');",
    "  load(initial && encodeURIComponent(initial));",
    "  arm(0);",
    "",
    "  addEventListener('message', (event) => {",
    "    if (event.origin !== location.origin) return;",
    "    const values = event.data && event.data.hfVariables;",
    "    if (!values) return;",
    "    const resumeAt = player.currentTime || 0;",
    "    load(encodeURIComponent(JSON.stringify(values)));",
    "    arm(resumeAt);",
    "  });",
    "  player.addEventListener('ended', () => { player.seek(0); player.play(); });",
    "</script>",
  ];
}

/**
 * Copy an item's demo composition into docs/public and wrap it in a player.
 *
 * Returns "none" when the item ships nothing to play, which is the caller's
 * signal to fall back to a recorded video, and "variables" only when the
 * explorer's values can actually reach what is on screen.
 *
 * The wrapper exists so the page can embed the preview in an iframe. Dropping
 * <hyperframes-player> straight into the MDX would put a composition's own
 * global CSS — and compositions do set styles on `body` — in the same document
 * as the documentation around it.
 *
 * A drivable item switches on the explorer's plumbing: the composition gets
 * the `?hfv=` reader, and the wrapper gets a listener that reloads it with new
 * values. Every other item keeps byte-identical output.
 */
function writePlayerPreview(
  kind: ItemKind,
  manifest: RegistryItem,
  variables: ItemVariable[] = [],
): "none" | "player" | "variables" {
  const dir = typeDir(kind);
  const itemDir = join(registryDir, dir, manifest.name);
  if (!existsSync(itemDir)) return "none";

  // demo.html first: where an item ships one it is the version built to be
  // watched on its own. Blocks mostly ship none, but a block *is* a standalone
  // composition document, so its own file plays without anything wrapped round it.
  const entry = ["demo.html", `${manifest.name}.html`].find((f) => existsSync(join(itemDir, f)));
  if (!entry) return "none";

  // The whole directory, because a demo is usually a mount shell pointing at a
  // sibling with data-composition-src="./<name>.html". Copying just the entry
  // file leaves that reference dangling and the preview renders empty.
  const destDir = join(docsDir, "public", "catalog", dir, manifest.name);
  mkdirSync(destDir, { recursive: true });

  // The item's own file, as a demo would reference it. Both the bootstrap's
  // host filter and the generated fallback host are keyed on it.
  const ownFile = primaryFileFor(manifest)?.path.split("/").pop() ?? `${manifest.name}.html`;
  const entryHtml = readFileSync(join(itemDir, entry), "utf-8");
  const demoMountsItself = new RegExp(
    `data-composition-src=["'][^"']*${ownFile.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}["']`,
  ).test(entryHtml);

  const ownPath = join(itemDir, ownFile);
  const ownHtml = existsSync(ownPath) ? readFileSync(ownPath, "utf-8") : "";

  // Values reach the preview through the demo where it mounts the item itself,
  // and through a generated shell otherwise — but a shell can only mount what
  // the item's file draws, and a markup-less snippet draws nothing. A blank
  // preview is worse than one whose knobs are dead, so those items keep the
  // demo, and the caller leaves the panel off rather than shipping a control
  // that moves nothing.
  const drivable = variables.length > 0 && (demoMountsItself || hasRenderableMarkup(ownHtml));

  // Recursive, because 38 items keep their assets in a subdirectory — models/,
  // lib/, assets/ — and reference them relatively. Copying only the top level
  // left every one of those 404ing in the docs preview: the composition still
  // renders, so nothing failed, it just quietly drew without its model.
  const copyItemTree = (fromDir: string, toDir: string): void => {
    mkdirSync(toDir, { recursive: true });
    for (const entryName of readdirSync(fromDir)) {
      if (entryName === "registry-item.json") continue;
      const from = join(fromDir, entryName);
      // lstat, not stat: a symlinked directory would otherwise be followed,
      // and one pointing at an ancestor recurses until the disk fills.
      const stats = lstatSync(from);
      if (stats.isSymbolicLink()) continue;
      if (!stats.isFile()) {
        copyItemTree(from, join(toDir, entryName));
        continue;
      }
      const copy =
        drivable && fromDir === itemDir && entryName === entry
          ? Buffer.from(appendToBody(entryHtml, variableBootstrap(ownFile)))
          : readFileSync(from);
      writeFileSync(join(toDir, entryName), copy);
    }
  };
  copyItemTree(itemDir, destDir);

  // A demo that hard-codes the piece cannot answer the panel however the
  // values are delivered, so the preview mounts the item's own file instead —
  // and, where the item is a snippet with no timeline of its own, carries the
  // demo's motion across with it rather than shipping a still frame.
  const host =
    drivable && !demoMountsItself
      ? writeVariablesHost(
          destDir,
          manifest,
          ownFile,
          entryHtml,
          entry === ownFile || ownsTimeline(ownHtml) ? null : demoTimelineScript(entryHtml),
        )
      : entry;

  const wrapperDir = join(docsDir, "public", "catalog", "preview", dir);
  mkdirSync(wrapperDir, { recursive: true });

  // The player's src is relative so the preview keeps working whatever prefix
  // the docs are served under. The wrapper and the composition move together.
  const wrapper = [
    "<!doctype html>",
    '<meta charset="utf-8" />',
    `<title>${manifest.title} preview</title>`,
    "<style>",
    "  html, body { margin: 0; height: 100%; background: transparent; }",
    "  hyperframes-player { display: block; width: 100%; height: 100%; }",
    "</style>",
    '<script type="module" src="https://cdn.jsdelivr.net/npm/@hyperframes/player"></script>',
    ...(drivable
      ? variablePreviewWrapper(`../../${dir}/${manifest.name}/${host}`)
      : [
          `<hyperframes-player id="p" src="../../${dir}/${manifest.name}/${entry}" controls muted></hyperframes-player>`,
          "<script>",
          "  // Retry until the clock actually moves. `ready` can flip before the runtime",
          "  // the player injects for a mounted sub-composition has finished wiring up, and",
          "  // a play() that lands in that window silently does nothing.",
          "  //",
          "  // It stops rather than spinning forever: the clock runs on requestAnimationFrame,",
          "  // which browsers suspend in a hidden tab, so a preview nobody is looking at will",
          "  // never advance and there is nothing here to fix by retrying. An automated check",
          "  // of a background tab reads currentTime 0 for that reason, not for a broken one.",
          "  const player = document.getElementById('p');",
          "  let last = -1;",
          "  let tries = 0;",
          "  const start = setInterval(() => {",
          "    if (player.currentTime > 0 && player.currentTime !== last) {",
          "      clearInterval(start);",
          "      return;",
          "    }",
          "    last = player.currentTime;",
          "    if (player.ready) player.play();",
          "    if (++tries > 30) clearInterval(start);",
          "  }, 500);",
          "  player.addEventListener('ended', () => { player.seek(0); player.play(); });",
          "</script>",
        ]),
    "",
  ].join("\n");
  writeFileSync(join(wrapperDir, `${manifest.name}.html`), wrapper);
  return drivable ? "variables" : "player";
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

interface ItemVariable {
  id: string;
  type: string;
  role?: string;
  label?: string;
  description?: string;
  default?: string | number | boolean;
  options?: { value: string; label?: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** The allowed values for one variable, written the way a reader has to type them. */
function variableRange(v: ItemVariable): string {
  if (v.options?.length) return v.options.map((o) => `\`${o.value}\``).join(", ");
  if (typeof v.min === "number" && typeof v.max === "number") {
    const unit = v.unit ? `${v.unit}` : "";
    const step = typeof v.step === "number" ? `, step ${v.step}${unit}` : "";
    return `${v.min}${unit} to ${v.max}${unit}${step}`;
  }
  return v.type;
}

/**
 * A mount element carrying this item's variables, with its own defaults filled in.
 *
 * The table above lists what can be set; without this the reader is told to "set
 * them on the element" by a page that never shows the element. Defaults are used
 * as the values so the snippet is copy-and-run correct before it is edited.
 */
function generateVariableUsage(manifest: RegistryItem, target: string): string[] {
  const raw = (manifest as RegistryItem & { variables?: ItemVariable[] }).variables;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const withDefaults = raw.filter((v) => v.default !== undefined);
  if (withDefaults.length === 0) return [];

  const values = JSON.stringify(Object.fromEntries(withDefaults.map((v) => [v.id, v.default])));
  return [
    "Set them with `data-variable-values` on the element that mounts it. These are the",
    "defaults, so this behaves exactly like the preview above until you change one:",
    "",
    "```html wrap",
    "<div",
    `  data-composition-id="${manifest.name}"`,
    `  data-composition-src="${target}"`,
    `  data-variable-values='${values}'`,
    "></div>",
    "```",
    "",
  ];
}

function itemVariables(manifest: RegistryItem): ItemVariable[] {
  const raw = (manifest as RegistryItem & { variables?: ItemVariable[] }).variables;
  return Array.isArray(raw) ? raw : [];
}

/**
 * Preview, paste-ready snippet and every control over both, as one component.
 *
 * This is what the static `## Variables` table and the `data-variable-values`
 * block below it used to be. The table could say `glow` accepts `none |
 * standard | strong` and could not show what any of them looked like; a reader
 * had to install the item to find out. Descriptions survive the move — they
 * sit under their own control instead of in a column.
 */
function generateVariablesExplorer(
  kind: ItemKind,
  manifest: RegistryItem,
  variables: ItemVariable[],
  target: string,
): string[] {
  const open = [
    "<VariablesExplorer",
    `  previewSrc="${playerPreviewUrl(kind, manifest)}"`,
    `  compositionId="${manifest.name}"`,
    `  compositionSrc="${target}"`,
    `  variables={${JSON.stringify(variables)}}`,
  ];

  // The source, as a real fence inside the component. It is static — a reader
  // dragging a knob changes the mount snippet, never this — so it can be
  // highlighted at build time by the same shiki pass that colours every other
  // fence on the site, instead of being coloured by hand in the browser. MDX
  // parses a fenced block in JSX children as markdown, provided it is set off
  // by blank lines, and hands the compiled block down as `children`.
  const file = primarySource(kind, manifest);
  if (!file) return [...open, "/>", ""];

  return [
    ...open,
    ">",
    "",
    "```html " + file.path,
    file.source,
    "```",
    "",
    "</VariablesExplorer>",
    "",
  ];
}

function generateVariables(manifest: RegistryItem): string[] {
  const raw = (manifest as RegistryItem & { variables?: ItemVariable[] }).variables;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const lines: string[] = [
    "## Variables",
    "",
    "Every one of these has a default, so the piece works untouched. Set the ones you",
    "want to change on the element:",
    "",
    "| Variable | Default | Accepts | What it does |",
    "| --- | --- | --- | --- |",
  ];
  for (const v of raw) {
    // A missing description is left blank rather than filled with the label
    // again — a column that repeats its neighbour teaches the reader to skip it.
    const what = v.description ?? "";
    const def = v.default === undefined ? "" : `\`${v.default}\``;
    lines.push(`| \`${v.id}\` | ${def} | ${variableRange(v)} | ${what} |`);
  }
  lines.push("");
  return lines;
}

// fallow-ignore-next-line complexity
/**
 * The item's own source, collapsed.
 *
 * Without this the page can only tell the reader to go and open a file they have
 * not installed yet. Collapsed because these run to several hundred lines and an
 * expanded wall of markup would push everything else off the page.
 */
function primarySource(
  kind: ItemKind,
  manifest: RegistryItem,
): { path: string; source: string } | null {
  const file = primaryFileFor(manifest);
  if (!file) return null;
  const path = join(registryDir, typeDir(kind), manifest.name, file.path);
  if (!existsSync(path)) return null;

  const source = readFileSync(path, "utf-8").trimEnd();
  // A fence inside the source would close the one wrapping it.
  if (source.includes("```")) return null;

  return { path: file.path, source };
}

function generateSource(kind: ItemKind, manifest: RegistryItem): string[] {
  const file = primarySource(kind, manifest);
  if (!file) return [];

  return [
    "## Source",
    "",
    "<Accordion title={`" + file.path + "`}>",
    "",
    "```html",
    file.source,
    "```",
    "",
    "</Accordion>",
    "",
  ];
}

/** The one thing above the fold: an explorer, a player, a texture sheet or a recorded video. */
function previewSection(
  kind: ItemKind,
  manifest: RegistryItem,
  state: {
    textureGroups: ReturnType<typeof textureGroupsFor>;
    variables: ItemVariable[];
    hasPlayer: boolean;
    explorer: boolean;
  },
): string[] {
  if (state.textureGroups.length > 0) return generateTexturePreview(manifest, state.textureGroups);
  const primaryTarget = primaryFileFor(manifest)?.target ?? `compositions/${manifest.name}.html`;
  if (state.explorer) {
    return generateVariablesExplorer(kind, manifest, state.variables, primaryTarget);
  }
  if (state.hasPlayer) {
    return [
      `<iframe src="${playerPreviewUrl(kind, manifest)}" className="w-full aspect-video rounded-xl border border-zinc-200 dark:border-zinc-800" loading="lazy" title="${manifest.title} preview" />`,
      "",
    ];
  }
  // No demo.html to play, so fall back to the recorded video. Blocks are the
  // population that lands here: 125 of 132 ship no demo.
  const previewPath = `${catalogImageBase}/${typeDir(kind)}/${manifest.name}`;
  // Same source of truth as the index: a manifest that declares a preview
  // without a poster has no .png, and asking for one is a 403 the browser
  // fetches before the video.
  const posterUrl = catalogPreviewFor(kind, manifest);
  const poster = posterUrl ? ` poster="${posterUrl}"` : "";
  return [
    `<video className="w-full aspect-video rounded-xl object-cover bg-zinc-100 dark:bg-zinc-800" src="${previewPath}.mp4"${poster} autoPlay muted loop playsInline />`,
    "",
  ];
}

/** How to use it. Empty when a human already wrote that section by hand. */
function usageSection(
  kind: ItemKind,
  manifest: RegistryItem,
  primaryTarget: string,
  carried: CarriedContent,
  textureGroups: ReturnType<typeof textureGroupsFor>,
): string[] {
  const lines: string[] = [];
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
  return lines;
}

/** Tags, author and the source prompt, in the order a reader wants them least. */
function footerSection(
  manifest: RegistryItem,
  tags: readonly string[],
  source: RegistryItem & SourceMetadata,
): string[] {
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
  return footer;
}

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
  // The explorer owns the preview, so it can only be emitted for an item whose
  // preview is a live player. A texture sheet or a recorded video has nothing
  // to drive, and those items keep the static table.
  const variables = textureGroups.length > 0 ? [] : itemVariables(manifest);
  const preview =
    textureGroups.length === 0 ? writePlayerPreview(kind, manifest, variables) : "none";
  const hasPlayer = preview !== "none";
  const explorer = preview === "variables";

  const lines: string[] = [
    "---",
    `title: ${yamlString(manifest.title)}`,
    `description: ${yamlString(manifest.description)}`,
    "---",
    "",
    'import { InstallCommand } from "/snippets/install-command.jsx";',
    ...(explorer ? ['import { VariablesExplorer } from "/snippets/variables-explorer.jsx";'] : []),
    "",
  ];

  // 1. What it looks like, before anything else. Credits, tags and the source
  //    prompt used to sit above this and pushed the preview below the fold.
  lines.push(...previewSection(kind, manifest, { textureGroups, variables, hasPlayer, explorer }));

  // 2. How to get it. A CodeGroup around a single block just drew an empty tab bar.
  lines.push(
    "## Install",
    "",
    `<InstallCommand command="${installCmd}" />`,
    "",
    installOutcome(manifest, primaryTarget),
    "",
  );

  // Prerequisite where it bites: you need the flag to preview what you just installed.
  if (tags.includes("html-in-canvas")) {
    lines.push(
      // Danger, not Warning: without the flag the preview on this page is a
      // black rectangle, so this is a prerequisite for seeing anything rather
      // than a caveat about the result.
      "<Danger>",
      "  Live preview needs the `chrome://flags/#canvas-draw-element` flag switched on.",
      "  Without it this item's screen renders black. Rendering from the CLI switches",
      "  it on for you. [How it works](/guides/html-in-canvas)",
      "</Danger>",
      "",
    );
  }

  // 3. How to use it — unless a human already wrote that section, in which case
  //    their version is carried through below instead of being overwritten.
  lines.push(...usageSection(kind, manifest, primaryTarget, carried, textureGroups));

  lines.push(...generateParams(manifest));
  if (!explorer) {
    lines.push(...generateVariables(manifest));
    lines.push(...generateVariableUsage(manifest, primaryTarget));
  }

  // The explorer's Code tab already shows this exact file, so an accordion
  // under it would be the same source twice on one page. `source` stays in
  // GENERATED_HEADINGS, so the section a previous revision wrote is dropped on
  // regeneration rather than carried forward as if a human had written it.
  if (!explorer) lines.push(...generateSource(kind, manifest));

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
  const footer = footerSection(manifest, tags, source);

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
    "Motion Primitives": 9,
    "Motion Scenes": 11,
    "Typography & Text": 10,
    "Camera & 3D": 12,
    "Product Demo": 13,
    Texture: 14,
    Effects: 15,
    Blocks: 16,
  };

  // fallow-ignore-next-line complexity
  function groupForItem(entry: CatalogEntry): string {
    const tags = entry.tags;
    // Declared membership beats every inferred rule below: `video-primitive` is
    // the tag a human puts on an item to put it on the primitives shelf, and it
    // must not be overridden by whatever else the item happens to be tagged.
    if (tags.includes("video-primitive")) return "Motion Primitives";
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
    // Split what used to be one 267-item "Effects" list. Ordered most specific
    // first: an item tagged both `camera` and `motion-primitive` is a camera
    // move, which is the narrower and more useful shelf to find it on.
    if (tags.includes("texture")) return "Texture";
    if (tags.includes("camera") || tags.includes("3d")) return "Camera & 3D";
    if (
      tags.includes("product-demo") ||
      tags.includes("demonstrate") ||
      tags.includes("pointers")
    ) {
      return "Product Demo";
    }
    if (
      tags.includes("typography") ||
      tags.includes("text-effects") ||
      tags.includes("text") ||
      tags.includes("caption-style")
    ) {
      return "Typography & Text";
    }
    if (tags.includes("motion-primitive")) return "Motion Scenes";
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
