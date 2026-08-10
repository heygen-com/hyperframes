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
 * Usage:
 *   npx tsx scripts/generate-catalog-payloads.ts                    # all items
 *   npx tsx scripts/generate-catalog-payloads.ts --only data-chart  # single item
 *   npx tsx scripts/generate-catalog-payloads.ts --type block       # blocks only
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverItems,
  prepareProjectDir,
  type CatalogItem,
  type ItemKind,
} from "./generate-catalog-previews.js";
import { externalizeDataUris, processAssets } from "./catalog-payload-assets.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const payloadRoot = resolve(repoRoot, "docs/public/catalog");

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

async function buildPayload(item: CatalogItem): Promise<"written" | "skipped"> {
  const outPath = join(payloadRoot, typeDir(item.kind), `${item.name}.json`);

  // An item that stops qualifying has to lose its payload, or the page
  // generator keeps finding one on disk and emits a player for a preview this
  // run just decided it cannot build.
  const dropStalePayload = () => rmSync(outPath, { force: true });

  const projectDir = await prepareProjectDir(item);
  try {
    const html = readFileSync(join(projectDir, "index.html"), "utf-8");

    if (needsCanvasDrawElement(html)) {
      console.log(`  – ${item.name}: needs canvas drawElement, keeping the recorded video`);
      dropStalePayload();
      return "skipped";
    }
    const assetTarget = { dir: join(payloadRoot, "assets"), urlBase: "/public/catalog/assets" };
    const {
      html: withAssets,
      hosted,
      inlined,
      unresolved,
    } = processAssets(html, projectDir, assetTarget);

    // Compositions arrive with their fonts already embedded, so this catches
    // what never looked like a reference in the first place.
    const { html: withShared, externalized } = externalizeDataUris(withAssets, assetTarget);

    // A reference we could not inline would 404 inside the player, so the item
    // keeps the MP4 rather than shipping a preview with holes in it.
    if (unresolved.length > 0) {
      console.log(`  – ${item.name}: cannot inline ${unresolved.slice(0, 3).join(", ")}`);
      dropStalePayload();
      return "skipped";
    }
    const bytes = Buffer.byteLength(withShared, "utf-8");
    if (bytes > MAX_PAYLOAD_BYTES) {
      console.log(`  – ${item.name}: ${(bytes / 1e6).toFixed(1)} MB payload, over budget`);
      dropStalePayload();
      return "skipped";
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ html: withShared }), "utf-8");

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

async function main(): Promise<void> {
  const { only, type } = parseArgs();
  const items = discoverItems(type, only);
  console.log(`Building ${items.length} catalog payload(s)...\n`);

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const result = await buildPayload(item);
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
  if (failed > 0) console.log(`${failed} item(s) failed to build.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
