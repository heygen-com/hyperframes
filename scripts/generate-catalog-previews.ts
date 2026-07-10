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
  mkdtempSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadUiPrimitiveScope } from "./lib/ui-primitives/scope.js";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  createFileServer,
  createCaptureSession,
  initializeSession,
  captureFrame,
  getCompositionDuration,
  closeCaptureSession,
  createRenderJob,
  executeRenderJob,
} from "../packages/producer/src/index.js";

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

type ItemKind = "block" | "component";

interface CatalogItem {
  name: string;
  kind: ItemKind;
  /** Directory containing the item's files in the registry. */
  sourceDir: string;
  /** The HTML file to render (relative to sourceDir). */
  entryFile: string;
}

interface CliOptions {
  only: string | null;
  type: ItemKind | null;
  skipVideo: boolean;
  allowlist: string | null;
  prepareOnly: string | null;
  keepWorkspace: boolean;
}

interface PrepareOptions {
  destination?: string;
  operatorBlack: boolean;
}

// ── Discovery ──────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function discoverItems(kindFilter: ItemKind | null, nameFilter: string | null): CatalogItem[] {
  const items: CatalogItem[] = [];

  // Blocks and components only — examples use the existing generate-template-previews.ts.
  const kinds: { kind: ItemKind; dir: string }[] = [
    { kind: "block", dir: join(registryDir, "blocks") },
    { kind: "component", dir: join(registryDir, "components") },
  ];

  for (const { kind, dir } of kinds) {
    if (kindFilter && kindFilter !== kind) continue;
    if (!existsSync(dir)) continue;

    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (nameFilter && e.name !== nameFilter) continue;

      const sourceDir = join(dir, e.name);
      const manifestPath = join(sourceDir, "registry-item.json");
      if (!existsSync(manifestPath)) continue;

      // Blocks: find the first composition file. Components: use demo.html.
      let entryFile: string;
      if (kind === "component") {
        entryFile = "demo.html";
      } else {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const compFile = manifest.files?.find(
          (f: { type: string }) => f.type === "hyperframes:composition",
        );
        entryFile = compFile?.path ?? `${e.name}.html`;
      }

      if (!existsSync(join(sourceDir, entryFile))) continue;
      items.push({ name: e.name, kind, sourceDir, entryFile });
    }
  }

  if (nameFilter && items.length === 0) {
    const allNames = discoverItems(null, null).map((i) => i.name);
    console.error(`Item "${nameFilter}" not found. Available: ${allNames.join(", ")}`);
    process.exit(1);
  }

  return items;
}

// ── Preview generation ─────────────────────────────────────────────────────

function outputDir(kind: ItemKind): string {
  const typeDir = kind === "block" ? "blocks" : "components";
  return resolve(repoRoot, "docs/images/catalog", typeDir);
}

function verifyPinnedGsap(): void {
  const lockPath = resolve(registryDir, "ui-primitives/visual-test-image.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const gsapPath = resolve(repoRoot, lock.gsap.path);
  const digest = createHash("sha256").update(readFileSync(gsapPath)).digest("hex");
  if (digest !== lock.gsap.sha256) throw new Error("Pinned Operator Black GSAP checksum mismatch");
}

// fallow-ignore-next-line complexity
export function prepareProjectDir(item: CatalogItem, options: PrepareOptions): string {
  const tmpDir = options.destination
    ? resolve(options.destination)
    : mkdtempSync(join(tmpdir(), `hf-catalog-${item.name}-`));
  if (options.destination && existsSync(tmpDir)) {
    throw new Error(`Prepared workspace already exists: ${tmpDir}`);
  }
  mkdirSync(tmpDir, { recursive: true });

  if (options.operatorBlack) {
    verifyPinnedGsap();
    const componentDir = resolve(tmpDir, "registry/components", item.name);
    const vendorDir = resolve(tmpDir, "registry/ui-primitives/vendor");
    mkdirSync(dirname(componentDir), { recursive: true });
    mkdirSync(dirname(vendorDir), { recursive: true });
    cpSync(item.sourceDir, componentDir, { recursive: true });
    cpSync(resolve(registryDir, "ui-primitives/vendor"), vendorDir, { recursive: true });
    const entryPath = resolve(componentDir, item.entryFile);
    let content = readFileSync(entryPath, "utf8");
    content = content.replace(
      /<head(\s[^>]*)?>/i,
      (opening) => `${opening}\n    <base href="./registry/components/${item.name}/" />`,
    );
    writeFileSync(resolve(tmpDir, "index.html"), content);
    return tmpDir;
  }

  cpSync(item.sourceDir, tmpDir, { recursive: true });

  // The HyperFrames producer navigates to index.html at the project root.
  // Blocks and component demos are standalone HTML files, not index.html.
  // If the entry file is a standalone HTML (has its own timeline registration),
  // just rename it to index.html. Otherwise create a wrapper.
  if (!existsSync(join(tmpDir, "index.html")) && existsSync(join(tmpDir, item.entryFile))) {
    const entryContent = readFileSync(join(tmpDir, item.entryFile), "utf-8");
    const hasTimeline = entryContent.includes("__timelines");
    if (hasTimeline) {
      // Standalone block — copy to index.html and render directly.
      // For social overlays with transparent backgrounds, inject a dark bg
      // so the overlay card is visible against something.
      let content = entryContent;
      const hasSocialTag = (() => {
        try {
          const m = JSON.parse(readFileSync(join(tmpDir, "registry-item.json"), "utf-8"));
          return (m.tags ?? []).includes("social");
        } catch {
          return false;
        }
      })();
      if (hasSocialTag) {
        // Dark bg for transparent overlays
        if (content.includes("background: transparent")) {
          content = content.replace("background: transparent", "background: #1a1a2e");
        }
        // Reposition bottom-anchored overlays to center for preview.
        // Social overlays use "bottom: Npx" positioning — replace with
        // "top: 50%; transform: translate(-50%, -50%)" for a centered preview.
        content = content.replace(
          /bottom:\s*\d+px;\s*\n(\s*)left:\s*50%;\s*\n(\s*)transform:\s*translateX\(-50%\)/,
          "top: 50%;\n$1left: 50%;\n$2transform: translate(-50%, -50%)",
        );
        // Scale down large centered cards (like Spotify) that use
        // margin-based centering with large negative margins.
        if (/margin-top:\s*-[3-9]\d\dpx/.test(content)) {
          content = content.replace(
            /(<body[^>]*>)/,
            "$1\n<style>body { transform: scale(0.55); transform-origin: center center; }</style>",
          );
        }
      }
      writeFileSync(join(tmpDir, "index.html"), content, "utf-8");
      return tmpDir;
    }
  }
  if (!existsSync(join(tmpDir, "index.html"))) {
    const manifestPath = join(tmpDir, "registry-item.json");
    let width = 1920;
    let height = 1080;
    let duration = 5;
    if (existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, "utf-8"));
      width = m.dimensions?.width ?? width;
      height = m.dimensions?.height ?? height;
      duration = m.duration ?? duration;
    }

    // Dark background for social overlays so transparent cards are visible.
    const tags: string[] = (() => {
      try {
        return JSON.parse(readFileSync(join(tmpDir, "registry-item.json"), "utf-8")).tags ?? [];
      } catch {
        return [];
      }
    })();
    const isSocialOverlay = tags.includes("social") || tags.includes("overlay");
    const bgColor = isSocialOverlay ? "#1a1a2e" : "#ffffff";

    const wrapper = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>* { margin: 0; padding: 0; } html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${bgColor}; }</style>
</head>
<body>
  <div data-composition-id="preview-root" data-width="${width}" data-height="${height}" data-start="0" data-duration="${duration}">
    <div data-composition-id="${item.name}" data-composition-src="${item.entryFile}" data-start="0" data-duration="${duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["preview-root"] = gsap.timeline({ paused: true });
  </script>
</body>
</html>`;
    writeFileSync(join(tmpDir, "index.html"), wrapper, "utf-8");
  }

  return tmpDir;
}

async function generateThumbnail(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  // Read dimensions from the wrapper index.html (which may differ from native
  // dimensions for portrait overlays that are scaled to fit landscape).
  let width = 1920;
  let height = 1080;
  const wrapperPath = join(projectDir, "index.html");
  const wrapperHtml = readFileSync(wrapperPath, "utf-8");
  const wMatch = wrapperHtml.match(/data-width="(\d+)"/);
  const hMatch = wrapperHtml.match(/data-height="(\d+)"/);
  if (wMatch) width = parseInt(wMatch[1], 10);
  if (hMatch) height = parseInt(hMatch[1], 10);

  const framesDir = join(projectDir, "_thumb_frames");
  mkdirSync(framesDir, { recursive: true });

  const fileServer = await createFileServer({
    projectDir,
    port: 0,
    fps: { num: 30, den: 1 },
  });
  try {
    const session = await createCaptureSession(fileServer.url, framesDir, {
      width,
      height,
      fps: { num: 30, den: 1 },
      format: "png",
    });
    await initializeSession(session);

    let duration: number;
    try {
      duration = await getCompositionDuration(session);
    } catch {
      duration = 5;
    }

    // Capture at 40% of duration for a representative frame
    // Capture at 60% of duration so the animation is well underway.
    // Cap at 3s to avoid overly-late captures on long compositions.
    const captureTime = Math.min(3.0, duration * 0.6);
    const result = await captureFrame(session, 0, captureTime);
    cpSync(result.path, join(outDir, `${item.name}.png`));
    console.log(`  ✓ ${item.name}.png (${result.captureTimeMs}ms)`);

    await closeCaptureSession(session);
  } finally {
    fileServer.close();
    rmSync(framesDir, { recursive: true, force: true });
  }
}

async function generateVideo(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  const outMp4 = join(outDir, `${item.name}.mp4`);
  const job = createRenderJob({
    fps: { num: 24, den: 1 },
    quality: "draft",
    format: "mp4",
  });
  await executeRenderJob(job, projectDir, outMp4);
  console.log(`  ✓ ${item.name}.mp4`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function parseArgs(args = process.argv.slice(2)): CliOptions {
  let only: string | null = null;
  let type: ItemKind | null = null;
  let skipVideo = false;
  let allowlist: string | null = null;
  let prepareOnly: string | null = null;
  let keepWorkspace = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--only" && args[i + 1]) {
      i++;
      if (only) throw new Error("--only may be supplied only once");
      only = args[i] ?? null;
      continue;
    }
    if (arg === "--type" && args[i + 1]) {
      i++;
      const val = args[i];
      if (val === "block" || val === "component") {
        type = val;
      } else {
        throw new Error(`Invalid --type: "${val}". Must be block or component.`);
      }
      continue;
    }
    if (arg === "--allowlist" && args[i + 1]) {
      i++;
      if (allowlist) throw new Error("--allowlist may be supplied only once");
      allowlist = args[i] ?? null;
      continue;
    }
    if (arg === "--prepare-only" && args[i + 1]) {
      i++;
      if (prepareOnly) throw new Error("--prepare-only may be supplied only once");
      prepareOnly = args[i] ?? null;
      continue;
    }
    if (arg === "--skip-video") {
      skipVideo = true;
      continue;
    }
    if (arg === "--keep-workspace") {
      keepWorkspace = true;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg ?? ""}`);
  }

  if (allowlist && type === "block") throw new Error("--allowlist is component-only");
  return { only, type, skipVideo, allowlist, prepareOnly, keepWorkspace };
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const cli = parseArgs();
  let items = discoverItems(cli.allowlist ? "component" : cli.type, cli.only);
  let operatorBlack = false;
  if (cli.allowlist) {
    const scope = loadUiPrimitiveScope(resolve(cli.allowlist));
    const allowed = new Set(scope.items);
    if (cli.only && !allowed.has(cli.only)) {
      throw new Error(`--only ${cli.only} is outside the supplied allowlist`);
    }
    items = items.filter((item) => allowed.has(item.name));
    if (!cli.only && items.length !== scope.items.length) {
      throw new Error(
        `Allowlist selected ${scope.items.length} items but discovered ${items.length}`,
      );
    }
    operatorBlack = true;
  }
  if (cli.prepareOnly) mkdirSync(resolve(cli.prepareOnly), { recursive: true });

  console.log(
    `Generating catalog previews for ${items.length} item(s)${cli.prepareOnly ? " (prepare only)" : cli.skipVideo ? " (thumbnails only)" : " + videos"}...\n`,
  );

  let failures = 0;
  for (const item of items) {
    console.log(`[${item.kind}] ${item.name}`);
    let projectDir: string | null = null;
    try {
      projectDir = prepareProjectDir(item, {
        operatorBlack,
        destination: cli.prepareOnly ? resolve(cli.prepareOnly, item.name) : undefined,
      });
      if (cli.prepareOnly) {
        console.log(`  ✓ prepared ${projectDir}`);
        continue;
      }
      await generateThumbnail(item, projectDir);
      if (!cli.skipVideo) {
        await generateVideo(item, projectDir);
      }
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${item.name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (projectDir && !cli.prepareOnly && !cli.keepWorkspace) {
        rmSync(projectDir, { recursive: true, force: true });
      } else if (projectDir && cli.keepWorkspace) {
        console.log(`  workspace: ${projectDir}`);
      }
    }
  }

  console.log(`\nDone: ${items.length - failures} succeeded, ${failures} failed.`);
  if (failures > 0) process.exitCode = 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
