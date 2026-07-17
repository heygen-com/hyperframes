import { postRuntimeMessage } from "./bridge";
import { swallow } from "./diagnostics";
import { evictMediaSyncState } from "./media";
import type { RuntimeJson } from "./types";

/**
 * One entry per project-root-relative asset pathname, injected by the
 * server as `window.__HF_MEDIA_CODEC_MAP__` (see the plan's server-contract
 * KTD). `representativeMime` is a coarse per-codec-family MIME string (e.g.
 * `video/mp4; codecs="hvc1.1.6.L120.B0"` for hevc) fed to `canPlayType`;
 * `null` when ffprobe couldn't produce one, in which case the browser check
 * is skipped and `browserHostile` alone decides.
 */
export type MediaCodecMapEntry = {
  codecName: string;
  browserHostile: boolean;
  representativeMime: string | null;
  /** Source carries an alpha channel and therefore needs a VP9/WebM proxy.
   * Optional so pre-alpha-aware maps stay assignable; absent means "no alpha detected". */
  hasAlpha?: boolean;
};

declare global {
  interface Window {
    __HF_MEDIA_CODEC_MAP__?: Record<string, MediaCodecMapEntry>;
  }
}

const PROXY_QUERY_PARAM = "hf-proxy";

/** Fired whenever an element is swapped to its authoring proxy (any trigger). */
const DIAGNOSTIC_FALLBACK_CODE = "runtime_media_proxy_fallback";
/** Fired when the runtime detects an undecodable video but cannot (or already
 *  did) proxy it — a remote asset, or the proxy URL itself failing. */
const DIAGNOSTIC_UNAVAILABLE_CODE = "runtime_media_proxy_unavailable";

type ProxyTrigger = "proactive" | "reactive" | "tertiary";

// Elements already swapped to their proxy src. Gates every trigger so a
// second undecodable-video signal (another zero-width metadata tick, a
// stray error event) never re-swaps or loops.
const swappedElements = new WeakSet<HTMLMediaElement>();
// Elements that already got the "can't help you" diagnostic (cross-origin,
// or the proxy itself failing) — one-shot per element, independent of
// `swappedElements` so the proxy-failed case (which fires AFTER a real swap)
// still gets its own single diagnostic.
const unavailableDiagnosedElements = new WeakSet<HTMLMediaElement>();

function currentSrcValue(el: HTMLMediaElement): string {
  return el.currentSrc || el.src;
}

/**
 * Render mode never proxies: the codec map arrives by injection (not a
 * fetch, so determinism holds) but render always decodes the original via
 * FFmpeg frame extraction, never a browser-side element. Mirrors the two
 * render-mode signals already used elsewhere in the runtime — the global
 * export-seek config (init.ts) and the per-element `__render_frame_<id>__`
 * sibling image the producer's frame-injection pipeline creates during
 * render (the same check `syncRuntimeMedia`'s `skipForInjectedVideo` makes
 * in media.ts).
 */
function isRenderMode(el: HTMLMediaElement): boolean {
  if (window.__HF_EXPORT_RENDER_SEEK_CONFIG) return true;
  return (
    el instanceof HTMLVideoElement &&
    !!el.id &&
    !!document.getElementById(`__render_frame_${el.id}__`)
  );
}

/**
 * Resolve an element's codec-map key: the served-root-relative,
 * percent-decoded, query-string-stripped URL pathname (per the server
 * contract KTD). Returns null when there's no usable src, or the src is
 * cross-origin — the server can't have scanned (or proxy) a file it doesn't
 * host, so there is never a map entry to look up.
 */
export function deriveCodecMapKey(el: HTMLMediaElement): string | null {
  const raw = currentSrcValue(el);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, document.baseURI);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/**
 * The composition is served under a route prefix on some surfaces —
 * studio-server's preview route injects `<base href="/api/projects/:id/preview/">`
 * (packages/studio-server/src/routes/preview.ts) so every relative asset
 * resolves through that prefix — while the codec map (per the server
 * contract) is keyed by project-root-relative pathnames with no prefix.
 * `play` and the CLI's static project server serve from the root with no
 * such prefix, where an exact match already succeeds. So: try exact first
 * (covers unprefixed servers), then fall back to the longest map key that
 * is a suffix of the pathname. No separate segment-boundary check is
 * needed: every key is contractually root-relative and leading-slash
 * (`"/assets/x.mp4"`, never `"assets/x.mp4"`), so a suffix match's boundary
 * is always that leading `/` itself — `pathname.endsWith(key)` can't match
 * a partial segment (e.g. key `"/foo.mp4"` can never match a pathname
 * ending in `"/notfoo.mp4"`, since that would require the literal substring
 * `"/foo.mp4"` to appear where the last `/` already fell a segment later).
 */
function lookupLongestExactSuffix(
  pathname: string,
  map: Record<string, MediaCodecMapEntry>,
): MediaCodecMapEntry | null {
  let bestKey: string | null = null;
  for (const key of Object.keys(map)) {
    if (!pathname.endsWith(key)) continue;
    if (bestKey === null || key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? (map[bestKey] ?? null) : null;
}

function lookupNormalizedSuffix(
  pathname: string,
  map: Record<string, MediaCodecMapEntry>,
): MediaCodecMapEntry | null {
  // Case-insensitive filesystems and Unicode-normalizing filesystems can
  // serve an authored URL whose spelling differs from the canonical path
  // ffprobe returned (Clip.mp4 vs clip.mp4, NFC vs NFD). Exact matching stays
  // authoritative; this normalized fallback is used only when it finds one
  // unambiguous longest suffix, so case-sensitive projects containing both
  // spellings never select the wrong asset.
  const normalizedPathname = pathname.normalize("NFC").toLowerCase();
  let normalizedBestLength = -1;
  let normalizedBest: MediaCodecMapEntry | null = null;
  let ambiguous = false;
  for (const [key, entry] of Object.entries(map)) {
    const normalizedKey = key.normalize("NFC").toLowerCase();
    if (!normalizedPathname.endsWith(normalizedKey)) continue;
    if (normalizedKey.length > normalizedBestLength) {
      normalizedBestLength = normalizedKey.length;
      normalizedBest = entry;
      ambiguous = false;
    } else if (normalizedKey.length === normalizedBestLength) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : normalizedBest;
}

function lookupCodecMapEntry(
  pathname: string,
  map: Record<string, MediaCodecMapEntry>,
): MediaCodecMapEntry | null {
  return (
    map[pathname] ??
    lookupLongestExactSuffix(pathname, map) ??
    lookupNormalizedSuffix(pathname, map)
  );
}

function appendProxyParam(src: string, entry: MediaCodecMapEntry | null): string {
  const url = new URL(src, document.baseURI);
  url.searchParams.set(PROXY_QUERY_PARAM, entry ? (entry.hasAlpha ? "vp9" : "h264") : "auto");
  return url.href;
}

type UnavailableReason =
  | "cross_origin"
  | "proxy_playback_failed"
  | "browser_safe_codec"
  | "invalid_source_url";

const UNAVAILABLE_NOTES: Record<UnavailableReason, string> = {
  cross_origin:
    "video reports zero decodable width but its source is cross-origin; no local proxy can be served for it",
  proxy_playback_failed: "the authoring proxy itself failed to decode; render output is unaffected",
  browser_safe_codec:
    "the file errored but its codec is browser-decodable; a proxy cannot help (the file itself is likely corrupt)",
  invalid_source_url: "the media source URL is malformed and cannot be proxied",
};

function emitUnavailableDiagnostic(
  el: HTMLMediaElement,
  reason: UnavailableReason,
  asset: string,
): void {
  if (unavailableDiagnosedElements.has(el)) return;
  unavailableDiagnosedElements.add(el);
  const note = UNAVAILABLE_NOTES[reason];
  const details: Record<string, RuntimeJson> = {
    asset,
    codecName: null,
    reason,
    note,
  };
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: DIAGNOSTIC_UNAVAILABLE_CODE,
    details,
  });
  // Mirrors swapToProxy's fallback line: the stable diagnostic code is in the
  // text so checkBrowser.ts's console scraper can match a token, not prose.
  console.info(`[hyperframes] ${DIAGNOSTIC_UNAVAILABLE_CODE}: "${asset}" (${reason}): ${note}`);
}

/**
 * Swap `el` to its alpha-aware proxy URL, evict stale per-source sync state, and
 * emit the one-time diagnostic + console line. Safe to call from any of the
 * three triggers (proactive/reactive/tertiary); a no-op if already swapped.
 */
export function swapToProxy(
  el: HTMLMediaElement,
  entry: MediaCodecMapEntry | null = null,
  trigger: ProxyTrigger = "reactive",
): void {
  if (swappedElements.has(el)) return;
  const originalSrc = currentSrcValue(el);
  let proxiedSrc: string;
  try {
    proxiedSrc = appendProxyParam(originalSrc, entry);
  } catch (err) {
    swallow("runtime.mediaProxy.swap", err);
    emitUnavailableDiagnostic(el, "invalid_source_url", originalSrc);
    return;
  }
  swappedElements.add(el);
  // The swapped src points at a different file — sync state (drift offsets,
  // seek-retry latches, volume tracking) computed against the original
  // source must not carry over, or the next tick misreads a fresh file's
  // buffering as drift. Evict before `load()` so the very next sync tick
  // treats this element as a first tick.
  evictMediaSyncState(el);
  el.src = proxiedSrc;
  el.load();
  const codecName = entry?.codecName ?? null;
  const details: Record<string, RuntimeJson> = {
    asset: originalSrc,
    codecName,
    trigger,
    note: "render output is unaffected; only this preview element was swapped to an authoring proxy",
  };
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: DIAGNOSTIC_FALLBACK_CODE,
    details,
  });
  // The diagnostic code doubles as the stable token check's console scraper
  // matches on (packages/cli/src/utils/checkBrowser.ts); keep it in the text.
  console.info(
    `[hyperframes] ${DIAGNOSTIC_FALLBACK_CODE}: "${originalSrc}" uses a codec (${codecName ?? "unknown"}) this browser can't decode; ` +
      "auto-swapped to an authoring proxy for this preview only. Render output is unaffected.",
  );
}

/**
 * Proactive trigger: consult the codec map before an element's first
 * `load()` and swap ahead of time when the browser is known-unlikely to
 * decode it, avoiding an error flash. `<audio>` is never proxied (per the
 * plan's KTD — an HEVC container's AAC track demuxes fine regardless of the
 * browser's video codec support).
 */
export function maybeProxyProactively(el: HTMLMediaElement): void {
  if (isRenderMode(el)) return;
  if (!(el instanceof HTMLVideoElement)) return;
  if (swappedElements.has(el)) return;
  const map = window.__HF_MEDIA_CODEC_MAP__;
  if (!map) return;
  const key = deriveCodecMapKey(el);
  if (key === null) return;
  const entry = lookupCodecMapEntry(key, map);
  if (!entry || !entry.browserHostile) return;
  const canPlay = entry.representativeMime ? el.canPlayType(entry.representativeMime) : "";
  if (canPlay === "probably" || canPlay === "maybe") return;
  swapToProxy(el, entry, "proactive");
}

/**
 * Reactive trigger (the primary catch-all per the plan's KTD): a `<video>`
 * reporting `videoWidth === 0` at `loadedmetadata` has an undecodable (or
 * absent) video track — the common case for an HEVC+AAC file, which fires
 * no error event because the AAC track satisfies the demuxer. Swaps once
 * per element; if the element is already on its proxy src, the proxy
 * itself is the one failing, so this only emits the failure diagnostic.
 *
 * No map, no swaps: the codec map global is only injected on surfaces where
 * auto-proxying is enabled and served, so its absence means a `?hf-proxy=`
 * request would 404 — never swap there. When the map is present but has no
 * entry for this key, swapping stays allowed (unlisted-asset rescue). A
 * mapped alpha entries select the VP9/WebM proxy variant.
 */
export function handleMetadataForProxy(el: HTMLMediaElement): void {
  if (isRenderMode(el)) return;
  if (!(el instanceof HTMLVideoElement)) return;
  if (el.videoWidth !== 0) return;
  const src = currentSrcValue(el);
  if (swappedElements.has(el)) {
    emitUnavailableDiagnostic(el, "proxy_playback_failed", src);
    return;
  }
  const map = window.__HF_MEDIA_CODEC_MAP__;
  if (!map) return;
  const key = deriveCodecMapKey(el);
  if (key === null) {
    emitUnavailableDiagnostic(el, "cross_origin", src);
    return;
  }
  const entry = lookupCodecMapEntry(key, map);
  if (entry && !entry.browserHostile) {
    emitUnavailableDiagnostic(el, "browser_safe_codec", src);
    return;
  }
  swapToProxy(el, entry, "reactive");
}

/**
 * Tertiary trigger: the `error` event, for the rarer zero-decodable-stream
 * file (video-only hostile codec) where the demuxer has nothing to satisfy
 * it and `loadedmetadata` never fires. Same guards and once-per-element
 * behavior as the reactive path, plus one extra skip: an entry the scan
 * mapped as browser-SAFE that still errors is a corrupt-but-safe file — an
 * proxy of a broken source can't help, so only diagnose.
 */
export function handleErrorForProxy(el: HTMLMediaElement): void {
  if (isRenderMode(el)) return;
  if (!(el instanceof HTMLVideoElement)) return;
  const src = currentSrcValue(el);
  if (swappedElements.has(el)) {
    emitUnavailableDiagnostic(el, "proxy_playback_failed", src);
    return;
  }
  const map = window.__HF_MEDIA_CODEC_MAP__;
  if (!map) return;
  const key = deriveCodecMapKey(el);
  if (key === null) {
    emitUnavailableDiagnostic(el, "cross_origin", src);
    return;
  }
  const entry = lookupCodecMapEntry(key, map);
  if (entry && !entry.browserHostile) {
    emitUnavailableDiagnostic(el, "browser_safe_codec", src);
    return;
  }
  swapToProxy(el, entry, "tertiary");
}
