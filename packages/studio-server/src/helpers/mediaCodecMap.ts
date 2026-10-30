import { scanHtmlOpeningTags, decodeAuthoredAttribute } from "@hyperframes/parsers";
import { statSync } from "node:fs";
import { realpath } from "./safePath.js";
import { sep } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { ffmpegHasHdrFilters } from "./hdrFilters.js";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  isUnresolvedAssetPlaceholder,
  resolveExistingLocalAsset as resolveAsset,
} from "@hyperframes/parsers/asset-resolution";
import {
  isHeavyForPreview,
  type PreviewProxyBox,
  type PreviewSourceFacts,
} from "@hyperframes/core";
import { probeMediaMetadata, type FfprobeRunner } from "./mediaMetadata.js";

/**
 * One reusable answer to "what codec is this asset, and is it browser-hostile?",
 * built on top of `mediaMetadata.ts`'s ffprobe-backed prober so studio-server
 * probes each asset once instead of running a second prober.
 */

export interface AssetCodecFacts {
  codecName: string;
  browserHostile: boolean;
  /** Coarse `canPlayType()` input; `null` when not applicable (safe codec) or
   * when no representative mime exists (ProRes: browsers never decode it, so
   * the runtime always proxies rather than probing `canPlayType`). */
  representativeMime: string | null;
  /** Source carries an alpha channel (`MediaMetadata.hasAlpha`). Alpha sources use a
   * VP8/WebM proxy so their transparency is preserved across Chromium builds. */
  hasAlpha: boolean;
  /** Size, bit depth and bitrate, for deciding whether a playable file deserves a lighter copy. */
  source?: PreviewSourceFacts;
}

/** Server-root-relative URL pathname -> that asset's codec facts. */
export type MediaCodecMap = Record<string, AssetCodecFacts>;

export interface BrowserHostileCodec {
  /** Coarse `canPlayType()` input; `null` when no representative mime exists
   * (ProRes: browsers never decode it, so the runtime always proxies rather
   * than probing `canPlayType`). */
  representativeMime: string | null;
  /**
   * Whether the server may transcode before any browser asks. True only where
   * no cross-platform decode exists, so some client is sure to need the
   * substitute; false where the first `?hf-proxy=` request can do it lazily.
   */
  prewarm: boolean;
}

/**
 * Browser-hostile codec table v1. One exported constant so extending it is a
 * one-line change. `ffprobe` cannot emit exact RFC 6381 codec strings, so
 * these `representativeMime` values are deliberately coarse (a false
 * positive costs one proxy transcode, never correctness; a false negative is
 * rescued by the runtime's reactive zero-videoWidth swap).
 */
export const BROWSER_HOSTILE_CODECS: Record<string, BrowserHostileCodec> = {
  // HEVC decode is platform-bound, not absent: macOS Chrome answers
  // canPlayType with "probably" and keeps the source, while Chrome on
  // Windows/Linux and Firefox everywhere need the substitute.
  hevc: { representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"', prewarm: true },
  prores: { representativeMime: null, prewarm: true },
  theora: { representativeMime: 'video/ogg; codecs="theora"', prewarm: true },
  // Every mainstream engine decodes AV1 and VP9, so canPlayType keeps the
  // original and only the rare browser that cannot pays for a transcode.
  av1: { representativeMime: 'video/mp4; codecs="av01.0.08M.08"', prewarm: false },
  vp9: { representativeMime: 'video/webm; codecs="vp09.00.10.08"', prewarm: false },
};

/** `Object.hasOwn` rather than a bare index: a codec named `constructor` or
 * `toString` would otherwise resolve against `Object.prototype`. */
function hostileCodecEntry(codecName: string): BrowserHostileCodec | undefined {
  return Object.hasOwn(BROWSER_HOSTILE_CODECS, codecName)
    ? BROWSER_HOSTILE_CODECS[codecName]
    : undefined;
}

/** The pre-warm gate: true only for codecs with no cross-platform browser
 * decode, so some client will ask. See `BrowserHostileCodec.prewarm`. */
export function shouldPrewarmProxy(facts: AssetCodecFacts): boolean {
  return hostileCodecEntry(facts.codecName)?.prewarm === true;
}

// Per process, and deliberately in one unit — a call to `resolveProxy` — so
// the pair reads as a ratio. Summarised at exit on stderr, in the same
// `[hyperframes:<area>] {json}` shape as `writeUrlDownloadTelemetry`.
const proxyDemand = { prewarmsRequested: 0, proxyRequests: 0 };

/** Snapshot of this process's pre-warm demand counters. */
export function mediaProxyDemand(): { prewarmsRequested: number; proxyRequests: number } {
  return { ...proxyDemand };
}

function writeDemandLine(event: "prewarm_requested" | "summary"): void {
  try {
    process.stderr.write(
      `[hyperframes:media-proxy] ${JSON.stringify({ event, ...proxyDemand })}\n`,
    );
  } catch {
    // Observability must never change proxy correctness.
  }
}

/** Mirrors `isGpuProbeDebugEnabled` in packages/engine/src/utils/gpuEncoder.ts. */
function isMediaProxyDebugEnabled(): boolean {
  const value = process.env.HYPERFRAMES_DEBUG_MEDIA_PROXY;
  return value === "1" || value === "true";
}

// Registered on the first pre-warm rather than at import, so a process that
// never pre-warms adds no handler and prints nothing. Sync-only, mirroring the
// `process.on("exit")` shutdown hooks in packages/cli/src/cli.ts:331 and
// packages/cli/src/commands/preview.ts:1329.
let summaryHookInstalled = false;

/**
 * One proxy asked for before any browser wanted it. "Requested", not
 * "started": a warm cache makes `resolveProxy` a no-op and this counter cannot
 * see that, so it is an upper bound on transcodes, not a measure of CPU. The
 * number it does answer exactly is the one that decides policy — a nonzero
 * count beside `proxyRequests: 0` means nothing ever redeemed the pre-warm.
 *
 * The per-asset line is debug-only: a composition with fifty hostile clips
 * would otherwise print fifty JSON lines into a clack-formatted terminal on
 * every re-render. The exit summary carries the same numbers unconditionally.
 */
export function recordProxyPrewarm(): void {
  proxyDemand.prewarmsRequested++;
  if (!summaryHookInstalled) {
    summaryHookInstalled = true;
    process.once("exit", () => writeDemandLine("summary"));
  }
  if (isMediaProxyDebugEnabled()) writeDemandLine("prewarm_requested");
}

/** One proxy resolved for a browser that asked, counted on the path that calls
 * `resolveProxy` so it shares a unit with `prewarmsRequested`. A 304 does not
 * count; an unconditional Range refill still does, so read it as zero versus
 * nonzero. Never logged per event, only in the exit summary. */
export function recordProxyRequest(): void {
  proxyDemand.proxyRequests++;
}

export type ProxyVariant = "h264" | "vp8";
export type ProxyVariantRequest = ProxyVariant | "auto";

export const PROXY_VARIANT_CONFIG: Record<
  ProxyVariant,
  { extension: ".mp4" | ".webm"; contentType: "video/mp4" | "video/webm" }
> = {
  h264: { extension: ".mp4", contentType: "video/mp4" },
  vp8: { extension: ".webm", contentType: "video/webm" },
};

export function isProxyVariant(value: string): value is ProxyVariant {
  return Object.hasOwn(PROXY_VARIANT_CONFIG, value);
}

export function isProxyVariantRequest(value: string): value is ProxyVariantRequest {
  return value === "auto" || isProxyVariant(value);
}

export function proxyVariantFor(facts: AssetCodecFacts): ProxyVariant {
  return facts.hasAlpha ? "vp8" : "h264";
}

export function resolveProxyVariantRequest(
  request: ProxyVariantRequest,
  facts: AssetCodecFacts,
): ProxyVariant | null {
  const expected = proxyVariantFor(facts);
  return request === "auto" || request === expected ? expected : null;
}

export type MediaProxyIneligibilityReason = "browser_safe_codec" | "unknown_codec";

export type MediaProxyEligibility =
  | { eligible: true }
  | { eligible: false; reason: MediaProxyIneligibilityReason };

/**
 * Single policy gate shared by proactive scans and on-demand proxy routes. A file Chrome can play is
 * eligible only for a lighter copy (`lightBox`, the box that request asks for) and only when it is heavy there.
 */
export function decideMediaProxyEligibility(
  facts: AssetCodecFacts | null,
  lightBox?: PreviewProxyBox,
): MediaProxyEligibility {
  if (!facts) return { eligible: false, reason: "unknown_codec" };
  if (facts.browserHostile) return { eligible: true };
  if (lightBox && facts.source && isHeavyForPreview(facts.source, lightBox)) {
    return { eligible: true };
  }
  return { eligible: false, reason: "browser_safe_codec" };
}

function codecFactsFor(
  codecName: string,
  hasAlpha: boolean,
  source?: PreviewSourceFacts,
  toneMapsToSdr = false,
): AssetCodecFacts {
  const hostile = hostileCodecEntry(codecName);
  return {
    codecName,
    browserHostile: hostile !== undefined || toneMapsToSdr,
    // An HDR clip is never 'playable' for preview, whatever its codec: it takes the SDR copy the export uses.
    representativeMime: toneMapsToSdr ? null : (hostile?.representativeMime ?? null),
    hasAlpha,
    ...(source && { source }),
  };
}

/** `undefined` when ffprobe itself failed: no answer about the file, so nothing to cache. */
async function probeCodecFacts(
  filePath: string,
  runner?: FfprobeRunner,
): Promise<AssetCodecFacts | null | undefined> {
  const metadata = runner
    ? await probeMediaMetadata(filePath, runner)
    : await probeMediaMetadata(filePath);
  if (metadata.probeError) return undefined;
  if (metadata.kind !== "video") return null;
  const codecName = metadata.color.codecName;
  if (!codecName) return null;
  const hasAlpha = metadata.hasAlpha === true;
  const toneMaps = !hasAlpha && (await toneMapsHdr(metadata.color.hdrTransfer));
  return codecFactsFor(codecName, hasAlpha, metadata.source, toneMaps);
}

let warnedNoHdrFilters = false;

/** An HDR video previews through the same tone-mapped copy the SDR export uses, so the two match. */
async function toneMapsHdr(hdrTransfer: string | null): Promise<boolean> {
  if (hdrTransfer !== "pq" && hdrTransfer !== "hlg") return false;
  const ffmpegPath = findFfBinary("ffmpeg");
  if (ffmpegPath && (await ffmpegHasHdrFilters(ffmpegPath))) return true;
  if (!warnedNoHdrFilters) {
    warnedNoHdrFilters = true;
    console.warn(
      `[hyperframes] A video in this project is HDR, but this ffmpeg has no zscale/tonemap (libzimg), so the preview plays it as the browser shows it and will not match an SDR export. Install an ffmpeg with libzimg.`,
    );
  }
  return false;
}

interface CachedAssetProbe {
  /** The file a symlinked path pointed at, so retargeting the link is a miss. */
  target: string;
  mtimeMs: number;
  size: number;
  facts: AssetCodecFacts | null;
}

/** Per (path, mtime) probe cache. Construct one per project/server lifetime
 * and reuse it across scans; a fresh instance defeats the caching benefit. */
export type MediaCodecProbeCache = Map<string, CachedAssetProbe>;

export function createMediaCodecProbeCache(): MediaCodecProbeCache {
  return new Map();
}

// Shared by every route and scan in this process that does not pass its own cache.
const defaultProbeCache: MediaCodecProbeCache = new Map();
const MAX_PROBE_CACHE_ENTRIES = 512;

function rememberProbeResult(
  cache: MediaCodecProbeCache,
  filePath: string,
  result: CachedAssetProbe,
): void {
  if (!cache.has(filePath) && cache.size >= MAX_PROBE_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  // Refresh insertion order so frequently used assets remain resident.
  cache.delete(filePath);
  cache.set(filePath, result);
}

/**
 * Codec facts for one video, cached per path until its target, mtime or size changes; a hit skips
 * `runner`. Never throws: no video stream or a failed probe gives `null`, and a failed probe is not cached.
 */
export async function probeAssetCodec(
  filePath: string,
  runner?: FfprobeRunner,
  cache: MediaCodecProbeCache = defaultProbeCache,
): Promise<AssetCodecFacts | null> {
  let stat: ReturnType<typeof statSync>;
  let target: string;
  try {
    stat = statSync(filePath);
    target = realpath(filePath);
  } catch {
    return null;
  }
  const cached = cache.get(filePath);
  if (
    cached &&
    cached.target === target &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    rememberProbeResult(cache, filePath, cached);
    return cached.facts;
  }
  const facts = await probeCodecFacts(filePath, runner);
  if (facts === undefined) return null;
  rememberProbeResult(cache, filePath, { target, mtimeMs: stat.mtimeMs, size: stat.size, facts });
  return facts;
}

/** Structurally compatible with `packages/lint/src/hevcPreviewLint.ts`'s
 * (unexported) `HtmlSourceLike`. */
export interface HtmlSourceLike {
  html: string;
  compSrcPath?: string;
}

/**
 * Resolve a `<video src>` reference to an existing local file.
 *
 * `rootRelativePathname` is the map key format PINNED by this plan's Key
 * Technical Decisions: project-root-relative URL pathname, percent-decoded,
 * query-string-stripped, forward-slash separated, leading-slash prefixed
 * (e.g. "/assets/videos/clip.mp4"). This must match what the runtime derives
 * via `new URL(el.currentSrc || el.src, document.baseURI).pathname`, because
 * server-side scanning resolves filesystem paths while the DOM sees served
 * URLs — a documented prior source of this exact class of bug.
 */
function resolveExistingLocalAsset(
  projectDir: string,
  url: string,
): { resolvedPath: string; rootRelativePathname: string } | null {
  const asset = resolveAsset(projectDir, url);
  if (!asset) return null;
  return {
    resolvedPath: asset.resolved,
    rootRelativePathname: `/${asset.rootRelativePath.split(sep).join("/")}`,
  };
}

/**
 * Collects local `<video src>` references, resolved to their absolute path
 * and deduped by that path, keyed by the pinned root-relative URL pathname.
 */
// fallow-ignore-next-line complexity
function collectLocalVideoAssets(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, string> {
  const candidates = new Map<string, string>();

  for (const { html, compSrcPath } of htmlSources) {
    for (const tag of scanHtmlOpeningTags(html)) {
      if (tag.name !== "video" || !tag.closed) continue;
      const attribute = tag.attributes.find((attr) => attr.name === "src");
      if (attribute?.kind !== "value") continue;
      const rawSrc = decodeAuthoredAttribute(attribute.value);
      // Placeholder check runs on the RAW value: cleanAssetUrl() splits on ?/# and would chop inside a ${...} token.
      if (isUnresolvedAssetPlaceholder(rawSrc)) continue;
      const src = cleanAssetUrl(rawSrc);
      if (!src || isRemoteOrInlineUrl(src)) continue;
      const rootRelativeSrc = compSrcPath ? rewriteAssetPath(compSrcPath, src) : src;
      const resolved = resolveExistingLocalAsset(projectDir, rootRelativeSrc);
      if (!resolved) continue;
      candidates.set(resolved.resolvedPath, resolved.rootRelativePathname);
    }
  }

  return candidates;
}

// Bounds concurrent ffprobe child processes for projects referencing many
// videos, mirroring `PROBE_CONCURRENCY` in `hevcPreviewLint.ts`.
const PROBE_CONCURRENCY = 8;

export interface ScanProjectMediaCodecMapOptions {
  /** Persisted across calls by the caller for the mtime-cache benefit;
   * defaults to a shared module-level cache when omitted. */
  cache?: MediaCodecProbeCache;
  runner?: FfprobeRunner;
}

async function probeProjectAssets(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
  options: ScanProjectMediaCodecMapOptions,
): Promise<Array<[string, AssetCodecFacts | null]>> {
  const candidates = collectLocalVideoAssets(projectDir, htmlSources);
  const cache = options.cache ?? defaultProbeCache;
  const entries = [...candidates.entries()]; // [resolvedPath, rootRelativePathname]
  const facts = new Array<AssetCodecFacts | null>(entries.length).fill(null);
  let nextIndex = 0;
  const workerCount = Math.min(PROBE_CONCURRENCY, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex++;
        const entry = entries[index];
        if (!entry) break;
        facts[index] = await probeAssetCodec(entry[0], options.runner, cache);
      }
    }),
  );
  return entries.map(([, pathname], index) => [pathname, facts[index] ?? null]);
}

/** What a scan of a project's local videos finds: the hostile ones for the proxy map, and every readable one's size. */
export interface ProjectMediaScan {
  codecMap: MediaCodecMap;
  /** Root-relative URL pathname -> size, bit depth and bitrate. */
  sourceFacts: Record<string, PreviewSourceFacts>;
}

/** Scans composition HTML for local `<video src>` references; a video that can't be probed is omitted. */
export async function scanProjectMedia(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
  options: ScanProjectMediaCodecMapOptions = {},
): Promise<ProjectMediaScan> {
  const scan: ProjectMediaScan = { codecMap: {}, sourceFacts: {} };
  for (const [pathname, facts] of await probeProjectAssets(projectDir, htmlSources, options)) {
    if (facts?.browserHostile) scan.codecMap[pathname] = facts;
    if (facts?.source) scan.sourceFacts[pathname] = { ...facts.source, codec: facts.codecName };
  }
  return scan;
}

/** The injection map alone: root-relative URL pathname -> codec facts of the hostile videos. */
export async function scanProjectMediaCodecMap(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
  options: ScanProjectMediaCodecMapOptions = {},
): Promise<MediaCodecMap> {
  return (await scanProjectMedia(projectDir, htmlSources, options)).codecMap;
}
