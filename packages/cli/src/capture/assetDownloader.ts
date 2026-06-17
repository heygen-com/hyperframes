/**
 * Download assets (SVGs, images, favicon, video posters) from extracted tokens + asset catalog.
 *
 * Uses the asset catalog (which already deduplicates srcset variants and keeps the highest
 * resolution) as the single source of truth for images. Favicon links are passed separately.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import type { DesignTokens, DownloadedAsset } from "./types.js";
import type { CatalogedAsset } from "./assetCataloger.js";

// SVGs: hash-of-bytes filename so it can't drift from content; label-derived names mis-assigned brands.
function svgContentHashSlug(svgSource: string | Buffer, isLogo: boolean): string {
  const hash = createHash("sha1").update(svgSource).digest("hex").slice(0, 8);
  return isLogo ? `logo-${hash}` : `svg-${hash}`;
}

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

  mkdirSync(join(outputDir, "assets", "svgs"), { recursive: true });
  const usedSvgNames = new Set<string>();
  for (let i = 0; i < tokens.svgs.length && i < 30; i++) {
    const svg = tokens.svgs[i]!;
    if (!svg.outerHTML || svg.outerHTML.length < 50) continue;
    const slug = svgContentHashSlug(svg.outerHTML, !!svg.isLogo);
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
        let slug: string;
        if (ext === ".svg") {
          const c = catalog;
          const brandRe = /logo|brand|wordmark/i;
          const isLogo = !!(
            c?.inBanner ||
            c?.inHomeLink ||
            c?.matchesTitleBrand ||
            c?.contexts?.some((s) => brandRe.test(s)) ||
            (c?.description && brandRe.test(c.description)) ||
            (c?.nearestHeading && brandRe.test(c.nearestHeading)) ||
            (c?.sectionClasses && brandRe.test(c.sectionClasses))
          );
          slug = svgContentHashSlug(buffer, isLogo);
        } else {
          slug = deriveAssetName(parsedUrl, catalog, isPoster, imgIdx, usedNames);
        }
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

// Reserved/loopback/private IPv4 blocks as [firstOctet, secondOctetLo, secondOctetHi].
const PRIVATE_V4_BLOCKS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 255], // 0.0.0.0/8 (incl. 0.0.0.0, which routes to localhost)
  [10, 0, 255], // 10.0.0.0/8
  [127, 0, 255], // 127.0.0.0/8 loopback
  [172, 16, 31], // 172.16.0.0/12
  [192, 168, 168], // 192.168.0.0/16
  [169, 254, 254], // 169.254.0.0/16 link-local (cloud metadata)
];

/** True for a dotted-quad IPv4 literal in a loopback/private/reserved range. */
function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4) return false;
  const [a, b] = octets as [number, number, number, number];
  return PRIVATE_V4_BLOCKS.some(([first, lo, hi]) => a === first && b >= lo && b <= hi);
}

/** True for a bracketed IPv6 hostname in a loopback/private/reserved range. */
function isPrivateIpv6(bracketed: string): boolean {
  const addr = bracketed.replace(/^\[|\]$/g, "").toLowerCase();
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  const mapped = /^::ffff:(.+)$/.exec(addr); // IPv4-mapped ::ffff:a.b.c.d or ::ffff:hhhh:hhhh
  if (mapped) {
    const tail = mapped[1]!;
    if (tail.includes(".")) return isPrivateIpv4(tail);
    const hex = tail.split(":");
    if (hex.length === 2) {
      const n = ((parseInt(hex[0]!, 16) << 16) | parseInt(hex[1]!, 16)) >>> 0;
      return isPrivateIpv4(
        [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."),
      );
    }
  }
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

/**
 * Block requests to private/internal hosts to prevent SSRF. WHATWG URL parsing
 * canonicalizes alternate IPv4 encodings (decimal/octal/hex) to dotted-quad
 * before we see them, so only dotted IPv4 and bracketed IPv6 literals reach the
 * classifiers below.
 */
export function isPrivateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true; // no file:, etc.
    const hostname = u.hostname;
    if (hostname === "localhost") return true;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return true;
    if (hostname.startsWith("[")) return isPrivateIpv6(hostname);
    if (/^\d+(\.\d+){3}$/.test(hostname)) return isPrivateIpv4(hostname);
    return false;
  } catch {
    return true; // reject unparseable URLs
  }
}

/** Max redirect hops safeFetch will follow before giving up. */
const MAX_FETCH_REDIRECTS = 5;

/**
 * fetch() that re-validates the SSRF denylist on EVERY redirect hop. A bare
 * `redirect: "follow"` only checks the initial URL, so a public URL can 30x to
 * an internal/metadata host. We resolve redirects manually and re-run
 * isPrivateUrl on each Location. Returns null when blocked, on too many hops,
 * or on network error.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_FETCH_REDIRECTS; hop++) {
    if (isPrivateUrl(current)) return null;
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return null; // malformed Location header
      }
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "HyperFrames/1.0" },
    });
    if (!res || !res.ok) return null;
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
