/**
 * Download assets (SVGs, images, favicon, video posters) from extracted tokens + asset catalog.
 *
 * Uses the asset catalog (which already deduplicates srcset variants and keeps the highest
 * resolution) as the single source of truth for images. Favicon links are passed separately.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import type { DesignTokens, DownloadedAsset } from "./types.js";
import type { CatalogedAsset } from "./assetCataloger.js";

export async function downloadAssets(
  tokens: DesignTokens,
  outputDir: string,
  catalogedAssets?: CatalogedAsset[],
  faviconLinks?: Array<{ rel: string; href: string }>,
): Promise<DownloadedAsset[]> {
  const assetsDir = join(outputDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const assets: DownloadedAsset[] = [];
  const downloadedUrls = new Set<string>();

  // 1. ALL inline SVGs — save as files (logos get priority naming)
  mkdirSync(join(outputDir, "assets", "svgs"), { recursive: true });
  const usedSvgNames = new Set<string>();
  for (let i = 0; i < tokens.svgs.length && i < 30; i++) {
    const svg = tokens.svgs[i]!;
    if (!svg.outerHTML || svg.outerHTML.length < 50) continue;
    const label = svg.label?.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    let slug = label ? slugify(label) : svg.isLogo ? `logo-${i}` : `icon-${i}`;
    // Deduplicate — two SVGs with same aria-label get suffixed
    let finalSlug = slug;
    let suffix = 2;
    while (usedSvgNames.has(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }
    usedSvgNames.add(finalSlug);
    const name = `${finalSlug}.svg`;
    const localPath = `assets/svgs/${name}`;
    try {
      writeFileSync(join(outputDir, localPath), svg.outerHTML, "utf-8");
      assets.push({ url: "", localPath, type: "svg" });
    } catch {
      /* skip */
    }
  }

  // 2. Favicon
  for (const icon of faviconLinks || []) {
    if (!icon.href) continue;
    try {
      const ext = extname(new URL(icon.href).pathname) || ".ico";
      const name = `favicon${ext}`;
      const localPath = `assets/${name}`;
      const buffer = await fetchBuffer(icon.href);
      if (buffer) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: icon.href, localPath, type: "favicon" });
        break;
      }
    } catch {
      /* skip */
    }
  }

  // 3. Images — use the catalog as the single source of truth (highest resolution, deduplicated)
  // If the catalog is empty, asset download produces zero images — this is surfaced as a warning
  // so the capture doesn't silently produce a half-empty dataset.
  const imageUrls: { url: string; isPoster: boolean }[] = [];

  if (catalogedAssets && catalogedAssets.length > 0) {
    // Use catalog — already deduplicated with highest-res srcset variants
    for (const a of catalogedAssets) {
      if (a.type !== "Image" && a.type !== "Background") continue;
      if (!a.url.startsWith("http")) continue;
      // Skip junk
      if (a.url.includes("pixel") || a.url.includes("beacon") || a.url.includes("analytics"))
        continue;
      if (a.url.includes("/favicon")) continue;
      // Download images from standard img/video contexts + CSS backgrounds (for hero sections, feature illustrations)
      const hasGoodContext = a.contexts.some(
        (c) =>
          c === "img[src]" ||
          c === "img[srcset]" ||
          c === "video[poster]" ||
          c === "source[srcset]" ||
          c === "data-src" ||
          c === "css url()",
      );
      if (!hasGoodContext) continue;
      const isPoster = a.contexts.includes("video[poster]");
      imageUrls.push({ url: a.url, isPoster });
    }
  }

  // Download all images — use catalog context for human-readable filenames.
  // Pre-filter to deduplicate before downloading.
  const toDownload: {
    url: string;
    isPoster: boolean;
    normalized: string;
    catalog?: CatalogedAsset;
  }[] = [];
  for (const { url, isPoster } of imageUrls) {
    const normalized = normalizeUrl(url);
    if (downloadedUrls.has(normalized)) continue;
    downloadedUrls.add(normalized);
    const catalog = catalogedAssets?.find((a) => normalizeUrl(a.url) === normalized);
    toDownload.push({ url, isPoster, normalized, catalog });
  }

  // Download in parallel batches of 5
  const BATCH_SIZE = 5;
  let imgIdx = 0;
  const usedNames = new Set<string>();
  for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
    const batch = toDownload.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ url, isPoster, catalog }) => {
        const parsedUrl = new URL(url);
        const pathExt = extname(parsedUrl.pathname);
        const ext = pathExt && pathExt.length <= 5 ? pathExt : ".jpg";
        const buffer = await fetchBuffer(url);
        if (!buffer) return null;
        const isSvg = ext === ".svg" || url.includes(".svg");
        const minSize = isSvg ? 200 : 10000;
        if (buffer.length < minSize) return null;
        return { url, isPoster, parsedUrl, ext, buffer, catalog };
      }),
    );
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { url, isPoster, parsedUrl, ext, buffer, catalog } = result.value;
      try {
        // Generate human-readable name from catalog context
        const slug = deriveAssetName(parsedUrl, catalog, isPoster, imgIdx, usedNames);
        const name = `${slug}${ext}`;
        usedNames.add(slug);
        const localPath = `assets/${name}`;
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url, localPath, type: "image" });
        imgIdx++;
      } catch {
        /* skip */
      }
    }
  }

  // 4. OG image (if not already downloaded)
  if (tokens.ogImage && !downloadedUrls.has(normalizeUrl(tokens.ogImage))) {
    try {
      const ext = extname(new URL(tokens.ogImage).pathname) || ".jpg";
      const localPath = `assets/og-image${ext}`;
      const buffer = await fetchBuffer(tokens.ogImage);
      if (buffer && buffer.length > 5000) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: tokens.ogImage, localPath, type: "image" });
      }
    } catch {
      /* skip */
    }
  }

  return assets;
}

/** Normalize URL for deduplication — unwrap Next.js image proxy, strip w/q params */
function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    if (parsed.pathname.includes("_next/image") && parsed.searchParams.has("url")) {
      return decodeURIComponent(parsed.searchParams.get("url")!);
    }
    parsed.searchParams.delete("w");
    parsed.searchParams.delete("q");
    parsed.searchParams.delete("dpr");
    return parsed.toString();
  } catch {
    return u;
  }
}

/**
 * Download fonts referenced in CSS and rewrite URLs to local paths.
 * Returns the modified CSS string with local font paths.
 */
export async function downloadAndRewriteFonts(css: string, outputDir: string): Promise<string> {
  const assetsDir = join(outputDir, "assets", "fonts");
  mkdirSync(assetsDir, { recursive: true });

  const fontUrlRegex = /url\(['"]?(https?:\/\/[^'")\s]+\.(?:woff2?|ttf|otf)[^'")\s]*?)['"]?\)/g;
  const fontUrls = new Set<string>();
  let match;
  while ((match = fontUrlRegex.exec(css)) !== null) {
    if (match[1]) fontUrls.add(match[1]);
  }

  if (fontUrls.size === 0) return css;

  // Limit font downloads to avoid bloat. Google Fonts serves 20+ unicode-range
  // subsets per weight — we only need a few per family for video production.
  const MAX_FONTS_PER_FAMILY = 6;
  const MAX_TOTAL_FONTS = 30;
  const familyCounts = new Map<string, number>();

  // Extract font-family from the @font-face rule containing each URL
  const getFamilyForUrl = (url: string): string => {
    const idx = css.indexOf(url);
    if (idx === -1) return "_unknown";
    const blockStart = css.lastIndexOf("@font-face", idx);
    if (blockStart === -1) return "_unknown";
    const blockSlice = css.slice(blockStart, idx);
    const familyMatch = blockSlice.match(/font-family\s*:\s*['"]?([^'";}\n]+)/i);
    return familyMatch?.[1] ? familyMatch[1].trim().toLowerCase() : "_unknown";
  };

  // Prioritize Latin subsets over CJK/Arabic/etc unicode ranges
  const sortedUrls = Array.from(fontUrls).sort((a, b) => {
    const aLatin = /latin|[A-Za-z0-9]{10,}\.woff/.test(a) ? 0 : 1;
    const bLatin = /latin|[A-Za-z0-9]{10,}\.woff/.test(b) ? 0 : 1;
    return aLatin - bLatin;
  });

  let rewritten = css;
  let count = 0;

  for (const fontUrl of sortedUrls) {
    if (count >= MAX_TOTAL_FONTS) break;
    const family = getFamilyForUrl(fontUrl);
    const familyCount = familyCounts.get(family) || 0;
    if (familyCount >= MAX_FONTS_PER_FAMILY) continue;

    try {
      const urlObj = new URL(fontUrl);
      const filename = urlObj.pathname.split("/").pop() || `font-${count}.woff2`;
      const localPath = join(assetsDir, filename);
      const relativePath = `assets/fonts/${filename}`;

      const buffer = await fetchBuffer(fontUrl);
      if (buffer) {
        writeFileSync(localPath, buffer);
        rewritten = rewritten.split(fontUrl).join(relativePath);
        familyCounts.set(family, familyCount + 1);
        count++;
      }
    } catch {
      /* skip */
    }
  }

  return rewritten;
}

/** Block requests to private/internal IP ranges to prevent SSRF */
export function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    // Block cloud metadata, localhost, and private IP ranges
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
    if (hostname === "169.254.169.254") return true; // AWS/GCP metadata
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return true;
    // IPv4 private ranges
    const parts = hostname.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      if (parts[0] === 10) return true; // 10.0.0.0/8
      if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
      if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 (link-local)
    }
    // Block non-HTTP(S) schemes
    const scheme = new URL(url).protocol;
    if (scheme !== "http:" && scheme !== "https:") return true;
    return false;
  } catch {
    return true; // reject unparseable URLs
  }
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    if (isPrivateUrl(url)) return null;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "HyperFrames/1.0" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    // Reject XML/HTML error pages disguised as 200 OK (common with S3/CloudFront)
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/xml") || ct.includes("text/html") || ct.includes("application/xml")) {
      return null;
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Derive a human-readable filename from catalog context.
 * Priority: alt text > nearest heading > meaningful URL path > fallback index.
 */
function deriveAssetName(
  parsedUrl: URL,
  catalog: CatalogedAsset | undefined,
  isPoster: boolean,
  idx: number,
  usedNames: Set<string>,
): string {
  const candidates: string[] = [];

  // 1. Alt text / description from catalog
  if (catalog?.description) {
    const desc = catalog.description.replace(/[^a-zA-Z0-9 -]/g, "").trim();
    if (desc.length > 3 && desc.length < 80) candidates.push(desc);
  }

  // 2. Nearest heading context
  if (catalog?.nearestHeading) {
    const heading = catalog.nearestHeading.replace(/[^a-zA-Z0-9 -]/g, "").trim();
    if (heading.length > 3 && heading.length < 60) candidates.push(heading);
  }

  // 3. Meaningful URL path segment
  const rawName =
    parsedUrl.pathname
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") || "";
  const isMeaningful =
    rawName.length > 2 &&
    rawName.length < 50 &&
    !/^[a-f0-9]{8,}$/i.test(rawName) &&
    !/^\d+$/.test(rawName) &&
    !rawName.includes("_next") &&
    !rawName.includes("?");
  if (isMeaningful) candidates.push(rawName);

  // 4. Section classes as context
  if (catalog?.sectionClasses) {
    const classes = catalog.sectionClasses
      .split(/\s+/)
      .filter((c) => c.length > 3 && c.length < 30 && !/^(w-|h-|p-|m-|flex|grid|block)/.test(c))
      .slice(0, 2)
      .join("-");
    if (classes.length > 3) candidates.push(classes);
  }

  // Pick the best candidate
  const prefix = isPoster ? "poster" : catalog?.aboveFold ? "hero" : "image";
  let slug = "";

  for (const c of candidates) {
    slug = slugify(c);
    if (slug.length > 3 && !usedNames.has(slug)) break;
  }

  if (!slug || slug.length <= 3 || usedNames.has(slug)) {
    slug = `${prefix}-${idx}`;
  }

  // Deduplicate
  let final = slug;
  let suffix = 2;
  while (usedNames.has(final)) {
    final = `${slug}-${suffix}`;
    suffix++;
  }

  return final;
}
