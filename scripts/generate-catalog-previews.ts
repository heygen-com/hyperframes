#!/usr/bin/env tsx
/**
 * Generate Catalog Preview Images + Videos
 *
 * Renders preview thumbnails and videos for registry blocks and components.
 * Examples use the separate generate-template-previews.ts script.
 *
 * - Blocks:     renders the block's standalone HTML via a wrapper index.html
 * - Components: renders the component's demo.html via a wrapper index.html
 *
 * Output: docs/images/catalog/<type>/<name>.png + <name>.mp4
 *   (docs/images/ is gitignored — files are served from the CDN. After running
 *   this script, run `bun run upload:docs-images` to publish.)
 *
 * Usage:
 *   npx tsx scripts/generate-catalog-previews.ts                      # all items
 *   npx tsx scripts/generate-catalog-previews.ts --only data-chart    # single item
 *   npx tsx scripts/generate-catalog-previews.ts --type block         # blocks only
 *   npx tsx scripts/generate-catalog-previews.ts --skip-video         # thumbnails only
 */

import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogPreviewTempDir } from "./catalog-preview-temp.js";
import { runAsCommand } from "./entrypoint.ts";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  captureFrame,
  closeCaptureSession,
  createRenderJob,
  executeRenderJob,
} from "../packages/producer/src/index.js";
import { compileForRender } from "../packages/producer/src/services/htmlCompiler.js";
import { resolveContainedCopies } from "./registry-target-paths.mjs";
import { fetchHostedFiles } from "./catalog-hosted-files.js";
import { withHostedDefaults } from "./registry-hosted-assets.ts";
import { withHostedRefs } from "./catalog-script-inlining.ts";
import type { RegistryItem } from "../packages/core/src/index.js";
import { openOpaqueCapture } from "./preview-capture.js";
import { MISSING_ADAPTER } from "./verify-catalog-payloads.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = resolve(repoRoot, "registry");

if (!process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
  process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = resolve(
    repoRoot,
    "packages/core/dist/hyperframe.manifest.json",
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

export type ItemKind = "block" | "component";

export interface CatalogItem {
  name: string;
  kind: ItemKind;
  /** Directory containing the item's files in the registry. */
  sourceDir: string;
  /** The HTML file to render (relative to sourceDir). */
  entryFile: string;
}

// ── Discovery ──────────────────────────────────────────────────────────────

// Blocks and components only: examples use the existing generate-template-previews.ts.
const catalogKinds: { kind: ItemKind; dir: string }[] = [
  { kind: "block", dir: join(registryDir, "blocks") },
  { kind: "component", dir: join(registryDir, "components") },
];

function compositionEntry(manifestPath: string, name: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const compFile = manifest.files?.find(
    (f: { type: string }) => f.type === "hyperframes:composition",
  );
  return compFile?.path ?? `${name}.html`;
}

/** Authored demos show transparent overlays against representative media. */
function resolveEntryFile(kind: ItemKind, sourceDir: string, name: string): string | undefined {
  if (existsSync(join(sourceDir, "demo.html"))) return "demo.html";
  if (kind === "component") return undefined;
  return compositionEntry(join(sourceDir, "registry-item.json"), name);
}

function itemFromDir(kind: ItemKind, dir: string, name: string): CatalogItem | undefined {
  const sourceDir = join(dir, name);
  if (!existsSync(join(sourceDir, "registry-item.json"))) return undefined;
  const entryFile = resolveEntryFile(kind, sourceDir, name);
  if (entryFile === undefined || !existsSync(join(sourceDir, entryFile))) return undefined;
  return { name, kind, sourceDir, entryFile };
}

function itemsOfKind(kind: ItemKind, dir: string, nameFilter: string | null): CatalogItem[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (!nameFilter || e.name === nameFilter))
    .flatMap((e) => itemFromDir(kind, dir, e.name) ?? []);
}

function failItemNotFound(nameFilter: string): never {
  const allNames = discoverItems(null, null).map((i) => i.name);
  console.error(`Item "${nameFilter}" not found. Available: ${allNames.join(", ")}`);
  process.exit(1);
}

export function discoverItems(
  kindFilter: ItemKind | null,
  nameFilter: string | null,
): CatalogItem[] {
  const items = catalogKinds
    .filter(({ kind }) => !kindFilter || kindFilter === kind)
    .flatMap(({ kind, dir }) => itemsOfKind(kind, dir, nameFilter));

  if (nameFilter && items.length === 0) failItemNotFound(nameFilter);

  return items;
}

// ── Preview generation ─────────────────────────────────────────────────────

function outputDir(kind: ItemKind): string {
  const typeDir = kind === "block" ? "blocks" : "components";
  return resolve(repoRoot, "docs/images/catalog", typeDir);
}

/**
 * Rewrite the composition's variable defaults from local names to CDN URLs.
 *
 * These compositions build `img.src` at run time out of the variable value, so
 * there is no `src="…"` in the markup for the payload's asset scan to find.
 * That is why an item shipping images was published with a copy of its entire
 * directory: the only way to satisfy a path nobody can predict is to serve
 * every file next to it. Absolute URLs need no directory at all — the payload's
 * scan skips any `https:` reference — so 24 images per block stop being 24
 * files per block in `docs/public/`.
 *
 * Only the entry composition is touched. Nothing else in the copied project
 * declares variables, and rewriting a file the payload never reads would be a
 * change with no reader.
 */
/** Downloading is the default: a caller that says nothing wants to render. */
async function materializeHostedAssets(
  projectDir: string,
  mode: PrepareOptions["hostedAssets"],
): Promise<void> {
  if (mode === "cdn") return pointHostedAssetsAtCdn(projectDir);
  await fetchHostedFiles(projectDir);
}

function pointHostedAssetsAtCdn(projectDir: string): void {
  const manifestPath = join(projectDir, "registry-item.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;

  const entryPath = compositionPathOf(projectDir, manifest);
  if (entryPath === undefined) return;

  const html = readFileSync(entryPath, "utf-8");
  // Direct references (`src="assets/x.mp4"`, `url("assets/x.woff2")`) name a hosted file just as a
  // variable default does, and the payload has no such file beside it.
  const rewritten = withHostedRefs(rewriteVariableDefaults(html, manifest), projectDir);
  if (rewritten !== html) writeFileSync(entryPath, rewritten, "utf-8");
}

/** The item's own composition file, when it is where the manifest says it is. */
function compositionPathOf(projectDir: string, manifest: RegistryItem): string | undefined {
  const entry = manifest.files?.find((file) => file.type === "hyperframes:composition");
  if (entry === undefined) return undefined;
  const entryPath = join(projectDir, entry.path);
  return existsSync(entryPath) ? entryPath : undefined;
}

function rewriteVariableDefaults(html: string, manifest: RegistryItem): string {
  return html.replace(
    /(\sdata-composition-variables=')([^']*)(')/i,
    (whole, open: string, encoded: string, close: string) => {
      try {
        const variables = JSON.parse(decodeHtml(encoded)) as { default?: unknown }[];
        return `${open}${encodeHtml(JSON.stringify(withHostedDefaults(variables, manifest)))}${close}`;
      } catch {
        // A manifest whose attribute is not parseable JSON is a broken item, and
        // it fails loudly a moment later when the runtime reads the same string.
        // Rewriting nothing keeps this from being the error anyone sees first.
        return whole;
      }
    },
  );
}

/** The attribute is single-quoted, so only `&#39;` has to survive the round trip. */
function decodeHtml(value: string): string {
  return value.replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function encodeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
}

/**
 * Preview the item in the same layout users get after installation: some
 * components reference assets by their registry target path rather than by the
 * flat source path stored beside the manifest.
 */
function mirrorRegistryTargets(projectDir: string): void {
  const manifestPath = join(projectDir, "registry-item.json");
  if (!existsSync(manifestPath)) return;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    files?: { path?: string; target?: string }[];
  };

  // registry-item.json is untrusted: catalog-previews.yml runs on pull_request
  // for any registry change, so the manifest arrives from the PR. Containment
  // lives in its own module so the traversal cases stay testable without this
  // file's producer imports.
  for (const [from, to] of resolveContainedCopies(projectDir, manifest.files, existsSync)) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
}

export interface PrepareOptions {
  /**
   * Inline sub-compositions ahead of time. On by default, because a render
   * needs one self-contained document.
   *
   * The interactive preview turns it off: compiling resolves each mounted
   * component's variables into the markup and CSS, so nothing is left for a
   * reader to change. Left uncompiled, the mount survives and the runtime
   * loads it live, which is the only state where `data-variable-values` still
   * means anything.
   */
  compile?: boolean;
  /**
   * The mounted entry is a bare component snippet, not a staged scene.
   *
   * A snippet sizes its own type and leaves placement to whatever you paste it
   * into: its root is content with no canvas behind it and no vertical
   * placement. Mounted into the plain wrapper it lands against white in the
   * top-left corner and clips. This supplies the part its authored demo would
   * have: a dark canvas, the dark theme its own tokens are written against, and
   * the component centred with room around it.
   */
  uiFragment?: boolean;
  /**
   * How a `files[]` entry that declares `url` reaches the project.
   *
   * `"download"` writes the bytes in, which a frame render needs: it paints a
   * real page and a missing file is a blank card.
   *
   * `"cdn"` leaves them out and rewrites the composition's variable defaults to
   * the URLs instead. That is for the Catalog payload, which is fetched by a
   * browser rather than rendered here — downloading would only put the bytes
   * back in `docs/public/`, which is the repository again by another name.
   */
  hostedAssets?: "download" | "cdn";
}

/** A registration inside <template> stays inert until mounted, so it does not make the file standalone. */
function hasTimeline(entryContent: string): boolean {
  return entryContent.replace(/<template\b[\s\S]*?<\/template>/gi, "").includes("__timelines");
}

function hasSocialTag(tmpDir: string): boolean {
  try {
    const m = JSON.parse(readFileSync(join(tmpDir, "registry-item.json"), "utf-8"));
    return (m.tags ?? []).includes("social");
  } catch {
    return false;
  }
}

/** Transparent overlays get a dark backdrop, a centred position, and a scale-down for big cards. */
function styleSocialOverlay(html: string): string {
  let content = html;
  if (content.includes("background: transparent")) {
    content = content.replace("background: transparent", "background: #1a1a2e");
  }
  content = content.replace(
    /bottom:\s*\d+px;\s*\n(\s*)left:\s*50%;\s*\n(\s*)transform:\s*translateX\(-50%\)/,
    "top: 50%;\n$1left: 50%;\n$2transform: translate(-50%, -50%)",
  );
  if (/margin-top:\s*-[3-9]\d\dpx/.test(content)) {
    content = content.replace(
      /(<body[^>]*>)/,
      "$1\n<style>body { transform: scale(0.55); transform-origin: center center; }</style>",
    );
  }
  return content;
}

function writeStandaloneIndex(tmpDir: string, entryContent: string): void {
  if (!hasTimeline(entryContent)) return;
  const content = hasSocialTag(tmpDir) ? styleSocialOverlay(entryContent) : entryContent;
  writeFileSync(join(tmpDir, "index.html"), content, "utf-8");
}

/** The producer navigates to index.html: a standalone entry file is copied to it. */
function promoteStandaloneEntry(tmpDir: string, entryFile: string): void {
  if (existsSync(join(tmpDir, "index.html")) || !existsSync(join(tmpDir, entryFile))) return;
  writeStandaloneIndex(tmpDir, readFileSync(join(tmpDir, entryFile), "utf-8"));
}

interface WrapperManifest {
  dimensions?: { width?: number; height?: number };
  duration?: number;
  tags?: string[];
  files?: { path?: string; target?: string }[];
}

/** `discoverItems` already parsed this file unguarded, so only an absent file is absorbed. */
function readWrapperManifest(tmpDir: string): WrapperManifest {
  try {
    return JSON.parse(readFileSync(join(tmpDir, "registry-item.json"), "utf-8"));
  } catch {
    return {};
  }
}

function wrapperBackground(tags: string[], uiFragment: boolean | undefined): string {
  if (uiFragment) return "#0a0a0a";
  return tags.includes("social") || tags.includes("overlay") ? "#1a1a2e" : "#ffffff";
}

function manifestSize(manifest: WrapperManifest): { width: number; height: number } {
  const dims = manifest.dimensions ?? {};
  return { width: dims.width ?? 1920, height: dims.height ?? 1080 };
}

/**
 * Mount the mirrored install-layout copy when one exists: blocks reference assets the way they
 * will after `hyperframes add`, which only resolves from the target path.
 */
function wrapperEntrySrc(tmpDir: string, manifest: WrapperManifest, entryFile: string): string {
  const target = manifest.files?.find((f) => f.path === entryFile)?.target;
  return target && existsSync(join(tmpDir, target)) ? target : entryFile;
}

interface WrapperSpec {
  name: string;
  entrySrc: string;
  width: number;
  height: number;
  duration: number;
  bgColor: string;
  uiFragment: boolean | undefined;
}

function renderWrapperHtml(spec: WrapperSpec): string {
  const { name, entrySrc, width, height, duration, bgColor, uiFragment } = spec;
  // `inset: 0` keeps the mount from shrinking to its content; `center stretch` centres vertically only.
  const staging = uiFragment
    ? `\n    [data-composition-src] { inset: 0; display: grid; place-items: center stretch; box-sizing: border-box; padding: ${Math.round(height / 11)}px; }`
    : "";
  const theme = uiFragment ? ' data-hf-theme="dark"' : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>* { margin: 0; padding: 0; } html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${bgColor}; }${staging}</style>
</head>
<body>
  <div data-composition-id="preview-root" data-width="${width}" data-height="${height}" data-start="0" data-duration="${duration}"${theme}>
    <div data-composition-id="${name}" data-composition-src="${entrySrc}" data-start="0" data-duration="${duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["preview-root"] = gsap.timeline({ paused: true });
  </script>
</body>
</html>`;
}

function writeWrapperIndex(
  tmpDir: string,
  item: CatalogItem,
  uiFragment: boolean | undefined,
): void {
  const manifest = readWrapperManifest(tmpDir);
  const wrapper = renderWrapperHtml({
    name: item.name,
    entrySrc: wrapperEntrySrc(tmpDir, manifest, item.entryFile),
    ...manifestSize(manifest),
    duration: manifest.duration ?? 5,
    bgColor: wrapperBackground(manifest.tags ?? [], uiFragment),
    uiFragment,
  });
  writeFileSync(join(tmpDir, "index.html"), wrapper, "utf-8");
}

async function compileIndex(tmpDir: string, compile: boolean | undefined): Promise<void> {
  const indexPath = join(tmpDir, "index.html");
  const indexHtml = readFileSync(indexPath, "utf-8");
  if (compile === false || !indexHtml.includes("data-composition-src")) return;
  const compiled = await compileForRender(tmpDir, indexPath, join(tmpDir, "_downloads"));
  writeFileSync(indexPath, compiled.html, "utf-8");
}

export async function prepareProjectDir(
  item: CatalogItem,
  options: PrepareOptions = {},
): Promise<string> {
  const tmpDir = createCatalogPreviewTempDir(item.name);
  cpSync(item.sourceDir, tmpDir, { recursive: true });
  await materializeHostedAssets(tmpDir, options.hostedAssets);
  mirrorRegistryTargets(tmpDir);

  promoteStandaloneEntry(tmpDir, item.entryFile);
  if (!existsSync(join(tmpDir, "index.html"))) writeWrapperIndex(tmpDir, item, options.uiFragment);
  await compileIndex(tmpDir, options.compile);

  return tmpDir;
}

/** Pull a `data-<attr>` pixel value out of the wrapper markup, or fall back. */
function wrapperDimension(html: string, attr: "width" | "height", fallback: number): number {
  const match = html.match(new RegExp(`data-${attr}="(\\d+)"`))?.[1];
  return match ? parseInt(match, 10) : fallback;
}

async function generateThumbnail(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  // Read dimensions from the wrapper index.html (which may differ from native
  // dimensions for portrait overlays that are scaled to fit landscape).
  const wrapperHtml = readFileSync(join(projectDir, "index.html"), "utf-8");
  const width = wrapperDimension(wrapperHtml, "width", 1920);
  const height = wrapperDimension(wrapperHtml, "height", 1080);

  const framesDir = join(projectDir, "_thumb_frames");
  const { fileServer, session, duration } = await openOpaqueCapture({ projectDir, width, height });
  try {
    // Capture after the treatment appears, capped for long compositions.
    const captureTime = Math.min(3.0, duration * 0.6);
    const result = await captureFrame(session, 0, captureTime);
    execFileSync(
      "ffmpeg",
      ["-v", "error", "-y", "-i", result.path, join(outDir, `${item.name}.png`)],
      {
        stdio: "inherit",
      },
    );
    console.log(`  ✓ ${item.name}.png (${result.captureTimeMs}ms)`);
  } finally {
    await closeCaptureSession(session).catch(() => undefined);
    fileServer.close();
    rmSync(framesDir, { recursive: true, force: true });
  }
}

async function generateVideo(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  const outMp4 = join(outDir, `${item.name}.mp4`);
  const masterMp4 = join(outDir, `${item.name}.master.mp4`);
  const job = createRenderJob({
    fps: { num: 24, den: 1 },
    quality: "draft",
    format: "mp4",
  });
  await executeRenderJob(job, projectDir, masterMp4);
  encodeForWeb(masterMp4, outMp4);
  rmSync(masterMp4, { force: true });
  console.log(`  ✓ ${item.name}.mp4 (${(statSync(outMp4).size / 1048576).toFixed(1)} MB)`);
}

/**
 * The render output is a master, not a deliverable. Publishing it directly put
 * 25 Mbps files on the docs CDN — one 20-second preview was 60 MB, which a
 * reader on a phone pays for the moment they press play. This pass is the
 * difference between a master and something you serve.
 */
function encodeForWeb(input: string, output: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      input,
      // 1280 wide is twice the 590px docs column: sharp on retina, no pixels
      // nobody sees.
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-crf",
      "28",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      // faststart puts the index first so playback can begin before the whole
      // file has arrived.
      "-movflags",
      "+faststart",
      // ffmpeg ignores these when the input carries no audio stream.
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      output,
    ],
    { stdio: "inherit" },
  );
}

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  only: string | null;
  type: ItemKind | null;
  skipVideo: boolean;
}

function parseKind(value: string): ItemKind {
  if (value === "block" || value === "component") return value;
  console.error(`Invalid --type: "${value}". Must be block or component.`);
  process.exit(1);
}

type FlagSetter = (args: CliArgs, value: string) => void;

const setOnly: FlagSetter = (args, value) => {
  args.only = value;
};

const setType: FlagSetter = (args, value) => {
  args.type = parseKind(value);
};

const valueFlags = new Map<string | undefined, FlagSetter>([
  ["--only", setOnly],
  ["--type", setType],
]);

/** Apply the flag at the head of argv and return how many tokens it used. */
function applyFlag(args: CliArgs, flag: string | undefined, next: string | undefined): number {
  if (flag === "--skip-video") args.skipVideo = true;
  const setValue = valueFlags.get(flag);
  if (!setValue || !next) return 1;
  setValue(args, next);
  return 2;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { only: null, type: null, skipVideo: false };
  for (let i = 2; i < process.argv.length; ) {
    i += applyFlag(args, process.argv[i], process.argv[i + 1]);
  }
  return args;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : `${err}`;
}

/** A missing WebGPU adapter is the runner, not the item: it keeps its committed poster and video. */
function reportItemFailure(item: CatalogItem, err: unknown): void {
  const message = describeError(err);
  if (!MISSING_ADAPTER.test(message)) {
    console.error(`  ✗ ${item.name}: ${message}`);
    return;
  }
  console.log(
    `  – ${item.name}: no WebGPU adapter on this runner, keeping its committed poster and video`,
  );
}

async function generateItem(item: CatalogItem, skipVideo: boolean): Promise<void> {
  console.log(`[${item.kind}] ${item.name}`);
  const projectDir = await prepareProjectDir(item);
  try {
    await generateThumbnail(item, projectDir);
    if (!skipVideo) await generateVideo(item, projectDir);
  } catch (err) {
    reportItemFailure(item, err);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { only, type, skipVideo } = parseArgs();
  const items = discoverItems(type, only);

  console.log(
    `Generating catalog previews for ${items.length} item(s)${skipVideo ? " (thumbnails only)" : " + videos"}...\n`,
  );

  for (const item of items) await generateItem(item, skipVideo);

  console.log("\nDone.");
}

// Only render when run as a command. This module also exports discoverItems
// and prepareProjectDir for the payload generator, and an unguarded main()
// would render every preview the moment that script imported them.
runAsCommand(import.meta.url, main);
