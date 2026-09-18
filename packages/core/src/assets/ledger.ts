/**
 * Offline asset ledger — a static, agent-readable inventory of every asset a
 * composition references: scripts, stylesheets, fonts, images, audio, video,
 * iframes, and text tracks, each classified as `remote`, `local`, `data`, or
 * `missing`.
 *
 * The ledger is what `hyperframes ledger` prints and what `hyperframes vendor`
 * uses to find remote URLs worth localizing. It is built by scanning HTML
 * text — no browser, no network — so it can run in CI preflight and unit
 * tests. Only DECLARED URLs are inventoried (tag attributes, inline styles,
 * `<style>` blocks); URLs constructed at runtime inside scripts are out of
 * scope, as are assets nested inside remote stylesheets (e.g. font binaries
 * referenced by a Google Fonts CSS response).
 *
 * Node-only (uses `node:fs` for project scanning) — import via the
 * `@hyperframes/core/asset-ledger` subpath so the main entry stays
 * browser-safe.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  isUnresolvedAssetPlaceholder,
  maskNonScannableRanges,
  resolveExistingLocalAsset,
} from "@hyperframes/parsers/asset-resolution";

export type LedgerAssetKind =
  | "script"
  | "stylesheet"
  | "font"
  | "image"
  | "audio"
  | "video"
  | "iframe"
  | "track";

export type LedgerAssetStatus = "remote" | "local" | "data" | "missing";

/** Where in the markup a reference was declared. */
export type LedgerAssetVia =
  | "src"
  | "href"
  | "srcset"
  | "poster"
  | "css-url"
  | "css-import"
  | "style-attr";

export interface LedgerAssetRef {
  kind: LedgerAssetKind;
  /** Decoded URL (HTML entities like `&amp;` resolved) — what a fetch would use. */
  url: string;
  /** The URL exactly as written in the source, for text-level rewriting. */
  rawUrl: string;
  status: LedgerAssetStatus;
  /** Project-root-relative path of the HTML file holding the reference. */
  file: string;
  via: LedgerAssetVia;
  /** Project-root-relative path of the resolved file when status is `local`. */
  localPath?: string;
}

export interface AssetLedger {
  /** Project-root-relative HTML files that were scanned, in scan order. */
  files: string[];
  assets: LedgerAssetRef[];
  counts: { total: number } & Record<LedgerAssetStatus, number>;
  /** Deduped decoded remote URLs, in first-seen order. */
  remoteUrls: string[];
}

export interface LedgerFileInput {
  /** Project-root-relative path (used verbatim in findings). */
  file: string;
  html: string;
}

export interface BuildLedgerOptions {
  /**
   * Resolve a local URL candidate to a project-root-relative path, or null
   * when the file does not exist. `fromFile` is the referencing HTML file
   * (root-relative). When omitted, every local candidate reports `missing` —
   * fine for pure-string unit tests, wrong for real projects.
   */
  resolveLocalAsset?: (fromFile: string, url: string) => string | null;
}

interface ExtractedRef {
  kind: LedgerAssetKind;
  url: string;
  rawUrl: string;
  via: LedgerAssetVia;
}

// ── URL classification ──────────────────────────────────────────────────────

const REMOTE_URL_RE = /^(https?:)?\/\//i;
// Runtime-only or non-asset schemes: nothing on disk to resolve, nothing a
// vendor step could download deterministically.
const NON_ASSET_SCHEME_RE = /^(blob:|about:|javascript:|mailto:|tel:)/i;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Classify one declared URL. `local-candidate` means "looks like a path on
 * disk — resolve it to decide local vs missing"; `skip` means the value is not
 * an inventoriable asset (empty, fragment, runtime-only scheme, or an
 * unresolved templating placeholder a build step substitutes later).
 */
export function classifyAssetUrl(url: string): "remote" | "data" | "local-candidate" | "skip" {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) return "skip";
  if (isUnresolvedAssetPlaceholder(trimmed)) return "skip";
  if (/^data:/i.test(trimmed)) return "data";
  if (REMOTE_URL_RE.test(trimmed)) return "remote";
  if (NON_ASSET_SCHEME_RE.test(trimmed)) return "skip";
  // Any other scheme (ftp:, ws:, file:, …) is still a non-relative reference
  // that breaks a self-contained project — count it as remote so
  // --strict-offline surfaces it, even though vendoring only downloads http(s).
  if (HAS_SCHEME_RE.test(trimmed)) return "remote";
  return "local-candidate";
}

// ── HTML scanning ───────────────────────────────────────────────────────────

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/**
 * Minimal entity decode for attribute values (URLs use a small entity set).
 * Single pass so each entity decodes exactly once — a decoded `&` can never
 * recombine with following text into a second entity (`&amp;lt;` → `&lt;`,
 * never `<`).
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:(amp|quot|apos|lt|gt)|#0*39);/gi, (match, name: string | undefined) =>
    name === undefined ? "'" : (HTML_ENTITY_MAP[name.toLowerCase()] ?? match),
  );
}

/** Length-preserving `<!-- … -->` blanking so commented-out tags never count. */
function maskHtmlComments(html: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (true) {
    const start = html.indexOf("<!--", cursor);
    if (start === -1) break;
    const end = html.indexOf("-->", start + 4);
    if (end === -1) break;
    const afterComment = end + 3;
    chunks.push(html.slice(cursor, start), " ".repeat(afterComment - start));
    cursor = afterComment;
  }
  return chunks.length === 0 ? html : chunks.join("") + html.slice(cursor);
}

/** Read one attribute value from a single already-delimited tag's source. */
function readTagAttr(tagSource: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = re.exec(tagSource);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

/** Split a `srcset` value into its URL parts (descriptors dropped). */
function parseSrcset(value: string): string[] {
  const urls: string[] = [];
  for (const entry of value.split(",")) {
    const url = entry.trim().split(/\s+/, 1)[0];
    if (url) urls.push(url);
  }
  return urls;
}

const LINK_PRELOAD_AS_KIND: Record<string, LedgerAssetKind> = {
  font: "font",
  style: "stylesheet",
  script: "script",
  image: "image",
  audio: "audio",
  video: "video",
  track: "track",
};

function linkKind(tagSource: string): LedgerAssetKind | null {
  const rel = (readTagAttr(tagSource, "rel") ?? "").toLowerCase();
  const relParts = rel.split(/\s+/);
  if (relParts.includes("stylesheet")) return "stylesheet";
  if (relParts.includes("modulepreload")) return "script";
  if (relParts.includes("preload") || relParts.includes("prefetch")) {
    const as = (readTagAttr(tagSource, "as") ?? "").toLowerCase();
    return LINK_PRELOAD_AS_KIND[as] ?? null;
  }
  if (relParts.some((part) => part === "icon" || part === "apple-touch-icon")) return "image";
  return null;
}

function pushRef(
  refs: ExtractedRef[],
  kind: LedgerAssetKind,
  rawUrl: string | null,
  via: LedgerAssetVia,
): void {
  if (!rawUrl) return;
  const trimmed = rawUrl.trim();
  if (!trimmed) return;
  refs.push({ kind, url: decodeHtmlEntities(trimmed), rawUrl: trimmed, via });
}

/** Media elements whose nested `<source>` children inherit their kind. */
const SOURCE_PARENT_KIND: Record<string, LedgerAssetKind> = {
  video: "video",
  audio: "audio",
  picture: "image",
};

// fallow-ignore-next-line complexity
function collectTagRefs(html: string, refs: ExtractedRef[]): void {
  // Script/style BODIES are blanked (length-preserving) so markup inside a
  // string literal or template can't register as a real tag; the open tags of
  // scripts are re-scanned separately below because the mask removes them too.
  const scannable = maskNonScannableRanges(html);

  // Nearest enclosing <video>/<audio>/<picture>, so a nested <source> knows
  // which kind it feeds. Void/media tags are never nested inside each other
  // in valid markup, so a one-deep stack is enough.
  const parentStack: string[] = [];

  let cursor = 0;
  while (cursor < scannable.length) {
    const open = scannable.indexOf("<", cursor);
    if (open === -1) break;
    const close = scannable.indexOf(">", open + 1);
    if (close === -1) break;
    cursor = close + 1;

    const tagSource = scannable.slice(open, cursor);
    const nameMatch = /^<\/?\s*([a-zA-Z][\w-]*)/.exec(tagSource);
    if (!nameMatch) continue;
    const name = (nameMatch[1] ?? "").toLowerCase();
    const isClosing = tagSource.startsWith("</");

    if (name in SOURCE_PARENT_KIND) {
      if (isClosing) {
        if (parentStack[parentStack.length - 1] === name) parentStack.pop();
        continue;
      }
      parentStack.push(name);
    }
    if (isClosing) continue;

    switch (name) {
      case "link": {
        const kind = linkKind(tagSource);
        if (kind) pushRef(refs, kind, readTagAttr(tagSource, "href"), "href");
        break;
      }
      case "img": {
        pushRef(refs, "image", readTagAttr(tagSource, "src"), "src");
        const srcset = readTagAttr(tagSource, "srcset");
        if (srcset) for (const url of parseSrcset(srcset)) pushRef(refs, "image", url, "srcset");
        break;
      }
      case "source": {
        const parent = parentStack[parentStack.length - 1] ?? "";
        const srcset = readTagAttr(tagSource, "srcset");
        if (srcset) {
          for (const url of parseSrcset(srcset)) pushRef(refs, "image", url, "srcset");
        }
        const parentKind = SOURCE_PARENT_KIND[parent] ?? "video";
        pushRef(refs, parentKind, readTagAttr(tagSource, "src"), "src");
        break;
      }
      case "video": {
        pushRef(refs, "video", readTagAttr(tagSource, "src"), "src");
        pushRef(refs, "image", readTagAttr(tagSource, "poster"), "poster");
        break;
      }
      case "audio":
        pushRef(refs, "audio", readTagAttr(tagSource, "src"), "src");
        break;
      case "iframe":
        pushRef(refs, "iframe", readTagAttr(tagSource, "src"), "src");
        break;
      case "track":
        pushRef(refs, "track", readTagAttr(tagSource, "src"), "src");
        break;
      default:
        break;
    }

    const styleAttr = readTagAttr(tagSource, "style");
    if (styleAttr) collectCssRefs(decodeHtmlEntities(styleAttr), refs, "style-attr");
  }
}

/** `<script src>` open tags — masked out of the generic scan, so re-found here. */
function collectScriptRefs(html: string, refs: ExtractedRef[]): void {
  const scriptOpenRe = /<script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptOpenRe.exec(html)) !== null) {
    pushRef(refs, "script", readTagAttr(match[0], "src"), "src");
  }
}

// ── CSS scanning ────────────────────────────────────────────────────────────

const CSS_URL_RE = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi;
const CSS_IMPORT_RE =
  /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)|"([^"]+)"|'([^']+)')/gi;
const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/gi;

/**
 * Length-preserving blanking of CSS block comments via a linear O(n) scan
 * (CSS comments do not nest) — same shape as `maskHtmlComments`, no regex
 * backtracking on adversarial input.
 */
function stripCssComments(css: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (true) {
    const start = css.indexOf("/*", cursor);
    if (start === -1) break;
    const end = css.indexOf("*/", start + 2);
    if (end === -1) break;
    const afterComment = end + 2;
    chunks.push(css.slice(cursor, start), " ".repeat(afterComment - start));
    cursor = afterComment;
  }
  return chunks.length === 0 ? css : chunks.join("") + css.slice(cursor);
}

function collectCssUrls(
  css: string,
  refs: ExtractedRef[],
  kind: LedgerAssetKind,
  via: LedgerAssetVia,
): void {
  let match: RegExpExecArray | null;
  CSS_URL_RE.lastIndex = 0;
  while ((match = CSS_URL_RE.exec(css)) !== null) {
    pushRef(refs, kind, match[1] ?? match[2] ?? match[3] ?? null, via);
  }
}

function collectCssRefs(css: string, refs: ExtractedRef[], via: LedgerAssetVia): void {
  let source = stripCssComments(css);

  let importMatch: RegExpExecArray | null;
  CSS_IMPORT_RE.lastIndex = 0;
  while ((importMatch = CSS_IMPORT_RE.exec(source)) !== null) {
    const url =
      importMatch[1] ?? importMatch[2] ?? importMatch[3] ?? importMatch[4] ?? importMatch[5];
    pushRef(refs, "stylesheet", url ?? null, "css-import");
  }
  // Blank @import statements so their url() doesn't double-count as an image.
  source = source.replace(CSS_IMPORT_RE, (m) => " ".repeat(m.length));

  // @font-face src urls are fonts; everything else (backgrounds, masks,
  // cursors) counts as image — the closest declared-asset category.
  let fontMatch: RegExpExecArray | null;
  FONT_FACE_BLOCK_RE.lastIndex = 0;
  while ((fontMatch = FONT_FACE_BLOCK_RE.exec(source)) !== null) {
    collectCssUrls(fontMatch[0], refs, "font", via);
  }
  source = source.replace(FONT_FACE_BLOCK_RE, (m) => " ".repeat(m.length));

  collectCssUrls(source, refs, "image", via);
}

function collectStyleBlockRefs(html: string, refs: ExtractedRef[]): void {
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleBlockRe.exec(html)) !== null) {
    collectCssRefs(match[1] ?? "", refs, "css-url");
  }
}

// ── Ledger assembly ─────────────────────────────────────────────────────────

/** Every declared asset reference in one HTML document, in source order. */
export function extractAssetRefs(html: string): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const withoutComments = maskHtmlComments(html);
  collectTagRefs(withoutComments, refs);
  collectScriptRefs(withoutComments, refs);
  collectStyleBlockRefs(withoutComments, refs);
  return refs;
}

/** Classify one extracted reference into a full ledger row, or null to skip. */
function toLedgerAsset(
  file: string,
  ref: ExtractedRef,
  options: BuildLedgerOptions,
): LedgerAssetRef | null {
  const classified = classifyAssetUrl(ref.url);
  if (classified === "skip") return null;

  let status: LedgerAssetStatus = classified === "local-candidate" ? "missing" : classified;
  let localPath: string | undefined;
  if (classified === "local-candidate") {
    localPath = options.resolveLocalAsset?.(file, ref.url) ?? undefined;
    if (localPath !== undefined) status = "local";
  }
  return {
    kind: ref.kind,
    url: ref.url,
    rawUrl: ref.rawUrl,
    status,
    file,
    via: ref.via,
    ...(localPath !== undefined ? { localPath } : {}),
  };
}

/** Build a ledger from in-memory HTML sources. Pure except for the resolver. */
export function buildAssetLedger(
  inputs: LedgerFileInput[],
  options: BuildLedgerOptions = {},
): AssetLedger {
  const assets: LedgerAssetRef[] = [];
  const remoteUrls: string[] = [];
  const seenRemote = new Set<string>();
  const counts = { total: 0, remote: 0, local: 0, data: 0, missing: 0 };

  for (const input of inputs) {
    for (const ref of extractAssetRefs(input.html)) {
      const asset = toLedgerAsset(input.file, ref, options);
      if (!asset) continue;
      counts.total += 1;
      counts[asset.status] += 1;
      if (asset.status === "remote" && !seenRemote.has(asset.url)) {
        seenRemote.add(asset.url);
        remoteUrls.push(asset.url);
      }
      assets.push(asset);
    }
  }

  return { files: inputs.map((i) => i.file), assets, counts, remoteUrls };
}

// ── Project scanning (node-only) ────────────────────────────────────────────

const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cache"]);

/** Recursively list project-root-relative `.html` files, sorted for stability. */
export function collectProjectHtmlFiles(projectDir: string): string[] {
  const root = resolve(projectDir);
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(join(dir, entry.name));
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        // Posix separators keep ledger output identical across platforms.
        files.push(relative(root, join(dir, entry.name)).replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Resolve one URL declared in `fromFile` (root-relative) against the project:
 * relative URLs resolve from the declaring file's directory, `/`-prefixed and
 * bare root-relative URLs from the project root (both via the shared
 * candidate logic in `@hyperframes/parsers/asset-resolution`).
 */
export function resolveDeclaredLocalAsset(
  projectDir: string,
  fromFile: string,
  url: string,
): string | null {
  const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const relativeToFile = fromDir && !url.startsWith("/") ? `${fromDir}/${url}` : url;
  const hit =
    resolveExistingLocalAsset(projectDir, relativeToFile) ??
    resolveExistingLocalAsset(projectDir, url);
  return hit ? hit.rootRelativePath.replace(/\\/g, "/") : null;
}

/** Scan a project directory on disk and build its asset ledger. */
export function buildProjectAssetLedger(
  projectDir: string,
  options: { files?: string[] } = {},
): AssetLedger {
  const root = resolve(projectDir);
  const files = options.files ?? collectProjectHtmlFiles(root);
  const inputs: LedgerFileInput[] = [];
  for (const file of files) {
    let html: string;
    try {
      html = readFileSync(join(root, file), "utf-8");
    } catch {
      continue;
    }
    inputs.push({ file, html });
  }
  return buildAssetLedger(inputs, {
    resolveLocalAsset: (fromFile, url) => resolveDeclaredLocalAsset(root, fromFile, url),
  });
}
