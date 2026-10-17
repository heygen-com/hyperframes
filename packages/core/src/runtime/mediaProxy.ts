import { postRuntimeMessage } from "./bridge";
import { swallow } from "./diagnostics";
import { evictMediaSyncState, HOLD_CAP_MS } from "./media";
import { findInjectedRenderFrame } from "./renderFrameSibling";
import type { RuntimeJson } from "./types";
import { isVideoElement } from "./domRealm";
import { swappedElements } from "./proxySrc";
import { waitForServedProxy } from "./proxyWait";
import { registerSeekCompletion } from "./adapters/seek-dispatch";
import {
  formatPreviewProxyBox,
  PREVIEW_CAPTURE_PARAM,
  PREVIEW_PROXY_BOX_PARAM,
  quantizePreviewProxyBox,
  type PreviewProxyBox,
} from "../previewProxyBox";

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
  /** Source carries an alpha channel and therefore needs a VP8/WebM proxy.
   * Optional so pre-alpha-aware maps stay assignable; absent means "no alpha detected". */
  hasAlpha?: boolean;
  /** Browser-safe, but keyframes are more than 2 s apart, so each jump decodes far. */
  seekHostile?: boolean;
  /** Source size, sent with seek-hostile entries so a copy is sized before the video loads. */
  width?: number;
  height?: number;
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

// `swappedElements` gates every trigger, so a second undecodable-video signal never re-swaps.

// Elements that already got the "can't help you" diagnostic (cross-origin,
// or the proxy itself failing) — one-shot per element, independent of
// `swappedElements` so the proxy-failed case (which fires AFTER a real swap)
// still gets its own single diagnostic.
const unavailableDiagnosedElements = new WeakSet<HTMLMediaElement>();

// Elements whose swap has started, with the src it started for. Until the copy is served they
// keep that src, so nothing that reads it (timeline, player mirror) loads a copy still being made.
const proxyRequested = new WeakMap<HTMLMediaElement, string | null>();

function currentSrcValue(el: HTMLMediaElement): string {
  return el.currentSrc || el.src;
}

// How large the host shows this document, in its CSS pixels per ours (player fit x page zoom).
// A top-level page shows itself at 1; a framed one waits for its host to say.
let displayScale: number | null = window.parent === window ? 1 : null;
let displayScaleArrived: () => void = () => {};
const displayScaleKnown = new Promise<void>((arrived) => (displayScaleArrived = arrived));
// A host that never says (an older player) gets the source-size copy after this wait.
const DISPLAY_SCALE_WAIT_MS = 1000;

// Elements on a size-bounded copy: the source, the copy's URL and the box it was made for.
type BoxedCopy = { originalSrc: string; variant: string; href: string; box: PreviewProxyBox };
const boxedElements = new Map<HTMLMediaElement, BoxedCopy>();
// The larger copy each element waits for; a newer ask replaces it and the older wait stops.
const pendingUpgrades = new WeakMap<HTMLMediaElement, string>();

function shownScale(): Promise<number | null> {
  if (displayScale !== null) return Promise.resolve(displayScale);
  return Promise.race([
    displayScaleKnown.then(() => displayScale),
    new Promise<null>((give) => setTimeout(() => give(null), DISPLAY_SCALE_WAIT_MS)),
  ]);
}

/** The video's box in device pixels, at least the stage so a later zoom or a clip still hidden fits. */
function shownBox(el: HTMLMediaElement, scale: number): PreviewProxyBox | null {
  // object-fit: none shows the source at its own size.
  if (getComputedStyle(el).objectFit === "none") return null;
  const rect = el.getBoundingClientRect();
  const stage = document.documentElement;
  const pixels = scale * (window.devicePixelRatio || 1);
  return quantizePreviewProxyBox(
    Math.max(rect.width, stage.clientWidth) * pixels,
    Math.max(rect.height, stage.clientHeight) * pixels,
  );
}

const HAVE_CURRENT_DATA = 2;

function showsFrames(el: HTMLMediaElement): boolean {
  return isVideoElement(el) && el.videoWidth > 0 && el.readyState >= HAVE_CURRENT_DATA;
}

/** The one rule for when a served copy replaces what an element plays: at once when it is paused
 * or shows nothing, else at its next pause, so a playing picture never blanks mid-play. */
function swapWhenSafe(el: HTMLMediaElement, swap: () => void): void {
  if (el.paused || !showsFrames(el)) swap();
  else el.addEventListener("pause", swap, { once: true });
}

/** Settles once the element shows its own frames, after which a jump needs no copy. */
function framesShown(el: HTMLMediaElement): Promise<void> {
  return new Promise((shown) => {
    const check = () =>
      showsFrames(el) ? shown() : el.addEventListener("loadeddata", check, { once: true });
    check();
  });
}

/** The host reports how large it shows this document; copies too small for it are replaced. */
export function setProxyDisplayScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  displayScale = scale;
  displayScaleArrived();
  for (const el of boxedElements.keys()) keepSized(el, scale);
}

function keepSized(el: HTMLMediaElement, scale: number): void {
  const copy = boxedElements.get(el);
  if (!copy) return;
  if (!el.isConnected || el.getAttribute("src") !== copy.href) {
    boxedElements.delete(el);
    return;
  }
  const needed = shownBox(el, scale);
  if (needed && needed.width <= copy.box.width && needed.height <= copy.box.height) return;
  // Never smaller on either side than the copy it replaces.
  const box = needed && {
    width: Math.max(needed.width, copy.box.width),
    height: Math.max(needed.height, copy.box.height),
  };
  const href = appendProxyParam(copy.originalSrc, copy.variant, box);
  if (pendingUpgrades.get(el) === href) return;
  pendingUpgrades.set(el, href);
  const wanted = () =>
    pendingUpgrades.get(el) === href && el.isConnected && el.getAttribute("src") === copy.href;
  const settle = () => {
    if (pendingUpgrades.get(el) === href) pendingUpgrades.delete(el);
  };
  void waitForServedProxy(href, wanted).then((served) => {
    if (!served || !wanted()) return settle();
    swapWhenSafe(el, () => {
      if (wanted()) loadProxy(el, href, copy.originalSrc, copy.variant, box);
      settle();
    });
  });
}

function loadProxy(
  el: HTMLMediaElement,
  href: string,
  originalSrc: string,
  variant: string,
  box: PreviewProxyBox | null,
): void {
  if (box) boxedElements.set(el, { originalSrc, variant, href, box });
  else boxedElements.delete(el);
  // Sync state measured on the previous file would read the new file's buffering as drift.
  evictMediaSyncState(el);
  el.src = href;
  el.load();
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
  return isVideoElement(el) && !!findInjectedRenderFrame(el);
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

function appendProxyParam(src: string, variant: string, box: PreviewProxyBox | null): string {
  const url = new URL(src, document.baseURI);
  url.searchParams.set(PROXY_QUERY_PARAM, variant);
  if (box) url.searchParams.set(PREVIEW_PROXY_BOX_PARAM, formatPreviewProxyBox(box));
  // The server lends a capture a finished copy and never starts one for it.
  if (new URL(document.URL).searchParams.has(PREVIEW_CAPTURE_PARAM)) {
    url.searchParams.set(PREVIEW_CAPTURE_PARAM, "1");
  }
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
  if (proxyRequested.has(el) && proxyRequested.get(el) === el.getAttribute("src")) return;
  const originalSrc = currentSrcValue(el);
  const variant = entry ? (entry.hasAlpha ? "vp8" : "h264") : "auto";
  try {
    new URL(originalSrc, document.baseURI);
  } catch (err) {
    swallow("runtime.mediaProxy.swap", err);
    emitUnavailableDiagnostic(el, "invalid_source_url", originalSrc);
    return;
  }
  const originalAttr = el.getAttribute("src");
  proxyRequested.set(el, originalAttr);
  const live = () => el.isConnected && el.getAttribute("src") === originalAttr;
  const swap = shownScale().then(async (scale) => {
    // Asked once the shown size is known, so the copy is made at that size and only once.
    const box = scale === null ? null : shownBox(el, scale);
    const proxiedSrc = appendProxyParam(originalSrc, variant, box);
    const served = await waitForServedProxy(proxiedSrc, live);
    if (!live()) {
      if (proxyRequested.get(el) === originalAttr) proxyRequested.delete(el);
      return;
    }
    if (!served) {
      emitUnavailableDiagnostic(el, "proxy_playback_failed", originalSrc);
      return;
    }
    return new Promise((landed) => {
      swapWhenSafe(el, () => {
        if (!live()) return landed(undefined);
        swappedElements.set(el, originalAttr);
        loadProxy(el, proxiedSrc, originalSrc, variant, box);
        // The shown size may have grown while this copy was being made.
        if (displayScale !== null) keepSized(el, displayScale);
        el.addEventListener("loadeddata", landed, { once: true });
        el.addEventListener("error", landed, { once: true });
      });
    });
  });
  // A frame capture holds for the copy as it held for a loading video, up to the same cap, and
  // no longer once the original shows its own frames.
  registerSeekCompletion(
    Promise.race([swap, framesShown(el), new Promise((cap) => setTimeout(cap, HOLD_CAP_MS))]),
    "video-frame",
  );
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
  if (!isVideoElement(el)) return;
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
 * mapped alpha entries select the VP8/WebM proxy variant.
 */
export function handleMetadataForProxy(el: HTMLMediaElement): void {
  if (isRenderMode(el)) return;
  if (!isVideoElement(el)) return;
  if (el.videoWidth !== 0) {
    void runSeekCopies();
    return;
  }
  swapOrDiagnose(el, "reactive");
}

function swapOrDiagnose(el: HTMLMediaElement, trigger: ProxyTrigger): void {
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
  swapToProxy(el, entry, trigger);
}

/** What seek copies read from the transport. */
export type SeekCopyHost = {
  playhead: () => number;
  playing: () => boolean;
  clips: () => ReadonlyArray<{ el: HTMLMediaElement; start: number; end: number }>;
};

// The server stops background copies for 15 s per "playing"; this keeps that true while it plays.
const PLAYBACK_BEAT_MS = 5000;
let seekCopyHost: SeekCopyHost | null = null;
let seekCopiesRunning = false;
let previewPlaying = false;
let playingBeat: ReturnType<typeof setInterval> | undefined;

function isSeekCopyEntry(entry: MediaCodecMapEntry | null | undefined): boolean {
  return !!entry?.seekHostile && !entry.browserHostile;
}

function pendingSeekCopy(el: HTMLMediaElement): MediaCodecMapEntry | null {
  const map = window.__HF_MEDIA_CODEC_MAP__;
  if (!map || !isVideoElement(el) || !el.isConnected || isRenderMode(el)) return null;
  if (swappedElements.has(el) || proxyRequested.get(el) === el.getAttribute("src")) return null;
  const key = deriveCodecMapKey(el);
  const entry = key === null ? null : lookupCodecMapEntry(key, map);
  return isSeekCopyEntry(entry) ? entry : null;
}

function distanceFromPlayhead(clip: { start: number; end: number }, time: number): number {
  const end = Number.isFinite(clip.end) ? clip.end : clip.start;
  return time < clip.start ? clip.start - time : Math.max(0, time - end);
}

/** min(source, shown) on each side, on the size ladder; the source size when the host never says. */
function seekCopyBox(
  el: HTMLMediaElement,
  entry: MediaCodecMapEntry,
  scale: number | null,
): PreviewProxyBox | null {
  const width = entry.width || (el as HTMLVideoElement).videoWidth;
  const height = entry.height || (el as HTMLVideoElement).videoHeight;
  if (!width || !height) return null;
  const shown = (scale !== null && shownBox(el, scale)) || { width, height };
  return quantizePreviewProxyBox(Math.min(width, shown.width), Math.min(height, shown.height));
}

async function askForSeekCopy(
  el: HTMLMediaElement,
  entry: MediaCodecMapEntry,
  host: SeekCopyHost,
): Promise<void> {
  const originalAttr = el.getAttribute("src");
  const originalSrc = currentSrcValue(el);
  proxyRequested.set(el, originalAttr);
  const box = seekCopyBox(el, entry, await shownScale());
  if (!box) return;
  if (host.playing()) {
    proxyRequested.delete(el);
    return;
  }
  const href = appendProxyParam(originalSrc, "h264", box);
  const live = () => el.isConnected && el.getAttribute("src") === originalAttr;
  if (!(await waitForServedProxy(href, live))) return;
  const swap = () => {
    if (!live()) return;
    swappedElements.set(el, originalAttr);
    loadProxy(el, href, originalSrc, "h264", box);
  };
  swapWhenSafe(el, swap);
}

function nearestPendingSeekCopy(
  host: SeekCopyHost,
): { el: HTMLMediaElement; entry: MediaCodecMapEntry; distance: number } | null {
  const time = host.playhead();
  let next: { el: HTMLMediaElement; entry: MediaCodecMapEntry; distance: number } | null = null;
  for (const clip of host.clips()) {
    const entry = pendingSeekCopy(clip.el);
    const distance = distanceFromPlayhead(clip, time);
    if (entry && (!next || distance < next.distance)) next = { el: clip.el, entry, distance };
  }
  return next;
}

/** One copy at a time, the clip nearest the playhead first (re-picked after each, so a jump
 * re-orders the rest); none starts while playing. Jumps never wait on a copy. */
async function runSeekCopies(): Promise<void> {
  const host = seekCopyHost;
  if (!host || seekCopiesRunning) return;
  seekCopiesRunning = true;
  try {
    while (!host.playing()) {
      const next = nearestPendingSeekCopy(host);
      if (!next) return;
      await askForSeekCopy(next.el, next.entry, host);
    }
  } catch (err) {
    swallow("runtime.mediaProxy.seekCopy", err);
  } finally {
    seekCopiesRunning = false;
  }
}

/** After the preview's first frame: copy every seek-hostile video, at min(source, shown size). */
export function startSeekCopies(host: SeekCopyHost): void {
  if (window.__HF_EXPORT_RENDER_SEEK_CONFIG) return;
  if (!Object.values(window.__HF_MEDIA_CODEC_MAP__ ?? {}).some(isSeekCopyEntry)) return;
  seekCopyHost = host;
  void runSeekCopies();
}

function postPlayback(playing: boolean): void {
  void fetch(new URL("playback", document.baseURI), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playing }),
  }).catch(() => {});
}

/** Every transport change passes here: the server hears play and pause, and copies resume on pause. */
export function noteSeekCopyPlayback(playing: boolean): void {
  if (!seekCopyHost || playing === previewPlaying) return;
  previewPlaying = playing;
  clearInterval(playingBeat);
  playingBeat = undefined;
  postPlayback(playing);
  if (playing) playingBeat = setInterval(() => postPlayback(true), PLAYBACK_BEAT_MS);
  else void runSeekCopies();
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
  if (!isVideoElement(el)) return;
  swapOrDiagnose(el, "tertiary");
}
