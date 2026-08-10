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
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  captureFrame,
  closeCaptureSession,
  createRenderJob,
  executeRenderJob,
} from "../packages/producer/src/index.js";
import { compileForRender } from "../packages/producer/src/services/htmlCompiler.js";
import { resolveContainedCopies } from "./registry-target-paths.mjs";
import { openOpaqueCapture } from "./preview-capture.js";

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

// ── Discovery ──────────────────────────────────────────────────────────────

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

      // Authored demos show transparent overlays against representative media.
      let entryFile: string;
      if (existsSync(join(sourceDir, "demo.html"))) {
        entryFile = "demo.html";
      } else if (kind === "component") {
        continue;
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

async function prepareProjectDir(item: CatalogItem): Promise<string> {
  const tmpDir = join(tmpdir(), `hf-catalog-${item.name}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  cpSync(item.sourceDir, tmpDir, { recursive: true });
  mirrorRegistryTargets(tmpDir);

  // The HyperFrames producer navigates to index.html at the project root.
  // Blocks and component demos are standalone HTML files, not index.html.
  // If the entry file is a standalone HTML (has its own timeline registration),
  // just rename it to index.html. Otherwise create a wrapper.
  if (!existsSync(join(tmpDir, "index.html")) && existsSync(join(tmpDir, item.entryFile))) {
    const entryContent = readFileSync(join(tmpDir, item.entryFile), "utf-8");
    // A registration inside <template> does NOT make the file standalone: the
    // template's markup and scripts stay inert until a host composition mounts
    // it via data-composition-src. Rendering such a block as index.html paints
    // a blank page and fails with "Composition has zero duration", so match on
    // the document with template content removed and let those blocks fall
    // through to the wrapper below.
    const hasTimeline = entryContent
      .replace(/<template\b[\s\S]*?<\/template>/gi, "")
      .includes("__timelines");
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
    }
  }
  if (!existsSync(join(tmpDir, "index.html"))) {
    // One read for every field the wrapper needs. A malformed manifest cannot
    // reach here — `discoverItems` parses the same file without a guard — so
    // the only case this absorbs is the file being absent, which is what each
    // `??` default below already stood for.
    const manifest: {
      dimensions?: { width?: number; height?: number };
      duration?: number;
      tags?: string[];
      files?: { path?: string; target?: string }[];
    } = (() => {
      try {
        return JSON.parse(readFileSync(join(tmpDir, "registry-item.json"), "utf-8"));
      } catch {
        return {};
      }
    })();

    const width = manifest.dimensions?.width ?? 1920;
    const height = manifest.dimensions?.height ?? 1080;
    const duration = manifest.duration ?? 5;

    // Dark background for social overlays so transparent cards are visible.
    const tags = manifest.tags ?? [];
    const isSocialOverlay = tags.includes("social") || tags.includes("overlay");
    const bgColor = isSocialOverlay ? "#1a1a2e" : "#ffffff";

    // Mount the mirrored install-layout copy when one exists. Blocks reference
    // their own assets the way they will after `hyperframes add`
    // (`../assets/background.jpeg` from `compositions/`), which only resolves
    // from the target path — the flat source copy at the project root resolves
    // it outside the project and silently renders without the asset.
    const entryTarget = manifest.files?.find((f) => f.path === item.entryFile)?.target;
    const entrySrc =
      entryTarget && existsSync(join(tmpDir, entryTarget)) ? entryTarget : item.entryFile;

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
    <div data-composition-id="${item.name}" data-composition-src="${entrySrc}" data-start="0" data-duration="${duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["preview-root"] = gsap.timeline({ paused: true });
  </script>
</body>
</html>`;
    writeFileSync(join(tmpDir, "index.html"), wrapper, "utf-8");
  }

  const indexPath = join(tmpDir, "index.html");
  const indexHtml = readFileSync(indexPath, "utf-8");
  if (indexHtml.includes("data-composition-src")) {
    const compiled = await compileForRender(tmpDir, indexPath, join(tmpDir, "_downloads"));
    writeFileSync(indexPath, compiled.html, "utf-8");
  }

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

function parseArgs(): { only: string | null; type: ItemKind | null; skipVideo: boolean } {
  let only: string | null = null;
  let type: ItemKind | null = null;
  let skipVideo = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    }
    if (arg === "--type" && process.argv[i + 1]) {
      i++;
      const val = process.argv[i];
      if (val === "block" || val === "component") {
        type = val;
      } else {
        console.error(`Invalid --type: "${val}". Must be block or component.`);
        process.exit(1);
      }
    }
    if (arg === "--skip-video") skipVideo = true;
  }

  return { only, type, skipVideo };
}

async function main(): Promise<void> {
  const { only, type, skipVideo } = parseArgs();
  const items = discoverItems(type, only);

  console.log(
    `Generating catalog previews for ${items.length} item(s)${skipVideo ? " (thumbnails only)" : " + videos"}...\n`,
  );

  for (const item of items) {
    console.log(`[${item.kind}] ${item.name}`);
    const projectDir = await prepareProjectDir(item);
    try {
      await generateThumbnail(item, projectDir);
      if (!skipVideo) {
        await generateVideo(item, projectDir);
      }
    } catch (err) {
      console.error(`  ✗ ${item.name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
