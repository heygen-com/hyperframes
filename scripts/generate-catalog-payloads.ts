#!/usr/bin/env tsx
/**
 * Generate Catalog Preview Payloads
 *
 * Writes each catalog item's compiled composition to
 * `docs/public/catalog/<type>/<name>.json` so the docs site can mount it in a
 * live `<hyperframes-player>` instead of an uploaded MP4.
 *
 * Why JSON and not the composition HTML itself: the docs host publishes only
 * JSON and image files out of `docs/public`. `.html`, `.js` and `.css` are
 * dropped from the build with no error, so a preview shipped as an HTML file
 * 404s in production while its page still serves. The player takes the
 * composition as a `srcdoc` string, so JSON is the delivery format that both
 * survives the deploy and matches what the player wants.
 *
 * An item needing `chrome://flags/#canvas-draw-element` gets
 * `{ unsupported: "canvas-draw-element" }` at the same path instead of `{ html }`.
 *
 * Usage:
 *   npx tsx scripts/generate-catalog-payloads.ts                    # all items
 *   npx tsx scripts/generate-catalog-payloads.ts --only data-chart  # single item
 *   npx tsx scripts/generate-catalog-payloads.ts --type block       # blocks only
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { installFetchMirror } from "./catalog-fetch-mirror.ts";
import {
  discoverItems,
  prepareProjectDir,
  type CatalogItem,
  type ItemKind,
} from "./generate-catalog-previews.js";
import { isLocalAsset } from "./registry-hosted-assets.ts";
import { componentFiles } from "./catalog/component-files.ts";
import { runAsCommand } from "./entrypoint.ts";
import { snippetOwnsItsMotion, PREFER_AUTHORED_DEMO } from "./catalog/component-variables.ts";
import {
  clearPinnedVariableValues,
  externalizeDataUris,
  inlineMountedComposition,
  HOSTED_EXTENSIONS,
  hostItemDirectory,
  type HostItemDirectoryResult,
  localReferences,
  processAssets,
  withBaseHref,
} from "./catalog-payload-assets.ts";
import {
  inlineCatalogScripts,
  needsScriptInlining,
  writeSharedVendorScripts,
} from "./catalog-script-inlining.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
// The drift check points this at a temp dir to generate without touching the committed tree.
export const payloadRoot = resolve(
  process.env.CATALOG_PAYLOAD_ROOT ?? resolve(repoRoot, "docs/public/catalog"),
);

/**
 * Inlining budget for a single payload. A payload is fetched when the reader
 * opens the page, so it competes with the page itself rather than with a video
 * they chose to play. Items over budget keep their uploaded MP4.
 *
 * Measured across the current catalog: 148 asset-free payloads run 3 KB to
 * 930 KB (median 11 KB), and the heaviest asset-bearing item inlines to roughly
 * 5.8 MB because it embeds a real video. This sits above every item but that
 * one, which is the item an MP4 preview actually suits.
 */
const MAX_PAYLOAD_BYTES = Number(process.env.CATALOG_MAX_PAYLOAD_BYTES ?? 3_000_000);

/**
 * Compositions that paint DOM into a canvas via `ctx.drawElementImage()`.
 *
 * That API sits behind `chrome://flags/#canvas-draw-element`, so a reader
 * without the flag gets a preview that mounts, plays, and shows an empty
 * canvas. The recorded video was captured by a renderer that does have it, so
 * it is the only preview these items can honestly show.
 */
function needsCanvasDrawElement(html: string): boolean {
  return html.includes("drawElementImage");
}

function typeDir(kind: ItemKind): string {
  return kind === "block" ? "blocks" : "components";
}

/**
 * Does this item build paths we cannot see?
 *
 * Two tells. A reference the scan found but could not resolve is one, and a
 * manifest that declares assets the scan never matched is the other: the
 * texture blocks name their masks in the manifest and then assemble the URL in
 * a script, so the files are declared but never written down as a path.
 */
function needsOwnDirectory(item: CatalogItem, unresolved: string[]): boolean {
  if (unresolved.length > 0) return true;
  try {
    const manifest = JSON.parse(
      readFileSync(join(item.sourceDir, "registry-item.json"), "utf-8"),
    ) as { files?: { type?: string; url?: string }[] };
    // A hosted file is deliberately absent from the copied project and is
    // referenced by URL, so it is not a path this directory could satisfy.
    // Counting it here published 24 images per block to serve references that
    // already point somewhere else.
    return (manifest.files ?? []).some(isLocalAsset);
  } catch {
    return false;
  }
}

/** Does the item ship anything the host can serve beside the payload? */
function hostsOwnDirectory(projectDir: string): boolean {
  const stack = [projectDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(join(dir, entry.name));
        continue;
      }
      if (HOSTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) return true;
    }
  }
  return false;
}

/** Does the item expose variables a reader is meant to change? */
function declaresVariables(item: CatalogItem): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(item.sourceDir, "registry-item.json"), "utf-8"),
    ) as { variables?: unknown[] };
    return Array.isArray(manifest.variables) && manifest.variables.length > 0;
  } catch {
    return false;
  }
}

/**
 * Which file this component's interactive preview is built from.
 *
 * `snippet` for the ones that register their own timeline: the snippet alone is
 * a whole piece, and building from it carries markup, variables and motion
 * together. `demo` for the ones that are markup plus a commented recipe, where
 * the demo owns the motion. Those demos carry the snippet's variable machinery
 * in the registry itself, kept in step by
 * `scripts/catalog/sync-demo-variables.ts`, so nothing has to be patched in
 * here at build time.
 */
function snippetFileFor(item: CatalogItem): string | null {
  if (item.kind !== "component") return null;
  return componentFiles(item.sourceDir)?.snippetPath ?? null;
}

function buildsFromSnippet(item: CatalogItem, snippetFile: string): boolean {
  return (
    snippetOwnsItsMotion(readFileSync(snippetFile, "utf-8")) && !PREFER_AUTHORED_DEMO.has(item.name)
  );
}

function previewSource(item: CatalogItem): { mode: "snippet" | "demo"; file: string } | null {
  const file = snippetFileFor(item);
  if (!file) return null;
  return { mode: buildsFromSnippet(item, file) ? "snippet" : "demo", file };
}

/**
 * What the preview is built from, and whether that is the component's snippet.
 *
 * A component whose snippet owns its motion gets its preview built from that
 * snippet, so variables and animation arrive together. Everything else keeps
 * its authored entry.
 */
function renderEntry(
  item: CatalogItem,
  interactive: boolean,
): { entry: CatalogItem; fromSnippet: boolean } {
  const source = interactive ? previewSource(item) : null;
  if (source?.mode !== "snippet") return { entry: item, fromSnippet: false };

  const entry = { ...item, entryFile: relative(item.sourceDir, source.file) };
  return { entry, fromSnippet: true };
}

type ComposedPayload = { status: "over-budget" } | ({ status: "ok" } & ComposedParts);

interface ComposedParts {
  html: string;
  hosted: number;
  inlined: number;
  externalized: number;
  unresolved: string[];
}

/** Publishes the item's own directory and points `<base>` at it, rescuing paths a script
 * builds at runtime. Only for items that need it: doing this for every item would double storage. */
function resolveBaseHref(
  item: CatalogItem,
  projectDir: string,
  interactive: boolean,
  unresolved: string[],
): HostItemDirectoryResult {
  if (!interactive && !needsOwnDirectory(item, unresolved)) return { status: "not-needed" };
  const itemUrl = `/public/catalog/items/${item.name}`;
  return hostItemDirectory(projectDir, join(payloadRoot, "items", item.name), `${itemUrl}/`);
}

/** An interactive preview inlines the component and clears its pinned demo values,
 * so the reader's own choices reach it instead. */
function applyInteractiveMount(html: string, projectDir: string, interactive: boolean): string {
  if (!interactive) return html;
  return clearPinnedVariableValues(inlineMountedComposition(html, projectDir));
}

const SCRIPT_REF = /\.(js|mjs|hdr)(?:[?#].*)?$/i;

/** For an item whose scripts are inlined, a script ref is resolved once the reference finder no
 * longer sees it in the output. One still found stays unresolved: the docs host never serves
 * script files, so no base URL can rescue it. */
function dropInlinedScriptRefs(itemName: string, html: string, unresolved: string[]): string[] {
  if (!needsScriptInlining(itemName)) return unresolved;
  const remaining = new Set(localReferences(html));
  return unresolved.filter((ref) => !SCRIPT_REF.test(ref) || remaining.has(ref));
}

/** Turns a compiled composition's HTML into the final payload markup: resolves/inlines
 * every asset, publishes the item's own directory when needed, settles on a `<base href>`. */
function composePayloadHtml(
  item: CatalogItem,
  projectDir: string,
  html: string,
  interactive: boolean,
  vendorUrls: Record<string, string>,
): ComposedPayload {
  const assetTarget = { dir: join(payloadRoot, "assets"), urlBase: "/public/catalog/assets" };
  const {
    html: withAssets,
    hosted,
    inlined,
    unresolved,
  } = processAssets(html, projectDir, assetTarget, needsScriptInlining(item.name));

  // Compositions arrive with their fonts already embedded, so this catches
  // what never looked like a reference in the first place.
  const { html: withShared, externalized } = externalizeDataUris(withAssets, assetTarget);

  // The docs host's extension allowlist blocks `.js`/`.mjs`/`.hdr`, so the
  // items registered in SCRIPT_INLINERS need their scripts travelling inside
  // the payload instead of hosted as a file — see catalog-script-inlining.ts.
  const withInlineScripts = inlineCatalogScripts(item.name, withShared, projectDir, vendorUrls);

  const hostResult = resolveBaseHref(item, projectDir, interactive, unresolved);
  if (hostResult.status === "over-budget") return { status: "over-budget" };
  const baseHref = hostResult.status === "hosted" ? hostResult.baseHref : "";
  const withMount = applyInteractiveMount(withInlineScripts, projectDir, interactive);

  return {
    status: "ok",
    html: withBaseHref(withMount, baseHref),
    hosted,
    inlined,
    externalized,
    unresolved: dropInlinedScriptRefs(item.name, withInlineScripts, unresolved),
  };
}

// Pre-existing complexity from the item's independent skip conditions.
// fallow-ignore-next-line complexity
export async function buildPayload(
  item: CatalogItem,
  vendorUrls: Record<string, string> = {},
): Promise<"written" | "skipped"> {
  const outPath = join(payloadRoot, typeDir(item.kind), `${item.name}.json`);

  // An item that stops qualifying has to lose its payload, or the page
  // generator keeps finding one on disk and emits a player for a preview this
  // run just decided it cannot build.
  const dropStalePayload = () => rmSync(outPath, { force: true });
  const writePayload = (body: object) => {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(body), "utf-8");
  };

  // A composition whose variables are meant to be changed has to reach the
  // reader uncompiled, or its values are already resolved into the markup.
  const interactive = declaresVariables(item);
  const { entry, fromSnippet } = renderEntry(item, interactive);

  let projectDir: string;
  try {
    projectDir = await prepareProjectDir(entry, {
      compile: !interactive,
      uiFragment: fromSnippet,
      // A payload is fetched by a browser, not rendered here, so a hosted asset
      // is already reachable at its URL. Downloading it would only move the
      // bytes into `docs/public/`, which the repository carries just the same.
      hostedAssets: "cdn",
    });
  } catch (err) {
    // Some items are a stylesheet and a paragraph of prose — a class you add to
    // your own captions, with no standalone scene to show. That is a shape, not
    // a breakage, and calling it a failure made every run look wrong. The item
    // keeps its recorded video, which is the only honest preview it has.
    const message = err instanceof Error ? err.message : String(err);
    if (!/no <template> or <body> content to render/.test(message)) throw err;
    console.log(`  – ${item.name}: nothing to render on its own, keeping the recorded video`);
    dropStalePayload();
    return "skipped";
  }
  try {
    const html = readFileSync(join(projectDir, "index.html"), "utf-8");

    if (needsCanvasDrawElement(html)) {
      // A marker file, not an absence: the catalog card reads this to show an honest
      // "needs this flag" tile instead of silently falling back to nothing.
      writePayload({ unsupported: "canvas-draw-element" });
      console.log(`  – ${item.name}: needs canvas drawElement, marked unsupported`);
      return "skipped";
    }
    const composed = composePayloadHtml(item, projectDir, html, interactive, vendorUrls);
    if (composed.status === "over-budget") {
      console.log(`  – ${item.name}: directory over the host budget, keeping the recorded video`);
      dropStalePayload();
      return "skipped";
    }
    const { html: withBase, hosted, inlined, externalized, unresolved } = composed;

    // A reference we could not inline is only fatal when the item's directory is
    // not being served either; with a base URL in place the browser can still
    // fetch it by its own relative path. A script the inliner missed is always fatal.
    const deadScript = needsScriptInlining(item.name) && unresolved.some((r) => SCRIPT_REF.test(r));
    if (unresolved.length > 0 && (deadScript || !hostsOwnDirectory(projectDir))) {
      console.log(`  – ${item.name}: cannot inline ${unresolved.slice(0, 3).join(", ")}`);
      dropStalePayload();
      return "skipped";
    }
    const bytes = Buffer.byteLength(withBase, "utf-8");
    if (bytes > MAX_PAYLOAD_BYTES) {
      console.log(`  – ${item.name}: ${(bytes / 1e6).toFixed(1)} MB payload, over budget`);
      dropStalePayload();
      return "skipped";
    }

    writePayload({ html: withBase });

    const counts = [
      hosted + externalized > 0 ? `${hosted + externalized} hosted` : "",
      inlined > 0 ? `${inlined} inlined` : "",
    ].filter(Boolean);
    const assets = counts.length > 0 ? `, ${counts.join(" + ")} asset(s)` : "";
    console.log(`  ✓ ${item.name}: ${(bytes / 1024).toFixed(0)} KB${assets}`);
    return "written";
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function parseArgs(): { only: string | null; type: ItemKind | null } {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at !== -1 ? (argv[at + 1] ?? null) : null;
  };
  const type = value("--type");
  if (type && type !== "block" && type !== "component") {
    console.error('--type must be "block" or "component"');
    process.exit(1);
  }
  return { only: value("--only"), type: (type as ItemKind | null) ?? null };
}

const fetchMirrorDir = resolve(repoRoot, "scripts/catalog-fetch-mirror");

async function main(): Promise<void> {
  const { only, type } = parseArgs();
  const mode = process.env.CATALOG_FETCH_MIRROR === "record" ? "record" : "replay";
  // A warm font cache would skip fetches the mirror needs to see, so every run starts with an empty one.
  const fontCache = mkdtempSync(join(tmpdir(), "catalog-fonts-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = fontCache;
  const mirror = installFetchMirror(fetchMirrorDir, mode);
  try {
    await generate(only, type);
    mirror.assertNoMisses();
  } finally {
    mirror.finish();
    rmSync(fontCache, { recursive: true, force: true });
  }
}

async function generate(only: string | null, type: ItemKind | null): Promise<void> {
  const items = discoverItems(type, only);
  console.log(`Building ${items.length} catalog payload(s)...\n`);

  // Written unconditionally, even for a single-item --only run, since that
  // item's own build may depend on a vendor file it doesn't itself own.
  const vendorUrls = writeSharedVendorScripts(repoRoot, payloadRoot);

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const result = await buildPayload(item, vendorUrls);
      if (result === "written") written += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      rmSync(join(payloadRoot, typeDir(item.kind), `${item.name}.json`), { force: true });
      console.error(`  ✗ ${item.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Skips are the items that keep an uploaded MP4, failures are items that
  // could not be built at all. Reporting them apart keeps a breakage from
  // reading as a considered fallback.
  console.log(`\nDone. ${written} payload(s) written, ${skipped} still on video.`);
  if (failed > 0) {
    console.log(`${failed} item(s) failed to build.`);
    process.exitCode = 1;
  }
}

runAsCommand(import.meta.url, main);
