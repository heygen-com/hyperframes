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
import { join, extname } from "node:path";
import { isPrivateUrl, safeFetch } from "./assetDownloader.js";

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
// fallow-ignore-next-line complexity
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
        // SSRF guard — safeFetch re-checks the denylist on every redirect hop
        const res = await safeFetch(lottieItem.url, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "HyperFrames/1.0" },
        });
        if (!res || !res.ok) continue;
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
// fallow-ignore-next-line complexity
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

const MAX_VIDEO_BYTES = 75 * 1024 * 1024; // 75 MB — hero/demo clips, not full films
const DOWNLOADABLE_VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

/**
 * Download a <video> body to assets/videos/<file>, returning the
 * capture-relative path when saved (else null).
 *
 * Guards, in order: direct-file extension only — HLS (.m3u8) / DASH (.mpd) /
 * blob: streams are skipped · SSRF via safeFetch, which re-validates isPrivateUrl
 * on EVERY redirect hop (a bare redirect:"follow" only checks the initial URL,
 * so a public URL could 30x to an internal/metadata host) · Content-Type must be
 * video/* or octet-stream · a hard byte cap enforced WHILE streaming so a
 * missing or lying Content-Length cannot exhaust memory. Streams from the
 * Response body rather than buffering whole because videos are large.
 */
// fallow-ignore-next-line complexity
async function downloadVideoBody(
  srcUrl: string,
  filename: string,
  videosDir: string,
): Promise<string | null> {
  if (isPrivateUrl(srcUrl)) return null; // cheap pre-check; safeFetch re-checks every hop
  let ext = "";
  try {
    ext = extname(new URL(srcUrl).pathname).toLowerCase();
  } catch {
    return null;
  }
  if (!DOWNLOADABLE_VIDEO_EXTS.has(ext)) return null; // streaming manifest / unknown — leave on origin
  try {
    // safeFetch resolves redirects manually and re-runs isPrivateUrl on each
    // Location hop, so a public URL cannot 30x to an internal/metadata host.
    const res = await safeFetch(srcUrl, {
      signal: AbortSignal.timeout(120000), // up to ~75 MB on a slow link; aborts cleanly → still-frame fallback
      headers: { "User-Agent": "HyperFrames/1.0" },
    });
    if (!res || !res.ok || !res.body) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("video/") && !ct.includes("octet-stream")) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_VIDEO_BYTES) return null; // too big — leave on origin
    // Stream with a hard cap; a chunked response has no Content-Length to trust.
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_VIDEO_BYTES) return null; // abort oversized stream — no partial file written
      chunks.push(Buffer.from(chunk));
    }
    if (total < 1024) return null; // too small to be a real video (likely an error blob)
    const safe = /\.[a-z0-9]+$/i.test(filename) ? filename.replace(/[^\w.-]/g, "_") : `video${ext}`;
    writeFileSync(join(videosDir, safe), Buffer.concat(chunks));
    return `assets/videos/${safe}`;
  } catch {
    return null;
  }
}

/** A <video> descriptor scanned from the DOM (rich: has rect + nearby text). */
interface VideoDescriptor {
  src: string;
  width: number;
  height: number;
  top: number;
  left: number;
  heading: string;
  caption: string;
  ariaLabel: string;
  filename: string;
}

// In-page expression: scan every <video> for src + bounding box + nearest
// heading/caption/aria. Shared by the one-shot scan and the time-sampling pass.
const VIDEO_SCAN_EXPR = `(() => {
  var videos = Array.from(document.querySelectorAll('video'));
  return videos.map(function(v) {
    var src = v.src || v.currentSrc || (v.querySelector('source') ? v.querySelector('source').src : '');
    if (!src || !src.startsWith('http')) return null;
    var rect = v.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    var heading = '';
    var el = v;
    for (var i = 0; i < 8; i++) {
      el = el.parentElement;
      if (!el) break;
      var h = el.querySelector('h1,h2,h3,h4');
      if (h) { heading = h.textContent.trim().slice(0, 100); break; }
    }
    var caption = '';
    el = v;
    for (var j = 0; j < 5; j++) {
      el = el.parentElement;
      if (!el) break;
      var p = el.querySelector('p,figcaption,[class*="caption"],[class*="desc"]');
      if (p) { caption = p.textContent.trim().slice(0, 200); break; }
    }
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
})()`;

async function scanVideoDom(page: Page): Promise<VideoDescriptor[]> {
  return (await page.evaluate(VIDEO_SCAN_EXPR)) as VideoDescriptor[];
}

/**
 * Layer 2 (passive): poll the DOM over a bounded window so auto-rotating
 * carousels reveal each slide, AND so the Layer 1 network listener (whose live
 * Set is `netSet`) gets time to record videos fetched on rotation. Accumulates
 * unique-by-src descriptors. Exits early once neither the DOM set nor the
 * network set has grown for a few rounds, so static single-video pages stay
 * cheap (~6s) while a rotating carousel keeps sampling up to the budget.
 */
// fallow-ignore-next-line complexity
async function sampleVideoDom(
  page: Page,
  budgetMs: number,
  netSet: Set<string>,
): Promise<VideoDescriptor[]> {
  const seen = new Map<string, VideoDescriptor>();
  const start = Date.now();
  let stale = 0;
  while (Date.now() - start < budgetMs && stale < 3) {
    let grew = false;
    const netBefore = netSet.size;
    for (const d of await scanVideoDom(page)) {
      if (!seen.has(d.src)) {
        seen.set(d.src, d);
        grew = true;
      }
    }
    if (netSet.size > netBefore) grew = true;
    stale = grew ? 0 : stale + 1;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return [...seen.values()];
}

/**
 * Capture video element manifest — screenshot each <video> element, extract
 * surrounding context (heading, caption, aria-label), and download the video
 * body when it is a direct file (see downloadVideoBody guards).
 *
 * Two PASSIVE discovery layers widen coverage past a single snapshot (which
 * misses carousels / tabs / lazy media):
 *   • Layer 1 — opts.networkVideoUrls: a LIVE Set the caller fills from the
 *     page "response" listener with every direct-video URL the page fetches
 *     (load / scroll / auto-rotation), independent of DOM presence. Read after
 *     sampling so rotation fetches during the window are included.
 *   • Layer 2 — opts.sampleMs: poll the DOM over that window so an
 *     auto-rotating carousel surfaces each slide.
 * The manifest is the union, deduped by download filename. DOM-scanned videos
 * get a still preview; network-only videos are downloaded without one. (Active
 * click-through of carousels/tabs is intentionally NOT done here.)
 *
 * Writes video-manifest.json + preview screenshots to assets/videos/previews/,
 * and the video bodies (when downloadable) to assets/videos/.
 */
// fallow-ignore-next-line complexity
export async function captureVideoManifest(
  page: Page,
  outputDir: string,
  progress: (stage: string, detail?: string) => void,
  opts?: { networkVideoUrls?: Set<string>; sampleMs?: number; downloadBudgetMs?: number },
): Promise<void> {
  const netSet = opts?.networkVideoUrls ?? new Set<string>();
  const sampleMs = opts?.sampleMs ?? 0;
  const downloadBudgetMs = opts?.downloadBudgetMs ?? 180000;

  // DOM scan, optionally sampled over time (Layer 2) when videos are present.
  const initial = await scanVideoDom(page);
  const domVideos =
    initial.length > 0 && sampleMs > 0 ? await sampleVideoDom(page, sampleMs, netSet) : initial;

  // Merge DOM (rich) + network-only (thin, Layer 1), deduped by download
  // filename so a clip seen in both lands once. netSet is read here — AFTER
  // sampling — so rotation fetches that arrived during the window count.
  const fileKey = (s: string) => (s.split("/").pop() || s).split("?")[0]!;
  const byKey = new Map<string, VideoDescriptor & { rich: boolean }>();
  for (const d of domVideos) {
    const k = d.filename || fileKey(d.src);
    if (!byKey.has(k)) byKey.set(k, { ...d, rich: true });
  }
  for (const url of netSet) {
    if (!url.startsWith("http")) continue;
    const k = fileKey(url);
    if (!byKey.has(k)) {
      byKey.set(k, {
        src: url,
        filename: k,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        heading: "",
        caption: "",
        ariaLabel: "",
        rich: false,
      });
    }
  }
  const merged = [...byKey.values()];
  if (merged.length === 0) return;

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
    preview?: string;
    localPath?: string;
  }> = [];

  const dlStart = Date.now();
  for (let vi = 0; vi < merged.length && vi < 20; vi++) {
    const v = merged[vi]!;
    let preview: string | undefined;

    // DOM-scanned videos can be screenshotted for a still preview; network-only
    // videos have no element on the page, so they go straight to download.
    if (v.rich) {
      const previewName = `video-${vi}-preview.png`;
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
        if (rect && rect.width >= 10) {
          await new Promise((r) => setTimeout(r, 200)); // let decoder settle
          await page.screenshot({
            path: join(previewDir, previewName),
            clip: {
              x: Math.max(0, rect.x),
              y: Math.max(0, rect.y),
              width: Math.min(rect.width, 1920),
              height: Math.min(rect.height, 1080),
            },
          });
          preview = `assets/videos/previews/${previewName}`;
        }
      } catch {
        /* preview failed — non-critical */
      }
    }

    // Download the video body (guarded). null when skipped / too big / not a
    // direct file. Cumulative budget caps total download time so a throttled
    // host or many large clips can't stall capture — over budget, keep the
    // preview (if any) and stop fetching bodies.
    const savedPath =
      Date.now() - dlStart < downloadBudgetMs
        ? await downloadVideoBody(v.src, v.filename, videoManifestDir)
        : null;

    // A network-only video with neither a preview nor a downloaded body carries
    // nothing usable downstream — drop it rather than list a dead reference.
    if (!preview && !savedPath) continue;

    videoManifest.push({
      index: vi,
      url: v.src,
      filename: v.filename,
      width: v.width,
      height: v.height,
      heading: v.heading,
      caption: v.caption,
      ariaLabel: v.ariaLabel,
      ...(preview ? { preview } : {}),
      ...(savedPath ? { localPath: savedPath } : {}),
    });
  }

  if (videoManifest.length > 0) {
    writeFileSync(
      join(outputDir, "extracted", "video-manifest.json"),
      JSON.stringify(videoManifest, null, 2),
      "utf-8",
    );
    const downloaded = videoManifest.filter((v) => v.localPath).length;
    const previews = videoManifest.filter((v) => v.preview).length;
    progress(
      "design",
      `${videoManifest.length} video(s) discovered` +
        (previews ? `, ${previews} preview(s)` : "") +
        (downloaded ? `, ${downloaded} body downloaded` : ""),
    );
  }
}
