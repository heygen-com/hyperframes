/**
 * Media capture helpers for the website capture pipeline.
 *
 * Handles Lottie animation preview rendering and video element manifest capture.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Browser, Page } from "puppeteer-core";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPrivateUrl } from "./assetDownloader.js";

/** Discovered Lottie item from network interception or DOM scan. */
export interface DiscoveredLottie {
  url: string;
  data?: unknown;
  dimensions?: { w: number; h: number };
  frameRate?: number;
}

/**
 * Download and save discovered Lottie animations to disk.
 *
 * Handles both plain JSON and dotLottie (.lottie ZIP) formats.
 * Deduplicates by content hash. Returns the count of saved files.
 */
export async function saveLottieAnimations(
  discoveredLotties: DiscoveredLottie[],
  lottieDir: string,
): Promise<number> {
  let savedCount = 0;
  const savedHashes = new Set<string>(); // Deduplicate by content

  for (let li = 0; li < discoveredLotties.length && li < 10; li++) {
    const lottieItem = discoveredLotties[li]!;
    try {
      let jsonData: string | undefined;

      if (lottieItem.data) {
        // Already have the JSON data from network interception
        jsonData = JSON.stringify(lottieItem.data);
      } else if (lottieItem.url) {
        // SSRF guard — don't fetch private/internal URLs
        if (isPrivateUrl(lottieItem.url)) continue;
        // Download the file
        const res = await fetch(lottieItem.url, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "HyperFrames/1.0" },
        });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());

        if (lottieItem.url.endsWith(".lottie")) {
          // dotLottie is a ZIP — extract the animation JSON
          try {
            const AdmZip = (await import("adm-zip")).default;
            const zip = new AdmZip(buf);
            const entries = zip.getEntries();
            // Look for animation JSON in both v1 (animations/) and v2 (a/) paths
            const animEntry = entries.find(
              (e) =>
                (e.entryName.startsWith("a/") || e.entryName.startsWith("animations/")) &&
                e.entryName.endsWith(".json"),
            );
            if (animEntry) {
              jsonData = animEntry.getData().toString("utf-8");
            }
          } catch {
            // adm-zip not available or extraction failed — save raw .lottie
            const hash = buf.toString("base64").slice(0, 100);
            if (savedHashes.has(hash)) continue;
            savedHashes.add(hash);
            writeFileSync(join(lottieDir, `animation-${savedCount}.lottie`), buf);
            savedCount++;
            continue;
          }
        } else {
          // Plain JSON file
          jsonData = buf.toString("utf-8");
        }
      }

      if (jsonData) {
        // Deduplicate by content hash (first 100 chars of stringified JSON)
        const hash = jsonData.slice(0, 200);
        if (savedHashes.has(hash)) continue;
        savedHashes.add(hash);

        // Validate it's actually Lottie
        try {
          const parsed = JSON.parse(jsonData);
          if (!parsed.layers || !parsed.w) continue;
        } catch {
          continue;
        }

        writeFileSync(join(lottieDir, `animation-${savedCount}.json`), jsonData, "utf-8");
        savedCount++;
      }
    } catch {
      /* skip */
    }
  }
  return savedCount;
}

/**
 * Render preview thumbnails for saved Lottie animation JSON files.
 *
 * Opens each Lottie JSON in a headless Chrome page via lottie-web,
 * seeks to ~30% through the animation, and takes a transparent screenshot.
 * Writes a lottie-manifest.json with metadata + preview paths.
 */
export async function renderLottiePreviews(
  chromeBrowser: Browser,
  lottieDir: string,
  outputDir: string,
): Promise<void> {
  const manifest: Array<{
    file: string;
    preview: string;
    name: string;
    width: number;
    height: number;
    duration: number;
    frameRate: number;
    layers: number;
  }> = [];
  const previewDir = join(lottieDir, "previews");
  mkdirSync(previewDir, { recursive: true });

  for (const file of readdirSync(lottieDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(lottieDir, file), "utf-8"));
      const fr = raw.fr || 30;
      const dur = ((raw.op || 0) - (raw.ip || 0)) / fr;
      const previewName = file.replace(".json", "-preview.png");

      // Render a mid-frame thumbnail using Puppeteer + lottie-web
      // Skip huge Lottie files for preview (CDP has a ~256MB message limit)
      const fileSize = statSync(join(lottieDir, file)).size;
      if (fileSize > 2_000_000) continue;

      let previewPage;
      try {
        previewPage = await chromeBrowser.newPage();
        await previewPage.setViewport({ width: 400, height: 400 });
        const animData = JSON.parse(readFileSync(join(lottieDir, file), "utf-8"));
        const midFrame = Math.floor(((raw.op || 0) - (raw.ip || 0)) * 0.3);
        // Load the shell page first (no untrusted data in the HTML)
        await previewPage.setContent(
          `<!DOCTYPE html>
<html><head>
<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
<style>*{margin:0;padding:0;background:transparent}#c{width:400px;height:400px}</style>
</head><body><div id="c"></div></body></html>`,
          { waitUntil: "load", timeout: 10000 },
        );
        // Pass animation data safely via parameterized evaluate (no string interpolation)
        await previewPage.evaluate(
          (data: unknown, frame: number) => {
            const a = (window as any).lottie.loadAnimation({
              container: document.getElementById("c"),
              renderer: "svg",
              loop: false,
              autoplay: false,
              animationData: data,
            });
            a.addEventListener("DOMLoaded", () => {
              a.goToAndStop(frame, true);
              (window as any).__READY = true;
            });
          },
          animData,
          midFrame,
        );
        await previewPage
          .waitForFunction(() => (window as any).__READY === true, { timeout: 5000 })
          .catch(() => {});
        await previewPage.screenshot({
          path: join(previewDir, previewName),
          type: "png",
          omitBackground: true,
        });
      } catch {
        /* preview rendering failed — non-critical */
      } finally {
        await previewPage?.close().catch(() => {});
      }

      manifest.push({
        file: `assets/lottie/${file}`,
        preview: `assets/lottie/previews/${previewName}`,
        name: raw.nm || file,
        width: raw.w || 0,
        height: raw.h || 0,
        duration: Math.round(dur * 10) / 10,
        frameRate: fr,
        layers: (raw.layers || []).length,
      });
    } catch {
      /* skip */
    }
  }
  if (manifest.length > 0) {
    writeFileSync(
      join(outputDir, "extracted", "lottie-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
  }
}

/**
 * Capture video element manifest — screenshot each <video> element and
 * extract surrounding context (heading, caption, aria-label).
 *
 * Writes video-manifest.json and preview screenshots to assets/videos/previews/.
 */
export async function captureVideoManifest(
  page: Page,
  outputDir: string,
  progress: (stage: string, detail?: string) => void,
): Promise<void> {
  const videoElements = (await page.evaluate(`(() => {
    var videos = Array.from(document.querySelectorAll('video'));
    return videos.map(function(v) {
      var src = v.src || v.currentSrc || (v.querySelector('source') ? v.querySelector('source').src : '');
      if (!src || !src.startsWith('http')) return null;

      // Get bounding box for screenshot
      var rect = v.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return null;

      // Nearest heading above the video
      var heading = '';
      var el = v;
      for (var i = 0; i < 8; i++) {
        el = el.parentElement;
        if (!el) break;
        var h = el.querySelector('h1,h2,h3,h4');
        if (h) { heading = h.textContent.trim().slice(0, 100); break; }
      }

      // Nearest paragraph/caption text
      var caption = '';
      el = v;
      for (var j = 0; j < 5; j++) {
        el = el.parentElement;
        if (!el) break;
        var p = el.querySelector('p,figcaption,[class*="caption"],[class*="desc"]');
        if (p) { caption = p.textContent.trim().slice(0, 200); break; }
      }

      // aria-label on video or wrapper
      var ariaLabel = v.getAttribute('aria-label') || v.getAttribute('title') || '';
      var wrapper = v.parentElement;
      if (!ariaLabel && wrapper) ariaLabel = wrapper.getAttribute('aria-label') || '';

      return {
        src: src,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        heading: heading,
        caption: caption,
        ariaLabel: ariaLabel,
        filename: src.split('/').pop().split('?')[0],
      };
    }).filter(Boolean);
  })()`)) as Array<{
    src: string;
    width: number;
    height: number;
    top: number;
    left: number;
    heading: string;
    caption: string;
    ariaLabel: string;
    filename: string;
  }>;

  // Deduplicate by src
  const seenSrcs = new Set<string>();
  const uniqueVideos = videoElements.filter((v) => {
    if (seenSrcs.has(v.src)) return false;
    seenSrcs.add(v.src);
    return true;
  });

  if (uniqueVideos.length > 0) {
    const videoManifestDir = join(outputDir, "assets", "videos");
    mkdirSync(videoManifestDir, { recursive: true });
    const previewDir = join(videoManifestDir, "previews");
    mkdirSync(previewDir, { recursive: true });

    const videoManifest: Array<{
      index: number;
      url: string;
      filename: string;
      width: number;
      height: number;
      heading: string;
      caption: string;
      ariaLabel: string;
      preview: string;
    }> = [];

    for (let vi = 0; vi < uniqueVideos.length && vi < 20; vi++) {
      const v = uniqueVideos[vi]!;
      const previewName = `video-${vi}-preview.png`;
      const previewPath = join(previewDir, previewName);

      // Screenshot the video element to get a visible frame
      try {
        // Scroll to the video element so it's in the viewport
        await page.evaluate(`window.scrollTo(0, ${Math.max(0, v.top - 100)})`);
        await new Promise((r) => setTimeout(r, 300));
        // Re-measure position after scroll (layout may have shifted)
        const rect = (await page.evaluate((fn) => {
          const vid = [...document.querySelectorAll("video")].find((x) =>
            (x.src || x.currentSrc || "").includes(fn),
          );
          if (!vid) return null;
          // Seek to 0.1s and wait for a frame to decode
          vid.currentTime = 0.1;
          return vid.getBoundingClientRect().toJSON();
        }, v.filename)) as { x: number; y: number; width: number; height: number } | null;
        if (!rect || rect.width < 10) continue;
        await new Promise((r) => setTimeout(r, 200)); // let decoder settle
        await page.screenshot({
          path: previewPath,
          clip: {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: Math.min(rect.width, 1920),
            height: Math.min(rect.height, 1080),
          },
        });
      } catch {
        /* preview failed — non-critical */
      }

      videoManifest.push({
        index: vi,
        url: v.src,
        filename: v.filename,
        width: v.width,
        height: v.height,
        heading: v.heading,
        caption: v.caption,
        ariaLabel: v.ariaLabel,
        preview: `assets/videos/previews/${previewName}`,
      });
    }

    if (videoManifest.length > 0) {
      writeFileSync(
        join(outputDir, "extracted", "video-manifest.json"),
        JSON.stringify(videoManifest, null, 2),
        "utf-8",
      );
      progress("design", `${videoManifest.length} video previews captured`);
    }
  }
}
