import { wallClearInterval, wallSetInterval, wallSetTimeout } from "./wallClock";
import { postRuntimeMessage } from "./bridge";
import { swallow } from "./diagnostics";
import {
  evictMediaSyncState,
  HOLD_CAP_MS,
  isActiveAtPlayhead,
  sourceTimeAtPlayhead,
} from "./media";
import { findInjectedRenderFrame } from "./renderFrameSibling";
import type { RuntimeJson } from "./types";
import { isVideoElement } from "./domRealm";
import {
  currentSrcValue,
  deriveCodecMapKey,
  lookupCodecMapEntry,
  sourceFactsOf,
} from "./mediaSourceLookup";
import {
  heldForCopy,
  heldPosters,
  inPointOf,
  recordOpenedAtInPoint,
  swappedElements,
  unproxiedSrc,
} from "./proxySrc";
import { giveBackWhenDue, stopMediaDownload } from "./preloadMedia";
import { restartPlaybackHealth } from "./playbackHealth";
import { failedCopyElements, noteCopy, setCopyReportingLevel } from "./previewCopies";
import { waitForServedProxy } from "./proxyWait";
import { registerSeekCompletion } from "./adapters/seek-dispatch";
import {
  formatPreviewProxyBox,
  isHeavyForPreview,
  isOversizedForPreview,
  isPreviewQuality,
  PREVIEW_QUALITY_LEVELS,
  PREVIEW_PROXY_BOX_PARAM,
  PREVIEW_PROXY_LIGHT_PARAM,
  PREVIEW_PROXY_RETRY_PARAM,
  PREVIEW_PROXY_STILL_PARAM,
  quantizePreviewProxyBox,
  scalePreviewProxyBox,
  type PreviewProxyBox,
  type PreviewQuality,
  type PreviewSourceFacts,
  wantsLighterCopy,
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

type ProxyTrigger = "proactive" | "reactive" | "tertiary" | "light";

// `swappedElements` gates every trigger, so a second undecodable-video signal never re-swaps.

// Elements that already got the "can't help you" diagnostic (cross-origin,
// or the proxy itself failing) — one-shot per element, independent of
// `swappedElements` so the proxy-failed case (which fires AFTER a real swap)
// still gets its own single diagnostic.
const unavailableDiagnosedElements = new WeakSet<HTMLMediaElement>();

// Elements whose swap has started, with the src it started for. Until the copy is served they
// keep that src, so nothing that reads it (timeline, player mirror) loads a copy still being made.
const proxyRequested = new WeakMap<HTMLMediaElement, string | null>();

// Below 1, heavy files get lighter copies at the shown box times this level; at 1, files oversized for their box.
let previewQuality: PreviewQuality = 1;
// Elements whose next ask for a copy tells the server to forget its failure first.
const retryNext = new WeakSet<HTMLMediaElement>();

// How large the host shows this document, in its CSS pixels per ours (player fit x page zoom).
// A top-level page shows itself at 1; a framed one waits for its host to say.
let displayScale: number | null = window.parent === window ? 1 : null;
let displayScaleArrived: () => void = () => {};
const displayScaleKnown = new Promise<void>((arrived) => (displayScaleArrived = arrived));
// A host that never says (an older player) gets the source-size copy after this wait.
const DISPLAY_SCALE_WAIT_MS = 1000;

// Elements on a size-bounded copy: the source, the copy's URL and the box it was made for.
type BoxedCopy = {
  originalSrc: string;
  variant: string;
  href: string;
  box: PreviewProxyBox;
  light: boolean;
};
const boxedElements = new Map<HTMLMediaElement, BoxedCopy>();
// The larger copy each element waits for; a newer ask replaces it and the older wait stops.
const pendingUpgrades = new WeakMap<HTMLMediaElement, string>();

function shownScale(): Promise<number | null> {
  if (displayScale !== null) return Promise.resolve(displayScale);
  return Promise.race([
    displayScaleKnown.then(() => displayScale),
    new Promise<null>((give) => wallSetTimeout(() => give(null), DISPLAY_SCALE_WAIT_MS)),
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

/** The host reports how large it shows this document; copies too small for it are replaced. */
export function setProxyDisplayScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  displayScale = scale;
  displayScaleArrived();
  for (const el of boxedElements.keys()) keepSized(el, scale);
}

function codecEntryOf(el: HTMLMediaElement): MediaCodecMapEntry | null {
  const map = window.__HF_MEDIA_CODEC_MAP__;
  const key = deriveCodecMapKey(el);
  return map && key !== null ? lookupCodecMapEntry(key, map) : null;
}

// fallow-ignore-next-line complexity
function keepSized(el: HTMLMediaElement, scale: number): void {
  const copy = boxedElements.get(el);
  if (!copy) return;
  if (!el.isConnected || el.getAttribute("src") !== copy.href) {
    boxedElements.delete(el);
    return;
  }
  const shown = shownBox(el, scale);
  const lowered = previewQuality < 1;
  const needed = shown && lowered ? scalePreviewProxyBox(shown, previewQuality) : shown;
  if (lowered && !needed) return;
  if (needed && copy.light && lightCopyNoLongerNeeded(el, needed)) {
    return restoreOriginal(el);
  }
  if (boxCovers(copy.box, needed, lowered)) return dropUnneededCopy(el);
  requestBox(el, copy, lowered || !needed ? needed : growOnly(needed, copy.box));
}

function dropUnneededCopy(el: HTMLMediaElement): void {
  if (pendingUpgrades.delete(el)) noteCopy(el, "ready");
}

function lightCopyNoLongerNeeded(el: HTMLMediaElement, needed: PreviewProxyBox): boolean {
  const facts = sourceFactsOf(el);
  return facts !== null && !wantsLighterCopy(facts, needed, previewQuality);
}

function boxCovers(current: PreviewProxyBox, needed: PreviewProxyBox | null, exact: boolean) {
  if (exact) return needed?.width === current.width && needed.height === current.height;
  return needed !== null && needed.width <= current.width && needed.height <= current.height;
}

function growOnly(needed: PreviewProxyBox, current: PreviewProxyBox): PreviewProxyBox {
  return {
    width: Math.max(needed.width, current.width),
    height: Math.max(needed.height, current.height),
  };
}

function requestBox(el: HTMLMediaElement, copy: BoxedCopy, box: PreviewProxyBox | null): void {
  const href = appendProxyParam(
    copy.originalSrc,
    copy.variant,
    box,
    copy.light,
    retryNext.delete(el),
  );
  if (pendingUpgrades.get(el) === href) return;
  pendingUpgrades.set(el, href);
  const wanted = () =>
    pendingUpgrades.get(el) === href && el.isConnected && el.getAttribute("src") === copy.href;
  noteCopy(el, "making", null, copy.light);
  void waitForServedProxy(
    href,
    wanted,
    (fraction) => wanted() && noteCopy(el, "making", fraction, copy.light),
    () => isActiveAtPlayhead(el),
  ).then((served) => {
    if (wanted()) noteCopy(el, served ? "ready" : "failed", null, copy.light);
    if (served && wanted()) loadProxy(el, href, copy.originalSrc, copy.variant, box, copy.light);
    if (pendingUpgrades.get(el) === href) pendingUpgrades.delete(el);
  });
}

/** Puts a video that only got a lighter copy back on its original. */
function restoreOriginal(el: HTMLMediaElement): void {
  const original = swappedElements.get(el) ?? null;
  for (const state of [boxedElements, pendingUpgrades, proxyRequested, swappedElements]) {
    state.delete(el);
  }
  evictMediaSyncState(el);
  restartPlaybackHealth();
  if (original === null) {
    // No file loads, so no event would ever let a held still go.
    letGoOfStill.get(el)?.();
    el.removeAttribute("src");
  } else {
    holdShownFrame(el);
    el.setAttribute("src", original);
  }
  el.load();
}

// Wide enough to stand in for the picture for the moment a swap takes; small enough to encode in a few ms.
const HELD_STILL_WIDTH = 640;
const HAVE_CURRENT_DATA = 2;
// The new file can draw (and is not seeking), or it failed and holding would freeze the picture.
const RELEASE_EVENTS = ["loadeddata", "seeked", "error"] as const;
const letGoOfStill = new WeakMap<HTMLMediaElement, () => void>();

/** A swapped source empties the video until the new file decodes, which shows black. Until then it shows a still
 * of the frame it had, as its poster. */
function holdShownFrame(el: HTMLMediaElement): void {
  if (!isVideoElement(el) || heldPosters.has(el)) return;
  const still = stillOf(el);
  if (!still) return;
  heldPosters.set(el, { poster: el.getAttribute("poster"), since: performance.now() });
  el.setAttribute("poster", still);
  const letGo = () => {
    for (const type of RELEASE_EVENTS) el.removeEventListener(type, release);
    letGoOfStill.delete(el);
    const authored = heldPosters.get(el)?.poster ?? null;
    heldPosters.delete(el);
    if (authored === null) el.removeAttribute("poster");
    else el.setAttribute("poster", authored);
  };
  const release = (event: Event) => {
    if (event.type === "error" || (el.readyState >= HAVE_CURRENT_DATA && !el.seeking)) letGo();
  };
  for (const type of RELEASE_EVENTS) el.addEventListener(type, release);
  letGoOfStill.set(el, letGo);
}

/** The frame the video shows, as a JPEG data URL; null with no frame yet or one the page may not read. */
function stillOf(el: HTMLVideoElement): string | null {
  if (el.readyState < HAVE_CURRENT_DATA || !el.videoWidth || !el.videoHeight) return null;
  const scale = Math.min(1, HELD_STILL_WIDTH / el.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(el.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
  try {
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    // A cross-origin frame taints the canvas: the swap goes ahead with nothing held.
    return null;
  }
}

function loadProxy(
  el: HTMLMediaElement,
  href: string,
  originalSrc: string,
  variant: string,
  box: PreviewProxyBox | null,
  light = false,
): void {
  if (box) boxedElements.set(el, { originalSrc, variant, href, box, light });
  else boxedElements.delete(el);
  // Sync state measured on the previous file would read the new file's buffering as drift.
  evictMediaSyncState(el);
  restartPlaybackHealth();
  holdShownFrame(el);
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
export function isRenderMode(el: HTMLMediaElement): boolean {
  if (window.__HF_EXPORT_RENDER_SEEK_CONFIG) return true;
  return isVideoElement(el) && !!findInjectedRenderFrame(el);
}

const stills = new WeakSet<HTMLMediaElement>();

/** While a file the browser cannot play is being copied, its own frame at the playhead stands in as the poster. */
function showStill(
  el: HTMLMediaElement,
  originalSrc: string,
  variant: string,
  box: PreviewProxyBox | null,
): void {
  const at = sourceTimeAtPlayhead(el);
  if (at === undefined || stills.has(el) || el.hasAttribute("poster")) return;
  const url = new URL(appendProxyParam(originalSrc, variant, box), document.baseURI);
  url.searchParams.set(PREVIEW_PROXY_STILL_PARAM, at.toFixed(1));
  stills.add(el);
  el.setAttribute("poster", url.href);
}

function dropStill(el: HTMLMediaElement): void {
  if (stills.delete(el)) el.removeAttribute("poster");
}

function appendProxyParam(
  src: string,
  variant: string,
  box: PreviewProxyBox | null,
  light = false,
  retry = false,
): string {
  const url = new URL(src, document.baseURI);
  url.searchParams.set(PROXY_QUERY_PARAM, variant);
  if (box) url.searchParams.set(PREVIEW_PROXY_BOX_PARAM, formatPreviewProxyBox(box));
  if (light && box) url.searchParams.set(PREVIEW_PROXY_LIGHT_PARAM, "1");
  if (retry) url.searchParams.set(PREVIEW_PROXY_RETRY_PARAM, "1");
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

/** Holds `el` with no src while its copy is made (readers still see its file); false with no src to hold. */
function holdForCopy(el: HTMLMediaElement): boolean {
  const authored = unproxiedSrc(el);
  if (authored === null) return false;
  heldForCopy.set(el, inPointOf(el));
  recordOpenedAtInPoint(el, authored, null);
  stopMediaDownload(el);
  holdFrameCaptures(
    new Promise((landed) => {
      el.addEventListener("loadeddata", landed, { once: true });
      el.addEventListener("error", landed, { once: true });
    }),
  );
  return true;
}

/** Without a copy (`giveBack` set), a clip held until due stays held; any other gets its src back as the runtime's. */
function endCopyHold(el: HTMLMediaElement, giveBack: string | null): void {
  if (!heldForCopy.has(el)) return;
  const before = heldForCopy.get(el);
  heldForCopy.delete(el);
  if (giveBack === null || el.getAttribute("src") !== null) return;
  const src = before ? before.written : giveBack;
  recordOpenedAtInPoint(el, before?.authored ?? giveBack, src, before?.holdsWhenIdle);
  if (src !== null) el.setAttribute("src", src);
}

function holdFrameCaptures(until: Promise<unknown>): void {
  registerSeekCompletion(
    Promise.race([until, new Promise((cap) => wallSetTimeout(cap, HOLD_CAP_MS))]),
    "video-frame",
  );
}

type CopyJob = {
  originalSrc: string;
  originalAttr: string | null;
  variant: string;
  lightFacts?: PreviewSourceFacts;
  level: PreviewQuality;
  live: () => boolean;
};

// fallow-ignore-next-line complexity
async function makeCopy(el: HTMLMediaElement, job: CopyJob, scale: number | null) {
  const { originalSrc, originalAttr, variant, lightFacts, level, live } = job;
  // Asked once the shown size is known, so the copy is made at that size and only once.
  const shown = scale === null ? null : shownBox(el, scale);
  const box = shown && level < 1 ? scalePreviewProxyBox(shown, level) : shown;
  if (lightFacts && !(box && wantsLighterCopy(lightFacts, box, level))) {
    if (proxyRequested.get(el) === originalAttr) proxyRequested.delete(el);
    return;
  }
  const held = lightFacts && box && isOversizedForPreview(lightFacts, box) && holdForCopy(el);
  const proxiedSrc = appendProxyParam(
    originalSrc,
    variant,
    box,
    lightFacts !== undefined,
    retryNext.delete(el),
  );
  const light = lightFacts !== undefined;
  noteCopy(el, "making", null, light);
  const served = await waitForServedProxy(
    proxiedSrc,
    live,
    (fraction) => noteCopy(el, "making", fraction, light),
    () => isActiveAtPlayhead(el),
    false,
    light && !held ? undefined : () => showStill(el, originalSrc, variant, box),
  );
  const wanted = live();
  if (held) endCopyHold(el, served && wanted ? null : originalAttr);
  if (!wanted) {
    dropStill(el);
    if (proxyRequested.get(el) === originalAttr) proxyRequested.delete(el);
    if (lightFacts && el.isConnected && el.getAttribute("src") === originalAttr) {
      applyPreviewQuality(el);
    }
    return;
  }
  if (!served) {
    dropStill(el);
    noteCopy(el, "failed", null, light);
    emitUnavailableDiagnostic(el, "proxy_playback_failed", originalSrc);
    return;
  }
  noteCopy(el, "ready", null, light);
  swappedElements.set(el, held ? originalAttr : unproxiedSrc(el));
  loadProxy(el, proxiedSrc, originalSrc, variant, box, lightFacts !== undefined);
  // The shown size may have grown while this copy was being made.
  if (displayScale !== null) keepSized(el, displayScale);
  return new Promise((landed) => {
    el.addEventListener("loadeddata", landed, { once: true });
    el.addEventListener("error", landed, { once: true });
  }).then(() => dropStill(el));
}

/**
 * Swap `el` to its alpha-aware proxy URL, evict stale per-source sync state, and
 * emit the one-time diagnostic + console line. Safe to call from any of the
 * three triggers (proactive/reactive/tertiary); a no-op if already swapped.
 */
function copyVariant(entry: MediaCodecMapEntry | null): string {
  if (!entry) return "auto";
  return entry.hasAlpha ? "vp8" : "h264";
}

export function swapToProxy(
  el: HTMLMediaElement,
  entry: MediaCodecMapEntry | null = null,
  trigger: ProxyTrigger = "reactive",
  lightFacts?: PreviewSourceFacts,
): void {
  if (swappedElements.has(el)) return;
  giveBackWhenDue(el);
  if (proxyRequested.has(el) && proxyRequested.get(el) === el.getAttribute("src")) return;
  const originalSrc = currentSrcValue(el);
  const variant = copyVariant(entry);
  try {
    new URL(originalSrc, document.baseURI);
  } catch (err) {
    swallow("runtime.mediaProxy.swap", err);
    emitUnavailableDiagnostic(el, "invalid_source_url", originalSrc);
    return;
  }
  const originalAttr = el.getAttribute("src");
  proxyRequested.set(el, originalAttr);
  const level = previewQuality;
  // A lighter copy waits for no level but its own; a copy the file cannot play without finishes at any level.
  const live = () =>
    el.isConnected &&
    (el.getAttribute("src") === originalAttr ||
      (heldForCopy.has(el) && el.getAttribute("src") === null)) &&
    (!lightFacts || previewQuality === level);
  const job: CopyJob = { originalSrc, originalAttr, variant, lightFacts, level, live };
  const swap = shownScale().then((scale) => makeCopy(el, job, scale));
  if (lightFacts) return;
  // A frame capture holds for the copy as it held for a loading video before, up to the same cap.
  holdFrameCaptures(swap);
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
  const entry = codecEntryOf(el);
  const canPlay = entry?.representativeMime ? el.canPlayType(entry.representativeMime) : "";
  const playable = canPlay === "probably" || canPlay === "maybe";
  if (entry?.browserHostile && !playable) swapToProxy(el, entry, "proactive");
  else lightenIfHeavy(el, entry);
}

function lightenIfHeavy(el: HTMLMediaElement, entry: MediaCodecMapEntry | null): void {
  if (swappedElements.has(el) || proxyRequested.has(el)) return;
  const facts = sourceFactsOf(el);
  if (facts) swapToProxy(el, entry, "light", facts);
}

function applyPreviewQuality(el: HTMLMediaElement): void {
  if (isRenderMode(el) || !isVideoElement(el)) return;
  if (boxedElements.has(el) && displayScale !== null) return keepSized(el, displayScale);
  lightenIfHeavy(el, codecEntryOf(el));
}

/** The host's preview quality: below 1, heavy videos play lighter copies at the shown box times the level. */
export function setPreviewQuality(level: number): void {
  if (!isPreviewQuality(level) || level === previewQuality) return;
  previewQuality = level;
  setCopyReportingLevel(level);
  restartPlaybackHealth();
  for (const el of document.querySelectorAll("video")) applyPreviewQuality(el);
}

/** The lower levels at which at least one video would get a lighter copy, by the same rule that makes them. */
export function levelsWithLighterCopies(): PreviewQuality[] {
  if (displayScale === null) return [];
  const sized = [...document.querySelectorAll("video")].flatMap((el) => {
    const facts = sourceFactsOf(el);
    const shown = facts && shownBox(el, displayScale ?? 1);
    return facts && shown ? [{ facts, shown }] : [];
  });
  return PREVIEW_QUALITY_LEVELS.filter(
    (level) =>
      level < 1 &&
      sized.some(({ facts, shown }) =>
        isHeavyForPreview(facts, scalePreviewProxyBox(shown, level)),
      ),
  );
}

const COPY_AHEAD_CHECK_MS = 2000;
const COPY_AHEAD_LEVEL: PreviewQuality = 0.5;
let copiesAheadTimer: ReturnType<typeof setInterval> | null = null;
let makingCopyAhead = false;
const copiesAheadDone = new Set<string>();

function copyAheadBox(el: HTMLMediaElement, isShown: (el: HTMLMediaElement) => boolean) {
  if (displayScale === null || !isShown(el) || swappedElements.has(el)) return null;
  const shown = shownBox(el, displayScale);
  return shown && scalePreviewProxyBox(shown, COPY_AHEAD_LEVEL);
}

/** The 1/2 copy of a clip on screen that is heavy at that size, not yet made. */
function nextCopyAhead(isShown: (el: HTMLMediaElement) => boolean): string | null {
  if (previewQuality < 1) return null;
  for (const el of document.querySelectorAll("video")) {
    const facts = sourceFactsOf(el);
    const box = facts && copyAheadBox(el, isShown);
    if (!facts || !box || !isHeavyForPreview(facts, box)) continue;
    const variant = copyVariant(codecEntryOf(el));
    const href = appendProxyParam(currentSrcValue(el), variant, box, true, false);
    if (!copiesAheadDone.has(href)) return href;
  }
  return null;
}

/** While on, makes those copies one at a time, starting none while `isBusy`. Off by default. */
export function setCopiesAhead(
  on: boolean,
  isBusy: () => boolean,
  isShown: (el: HTMLMediaElement) => boolean = isActiveAtPlayhead,
): void {
  if (copiesAheadTimer !== null) wallClearInterval(copiesAheadTimer);
  copiesAheadTimer = null;
  if (!on) return;
  const live = () => copiesAheadTimer !== null && !isBusy();
  const check = () => {
    if (makingCopyAhead || isBusy()) return;
    const href = nextCopyAhead(isShown);
    if (href === null) return;
    makingCopyAhead = true;
    void waitForServedProxy(href, live, undefined, undefined, true).then((served) => {
      makingCopyAhead = false;
      if (served || live()) copiesAheadDone.add(href);
    });
  };
  copiesAheadTimer = wallSetInterval(check, COPY_AHEAD_CHECK_MS);
  check();
}

/** The video files the composition plays, grouped by what they are, never by name. */
export function describeVideoSources(): Array<{
  codec: string;
  width: number;
  height: number;
  bitDepth: number;
  count: number;
}> {
  const groups = new Map<string, ReturnType<typeof describeVideoSources>[number]>();
  for (const el of document.querySelectorAll("video")) {
    const key = deriveCodecMapKey(el);
    const map = window.__HF_MEDIA_CODEC_MAP__;
    const { width = 0, height = 0, bitDepth = 0, codec: probed } = sourceFactsOf(el) ?? {};
    const hostile = map && key !== null ? lookupCodecMapEntry(key, map)?.codecName : undefined;
    const codec = probed ?? hostile ?? "unknown";
    const id = `${codec}|${width}|${height}|${bitDepth}`;
    const group = groups.get(id) ?? { codec, width, height, bitDepth, count: 0 };
    group.count += 1;
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** Asks again for the copies that failed, telling the server to forget why they did. */
export function retryPreviewCopies(): void {
  for (const el of failedCopyElements()) {
    retryNext.add(el);
    proxyRequested.delete(el);
    pendingUpgrades.delete(el);
    const map = window.__HF_MEDIA_CODEC_MAP__;
    const key = deriveCodecMapKey(el);
    const entry = map && key !== null ? lookupCodecMapEntry(key, map) : null;
    if (boxedElements.has(el) && displayScale !== null) keepSized(el, displayScale);
    else if (entry?.browserHostile) swapToProxy(el, entry, "reactive");
    else lightenIfHeavy(el, entry);
  }
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
  if (el.videoWidth !== 0) return;
  swapOrDiagnose(el, "reactive");
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
