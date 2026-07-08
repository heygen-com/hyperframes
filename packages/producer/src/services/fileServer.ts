// fallow-ignore-file code-duplication complexity
/**
 * File Server for Render Mode
 *
 * Lightweight HTTP server that serves the project directory inside Docker.
 * Key responsibility: inject the verified Hyperframe runtime + render mode extension
 * into index.html on-the-fly, so Puppeteer can load the composition with
 * all relative URLs (compositions, CSS, JS, assets) resolving correctly.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { IncomingMessage } from "node:http";
import { existsSync, realpathSync, statSync, createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join, extname, resolve, sep } from "node:path";
import { injectScriptsAtHeadStart, injectScriptsIntoHtml } from "@hyperframes/core/compiler";
import { fpsToNumber, type Fps } from "@hyperframes/core";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";
import { getHfEarlyStub } from "../generated/hf-early-stub-inline.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";

export { injectScriptsAtHeadStart };

type PathModuleLike = {
  resolve: (...segments: string[]) => string;
  sep: string;
};

type IsPathInsideOptions = {
  resolveSymlinks?: boolean;
  /**
   * Path module used for resolution and separator comparison. Defaults to
   * `node:path` for the running platform. Tests inject `path.win32` /
   * `path.posix` to exercise cross-platform behavior on a single OS.
   */
  pathModule?: PathModuleLike;
};

/**
 * Returns true iff `child` is the same as, or nested inside, `parent` after
 * path normalization. Used to reject path-traversal attempts (e.g.
 * GET `/../etc/passwd`) before opening any file.
 *
 * `path.join(root, "..")` normalizes traversal segments and can escape `root`
 * entirely, so the join return value alone is not a safe guard. Callers must
 * resolve both sides and compare prefixes with the platform separator
 * appended to `parent` to avoid `/foo` matching `/foobar`.
 *
 * Exported for unit tests; not part of the public package surface.
 */
export function isPathInside(
  child: string,
  parent: string,
  options: IsPathInsideOptions = {},
): boolean {
  const { resolveSymlinks = false, pathModule } = options;
  const resolveFn = pathModule?.resolve ?? resolve;
  const separator = pathModule?.sep ?? sep;
  const resolvedChild = resolveFn(child);
  const resolvedParent = resolveFn(parent);
  const normalizedChild =
    resolveSymlinks && existsSync(resolvedChild)
      ? realpathSync.native(resolvedChild)
      : resolvedChild;
  const normalizedParent =
    resolveSymlinks && existsSync(resolvedParent)
      ? realpathSync.native(resolvedParent)
      : resolvedParent;
  if (normalizedChild === normalizedParent) return true;
  const parentWithSep = normalizedParent.endsWith(separator)
    ? normalizedParent
    : normalizedParent + separator;
  return normalizedChild.startsWith(parentWithSep);
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".cube": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Result of parsing a `Range:` request header against a known total size.
 *
 * - `kind: "satisfiable"`: `start <= end < size`. The response should be 206
 *   with `Content-Range: bytes start-end/size` and the sliced body.
 * - `kind: "unsatisfiable"`: the header was syntactically valid (`bytes=...`)
 *   but the resolved range falls outside `[0, size)` (e.g. `start >= size`,
 *   `end < start`, or a suffix request on a zero-byte file). Per RFC 7233
 *   the response should be 416 with `Content-Range: bytes (asterisk)/size`.
 * - `kind: "absent"`: there is no `Range:` header on the request, or it is
 *   syntactically malformed, uses a non-`bytes` unit, or requests multiple
 *   ranges. RFC 7233 allows ignoring such headers and serving the full body
 *   with a 200, which is what callers should do.
 */
export type RangeRequest =
  | { kind: "satisfiable"; start: number; end: number }
  | { kind: "unsatisfiable" }
  | { kind: "absent" };

/**
 * Parse a single-range `Range:` request header per RFC 7233 §2.1.
 *
 * Supports the three forms of `bytes=...`:
 *   - `bytes=START-END`: closed range, both bounds inclusive.
 *   - `bytes=START-`: open-ended, serve from START to EOF.
 *   - `bytes=-SUFFIX`: last SUFFIX bytes.
 *
 * Multi-range requests (`bytes=0-99,200-299`) are treated as `absent`. The
 * caller serves the full body with 200. The hyperframes producer's use case
 * (Chrome `<video>` seeks, range-aware media stack) only ever issues single
 * ranges, so we don't take on the multipart-byteranges complexity here.
 *
 * Exported for unit tests; not part of the public package surface.
 */
export function parseRangeHeader(header: string | null | undefined, size: number): RangeRequest {
  if (!header) return { kind: "absent" };
  const match = /^\s*bytes\s*=\s*(.*?)\s*$/i.exec(header);
  if (!match) return { kind: "absent" };
  const specList = match[1];
  if (!specList || specList.includes(",")) {
    // Multi-range: bail to full-body 200 rather than reassemble
    // multipart/byteranges. Single-range is the only shape we serve.
    return { kind: "absent" };
  }
  const dashIdx = specList.indexOf("-");
  if (dashIdx < 0) return { kind: "absent" };
  const rawStart = specList.slice(0, dashIdx).trim();
  const rawEnd = specList.slice(dashIdx + 1).trim();

  // Suffix form: `bytes=-N` returns the last N bytes.
  if (rawStart === "" && rawEnd !== "") {
    if (!/^\d+$/.test(rawEnd)) return { kind: "absent" };
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen)) return { kind: "absent" };
    if (size === 0 || suffixLen === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffixLen);
    return { kind: "satisfiable", start, end: size - 1 };
  }

  if (!/^\d+$/.test(rawStart)) return { kind: "absent" };
  const start = Number(rawStart);
  if (!Number.isFinite(start)) return { kind: "absent" };

  // Open-ended form: `bytes=START-` returns from START to EOF.
  if (rawEnd === "") {
    if (start >= size) return { kind: "unsatisfiable" };
    return { kind: "satisfiable", start, end: size - 1 };
  }

  // Closed form: `bytes=START-END`
  if (!/^\d+$/.test(rawEnd)) return { kind: "absent" };
  const requestedEnd = Number(rawEnd);
  if (!Number.isFinite(requestedEnd)) return { kind: "absent" };
  if (requestedEnd < start) return { kind: "unsatisfiable" };
  if (start >= size) return { kind: "unsatisfiable" };
  // Clamp the end to the last valid byte.
  const end = Math.min(requestedEnd, size - 1);
  return { kind: "satisfiable", start, end };
}

/**
 * Options for {@link buildVirtualTimeShim}.
 */
export interface VirtualTimeShimOptions {
  /**
   * When `true`, the shim additionally replaces `Math.random` and
   * `crypto.getRandomValues` with a Mulberry32-seeded PRNG keyed by the
   * current frame's virtual time. Compositions that call `Math.random()`
   * during render then produce byte-identical pixels across machines and
   * across replays of the same `(planDir, chunkIndex)` pair.
   *
   * Default `false`: leaves `Math.random` / `crypto.getRandomValues` native,
   * preserving the in-process renderer's non-deterministic behavior for
   * compositions that rely on it.
   */
  seedRandomFromFrame: boolean;
}

/**
 * Build the page-side virtual-time shim script.
 *
 * The shim freezes `Date.now`, `performance.now`, and the rAF/setTimeout
 * pipeline so a render seek can deterministically advance the page's
 * notion of "now". The renderer issues `__HF_VIRTUAL_TIME__.seekToTime(ms)`
 * before every frame capture; everything timing-related on the page sees
 * exactly `ms` until the next seek.
 *
 * When `options.seedRandomFromFrame` is `true`, the returned script also
 * installs a seeded `Math.random` / `crypto.getRandomValues` keyed by the
 * current virtual time — so compositions with stochastic visuals retry
 * identically. When `false`, the shim emits no random-override code; the
 * page's native `Math.random` is left alone (the in-process default).
 */
export function buildVirtualTimeShim(options: VirtualTimeShimOptions): string {
  const seedRandomFromFrame = options.seedRandomFromFrame === true;
  // The seeded-RNG block is gated at build time so the unlocked shim is
  // byte-identical to the pre-flag form. Producer regression baselines
  // compare on rendered pixels — but the file-server unit tests in
  // `fileServer.test.ts` also string-match `VIRTUAL_TIME_SHIM`, and we want
  // those matches to remain stable.
  const seededRandomBlock = seedRandomFromFrame
    ? String.raw`
  // Seeded Math.random / crypto.getRandomValues, keyed by virtual time.
  // Mulberry32 — single uint32 state, deterministic, fast.
  var rngState = 0;
  function mulberry32() {
    rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
    var t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function reseedRngFromTime(ms) {
    var ms32 = Math.max(0, Math.floor(Number(ms) || 0)) | 0;
    // Knuth's multiplicative hash + golden-ratio offset — gives a well-
    // distributed seed even for frame 0 (otherwise rngState=0 degenerates
    // the PRNG's first few outputs).
    rngState = (Math.imul(ms32, -1640531527) + 0x9E3779B9) | 0;
  }
  reseedRngFromTime(0);
  try {
    Math.random = function() { return mulberry32(); };
  } catch (e) {}
  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    try {
      var __seededGetRandomValues = function(arr) {
        if (!arr || typeof arr.byteLength !== "number" || !arr.buffer) return arr;
        var byteLen = arr.byteLength;
        if (byteLen <= 0) return arr;
        var view = new DataView(arr.buffer, arr.byteOffset, byteLen);
        var i = 0;
        for (; i + 4 <= byteLen; i += 4) {
          var word = ((mulberry32() * 4294967296) >>> 0);
          view.setUint32(i, word, true);
        }
        for (; i < byteLen; i++) {
          view.setUint8(i, (mulberry32() * 256) | 0);
        }
        return arr;
      };
      window.crypto.getRandomValues = __seededGetRandomValues;
    } catch (e) {}
  }
`
    : "";
  // The seekToTime hook reseeds when seeding is on; under seedRandomFromFrame=false
  // we emit no extra call so the function body is byte-identical to the
  // unseeded shim.
  const seekToTimeReseedCall = seedRandomFromFrame ? "reseedRngFromTime(safeTimeMs);\n      " : "";
  return String.raw`(function() {
  if (window.__HF_VIRTUAL_TIME__) return;

  var virtualNowMs = 0;
  var rafId = 1;
  var rafQueue = [];
  var OriginalDate = Date;
  var originalSetTimeout = window.setTimeout.bind(window);
  var originalClearTimeout = window.clearTimeout.bind(window);
  var originalSetInterval = window.setInterval.bind(window);
  var originalClearInterval = window.clearInterval.bind(window);
  var originalRequestAnimationFrame = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : null;
  var originalCancelAnimationFrame = window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : null;
${seededRandomBlock}
  function flushAnimationFrame() {
    if (!rafQueue.length) return;
    var current = rafQueue.slice();
    rafQueue.length = 0;
    for (var i = 0; i < current.length; i++) {
      var entry = current[i];
      if (entry.cancelled) continue;
      try {
        entry.callback(virtualNowMs);
      } catch {}
    }
  }

  function VirtualDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof VirtualDate)) {
      return OriginalDate.apply(null, args.length ? args : [virtualNowMs]);
    }
    var instance = args.length ? new (Function.prototype.bind.apply(OriginalDate, [null].concat(args)))() : new OriginalDate(virtualNowMs);
    Object.setPrototypeOf(instance, VirtualDate.prototype);
    return instance;
  }

  VirtualDate.prototype = OriginalDate.prototype;
  Object.setPrototypeOf(VirtualDate, OriginalDate);
  VirtualDate.now = function() { return virtualNowMs; };
  VirtualDate.parse = OriginalDate.parse.bind(OriginalDate);
  VirtualDate.UTC = OriginalDate.UTC.bind(OriginalDate);

  try {
    Object.defineProperty(window, "Date", {
      configurable: true,
      writable: true,
      value: VirtualDate,
    });
  } catch {}

  if (window.performance && typeof window.performance.now === "function") {
    try {
      Object.defineProperty(window.performance, "now", {
        configurable: true,
        value: function() { return virtualNowMs; },
      });
    } catch {}
  }

  window.requestAnimationFrame = function(callback) {
    if (typeof callback !== "function") return 0;
    var entry = { id: rafId++, callback: callback, cancelled: false };
    rafQueue.push(entry);
    return entry.id;
  };
  window.cancelAnimationFrame = function(id) {
    for (var i = 0; i < rafQueue.length; i++) {
      if (rafQueue[i].id === id) {
        rafQueue[i].cancelled = true;
      }
    }
  };

  window.__HF_VIRTUAL_TIME__ = {
    originalSetTimeout: originalSetTimeout,
    originalClearTimeout: originalClearTimeout,
    originalSetInterval: originalSetInterval,
    originalClearInterval: originalClearInterval,
    originalRequestAnimationFrame: originalRequestAnimationFrame,
    originalCancelAnimationFrame: originalCancelAnimationFrame,
    seekToTime: function(nextTimeMs) {
      var safeTimeMs = Math.max(0, Number(nextTimeMs) || 0);
      virtualNowMs = safeTimeMs;
      ${seekToTimeReseedCall}flushAnimationFrame();
      return virtualNowMs;
    },
    getTime: function() {
      return virtualNowMs;
    },
  };
})();`;
}

/**
 * Default in-process virtual-time shim — `seedRandomFromFrame: false`.
 * Existing call sites (`renderOrchestrator`, `probeStage`) import this
 * constant. Distributed callers build their own with seeding enabled.
 */
const VIRTUAL_TIME_SHIM = buildVirtualTimeShim({ seedRandomFromFrame: false });

/**
 * Render mode extension -- adds renderSeek() for frame-accurate seeking
 * without media sync (videos are replaced with frame images during render).
 */
const RENDER_SEEK_MODE =
  process.env.PRODUCER_RUNTIME_RENDER_SEEK_MODE === "strict-boundary"
    ? "strict-boundary"
    : "preview-phase";
const RENDER_SEEK_DIAGNOSTICS = process.env.PRODUCER_DEBUG_SEEK_DIAGNOSTICS === "true";
const RENDER_SEEK_STEP = Math.max(
  1 / 600,
  Number(process.env.PRODUCER_RENDER_SEEK_STEP || 1 / 120),
);
const RENDER_SEEK_OFFSET_FRACTION = Math.max(
  0,
  Math.min(0.95, Number(process.env.PRODUCER_RUNTIME_RENDER_SEEK_OFFSET_FRACTION || 0.5)),
);

function resolveRenderFpsConfig(fps: Fps | undefined): {
  value: number;
  source: "render-options" | "default";
  fallbackReason?: "missing" | "invalid";
} {
  if (!fps) return { value: 30, source: "default", fallbackReason: "missing" };
  const value = fpsToNumber(fps);
  if (!Number.isFinite(value) || value <= 0) {
    return { value: 30, source: "default", fallbackReason: "invalid" };
  }
  return { value, source: "render-options" };
}

function buildRenderModeScript(fps: Fps | undefined): string {
  const renderFps = resolveRenderFpsConfig(fps);
  return `(function() {
  var __realSetTimeout =
    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalSetTimeout === "function"
      ? window.__HF_VIRTUAL_TIME__.originalSetTimeout
      : window.setTimeout.bind(window);
  var __seekMode = ${JSON.stringify(RENDER_SEEK_MODE)};
  var __seekDiagnostics = ${RENDER_SEEK_DIAGNOSTICS ? "true" : "false"};
  var __seekStep = ${RENDER_SEEK_STEP};
  var __seekOffsetFraction = ${RENDER_SEEK_OFFSET_FRACTION};
  var __renderFps = ${renderFps.value};
  var __renderFpsSource = ${JSON.stringify(renderFps.source)};
  var __renderFpsFallbackReason = ${JSON.stringify(renderFps.fallbackReason ?? null)};
  window.__HF_EXPORT_RENDER_SEEK_CONFIG = {
    mode: __seekMode,
    diagnostics: __seekDiagnostics,
    step: __seekStep,
    offsetFraction: __seekOffsetFraction,
    fps: __renderFps,
    fpsSource: __renderFpsSource,
    fpsFallbackReason: __renderFpsFallbackReason || undefined,
    owner: "runtime",
  };
  function installMediaFallbackPlayer() {
    if (document.querySelector('[data-composition-id]')) return false;
    var mediaEls = Array.from(document.querySelectorAll('video, audio'));
    if (!mediaEls.length) return false;

    var isPlaying = false;
    var currentTime = 0;
    function fallbackDuration() {
      var maxDuration = 0;
      for (var i = 0; i < mediaEls.length; i++) {
        var d = Number(mediaEls[i].duration);
        if (isFinite(d) && d > maxDuration) maxDuration = d;
      }
      return Math.max(0, maxDuration);
    }
    function syncFallbackMedia(time, playing) {
      for (var i = 0; i < mediaEls.length; i++) {
        var media = mediaEls[i];
        var existing = Number(media.currentTime) || 0;
        if (Math.abs(existing - time) > 0.3) {
          try { media.currentTime = time; } catch (e) {}
        }
        if (playing) {
          if (media.paused) {
            media.play().catch(function() {});
          }
        } else if (!media.paused) {
          media.pause();
        }
      }
    }

    var basePlayer = window.__player && typeof window.__player === 'object' ? window.__player : {};
    window.__player = {
      ...basePlayer,
      _timeline: null,
      play: function() {
        isPlaying = true;
        syncFallbackMedia(currentTime, true);
      },
      pause: function() {
        isPlaying = false;
        syncFallbackMedia(currentTime, false);
      },
      seek: function(time) {
        var safeTime = Math.max(0, Number(time) || 0);
        currentTime = safeTime;
        isPlaying = false;
        syncFallbackMedia(safeTime, false);
      },
      renderSeek: function(time) {
        var safeTime = Math.max(0, Number(time) || 0);
        currentTime = safeTime;
        isPlaying = false;
        syncFallbackMedia(safeTime, false);
      },
      getTime: function() {
        var primary = mediaEls[0];
        if (!primary) return currentTime;
        var t = Number(primary.currentTime);
        return isFinite(t) ? t : currentTime;
      },
      getDuration: function() {
        return fallbackDuration();
      },
      isPlaying: function() {
        return isPlaying;
      },
    };
    window.__playerReady = true;
    // Media-fallback player has no timeline to bind, so render-ready is immediate.
    // init.ts defers __renderReady until the timeline is bound — different runtime.
    window.__renderReady = true;
    return true;
  }

  function waitForPlayer() {
    var hasComposition = Boolean(document.querySelector('[data-composition-id]'));
    if (hasComposition) {
      if (window.__player && typeof window.__player.renderSeek === "function") {
        window.__playerReady = true;
        return;
      }
      __realSetTimeout(waitForPlayer, 50);
      return;
    }
    if (installMediaFallbackPlayer()) {
      return;
    }
    __realSetTimeout(waitForPlayer, 50);
  }
  waitForPlayer();
})();`;
}

/**
 * Early stub: ensures `window.__hf` exists *before* any user `<script>` in
 * `<body>` executes, and batches GSAP timeline construction via
 * requestAnimationFrame to prevent the main-thread hang described in
 * https://github.com/heygen-com/hyperframes/issues/1231.
 *
 * Source: packages/producer/stubs/hf-early-stub.ts
 * Generated: packages/producer/src/generated/hf-early-stub-inline.ts
 * Injected at the very start of `<head>` so it runs before all other scripts.
 */
const HF_EARLY_STUB = getHfEarlyStub();

/**
 * Page-side compositing opt-in flag stub.
 *
 * When the engine is launched with `enablePageSideCompositing: true`, the
 * orchestrator injects this stub into the very top of every served HTML
 * page. The flag is read by `@hyperframes/shader-transitions`' engine-mode
 * `init()` to switch from the default opacity-flip mode (which leaves
 * shader blending to the Node side via the hf#677 layered pipeline) to a
 * page-side WebGL compositor that runs the shader inside Chrome and
 * exposes a single opaque RGB frame for the engine to capture.
 *
 * Sentinel ONLY — no logic here. The compositor itself ships inside
 * `@hyperframes/shader-transitions` and is loaded by the composition's
 * regular script bundle.
 *
 * Default OFF: when the flag is not set, behavior is byte-identical to
 * the existing layered path.
 */
export const HF_PAGE_SIDE_COMPOSITING_STUB = `(function() {
  if (typeof window === "undefined") return;
  window.__HF_PAGE_SIDE_COMPOSITING__ = true;
})();`;

/**
 * Bridge script: maps window.__player (Hyperframe runtime) → window.__hf (engine protocol).
 * Injected after RENDER_MODE_SCRIPT so the engine's frameCapture can find window.__hf.
 *
 * This script *patches* the existing __hf object rather than replacing it, so
 * fields written during page-script execution (e.g. transitions metadata from
 * @hyperframes/shader-transitions) are preserved through to engine query time.
 */
const HF_BRIDGE_SCRIPT = `(function() {
  var __realSetInterval =
    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalSetInterval === "function"
      ? window.__HF_VIRTUAL_TIME__.originalSetInterval
      : window.setInterval.bind(window);
  var __realClearInterval =
    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalClearInterval === "function"
      ? window.__HF_VIRTUAL_TIME__.originalClearInterval
      : window.clearInterval.bind(window);
  function getDeclaredDuration() {
    var root = document.querySelector('[data-composition-id]');
    if (!root) return 0;
    var d = Number(root.getAttribute('data-duration'));
    if (Number.isFinite(d) && d > 0) return d;
    var comps = document.querySelectorAll('[data-composition-src]');
    var maxEnd = 0;
    for (var i = 0; i < comps.length; i++) {
      var start = Number(comps[i].getAttribute('data-start')) || 0;
      var dur = Number(comps[i].getAttribute('data-duration')) || 0;
      if (dur > 0) maxEnd = Math.max(maxEnd, start + dur);
    }
    if (maxEnd > 0) console.warn('[HF Bridge] No root data-duration; derived ' + maxEnd + 's from sub-compositions');
    return maxEnd;
  }
  function seekSameOriginChildFrames(frameWindow, nextTimeMs) {
    var frames;
    try {
      frames = frameWindow.frames;
    } catch (_error) {
      return;
    }
    if (!frames || typeof frames.length !== "number") return;
    for (var i = 0; i < frames.length; i++) {
      var childWindow = null;
      try {
        childWindow = frames[i];
        if (!childWindow || childWindow === frameWindow) continue;
        if (
          childWindow.__HF_VIRTUAL_TIME__ &&
          typeof childWindow.__HF_VIRTUAL_TIME__.seekToTime === "function"
        ) {
          childWindow.__HF_VIRTUAL_TIME__.seekToTime(nextTimeMs);
        }
      } catch (_error) {
        continue;
      }
      seekSameOriginChildFrames(childWindow, nextTimeMs);
    }
  }
  function bridge() {
    var p = window.__player;
    if (!p || typeof p.renderSeek !== "function" || typeof p.getDuration !== "function") {
      return false;
    }
    var hf = window.__hf || {};
    Object.defineProperty(hf, "duration", {
      configurable: true,
      enumerable: true,
      get: function() {
        // While the GSAP tween-batching interceptor (HF_EARLY_STUB) is draining
        // queued tweens via rAF, the real timelines are still empty. Return 0
        // here so pollHfReady in the engine keeps waiting (its condition is
        // __hf.duration > 0), preventing the capture pipeline from seeking
        // empty timelines and producing blank/incorrect frames.
        if (window.__hfTimelinesBuilding) return 0;
        if (!window.__renderReady) return 0;
        var d = p.getDuration();
        return d > 0 ? d : getDeclaredDuration();
      },
    });
    hf.seek = function(t, options) {
      p.renderSeek(t, options);
      var nextTimeMs = (Math.max(0, Number(t) || 0)) * 1000;
      if (window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.seekToTime === "function") {
        window.__HF_VIRTUAL_TIME__.seekToTime(nextTimeMs);
      }
      seekSameOriginChildFrames(window, nextTimeMs);
    };
    window.__hf = hf;
    return true;
  }
  if (bridge()) return;
  var iv = __realSetInterval(function() {
    if (bridge()) __realClearInterval(iv);
  }, 50);
})();`;

export interface FileServerOptions {
  projectDir: string;
  compiledDir?: string;
  port?: number;
  /** Scripts injected into <head> of every served HTML file before authored scripts. */
  preHeadScripts?: string[];
  /** Scripts injected into <head> of index.html. Default: verified Hyperframe runtime. */
  headScripts?: string[];
  /** Scripts injected before </body> of index.html. Default: render mode extension. */
  bodyScripts?: string[];
  /** Actual render fps so page-side runtime quantization matches the output container. */
  fps?: Fps;
  /** Strip embedded runtime scripts from HTML before injection. Default: true. */
  stripEmbeddedRuntime?: boolean;
}

export interface FileServerHandle {
  url: string;
  port: number;
  close: () => void;
  addPreHeadScript: (script: string) => void;
}

/**
 * Close a file server handle, swallowing and logging any error.
 *
 * `FileServerHandle.close` tears down the underlying http.Server, whose
 * `close()` throws `ERR_SERVER_NOT_RUNNING` if the server is already torn down
 * (for example a cancellation path that closed it once already). An unguarded
 * throw inside a cleanup or `finally` block would mask the original render or
 * plan result, so cleanup callers must go through this instead of calling
 * `close()` directly.
 */
export function closeFileServerSafely(
  fileServer: Pick<FileServerHandle, "close">,
  label: string,
  log: ProducerLogger = defaultLogger,
): void {
  try {
    fileServer.close();
  } catch (err) {
    log.warn(`[${label}] file server close failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const { projectDir, compiledDir, port = 0, stripEmbeddedRuntime = true } = options;

  // HF_EARLY_STUB must run before *any* page script so libraries that write
  // to window.__hf during page-script execution (e.g. shader-transitions
  // populating __hf.transitions) find it already defined. The full bridge in
  // bodyScripts later upgrades this stub with `seek` / `duration` once the
  // Hyperframe runtime's __player is ready, while preserving any fields
  // already written.
  const preHeadScripts = [HF_EARLY_STUB, ...(options.preHeadScripts ?? [])];
  // Default scripts: Hyperframe runtime in <head>, render mode in </body>
  const headScripts = options.headScripts ?? [getVerifiedHyperframeRuntimeSource()];
  const bodyScripts = options.bodyScripts ?? [buildRenderModeScript(options.fps), HF_BRIDGE_SCRIPT];

  const app = new Hono();

  app.get("/*", async (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    const relativePath = requestPath
      .replace(/^\//, "")
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .join("/");

    // Resolve against compiledDir first (preferred — overrides project files
    // for compositions emitted by the build), then projectDir as fallback.
    // Each candidate is rejected if `..` segments push it outside the
    // intended root: `path.join` normalizes traversal but does not enforce
    // containment, so a request like `GET /../etc/passwd` would otherwise
    // be served straight off the filesystem. Keep this lexical so project
    // symlinks to sibling asset directories behave like preview mode.
    let filePath: string | null = null;
    if (compiledDir) {
      const candidate = join(compiledDir, relativePath);
      if (
        existsSync(candidate) &&
        isPathInside(candidate, compiledDir) &&
        statSync(candidate).isFile()
      ) {
        filePath = candidate;
      }
    }
    if (!filePath) {
      const candidate = join(projectDir, relativePath);
      if (
        existsSync(candidate) &&
        isPathInside(candidate, projectDir) &&
        statSync(candidate).isFile()
      ) {
        filePath = candidate;
      }
    }

    if (!filePath) {
      if (!/favicon\.ico$/i.test(requestPath)) {
        console.warn(`[FileServer] 404 Not Found: ${requestPath}`);
      }
      return c.text("Not found", 404);
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      // Use the async read here so we don't block the Node event loop while
      // reading an HTML file (typically small, but a 200KB+ AI-generated
      // composition during a concurrent render still costs a ms of stall).
      // The injection step is sync — it's pure string ops on the buffered
      // HTML — but the read itself is the only step that touches the disk.
      const rawHtml = await readFile(filePath, "utf-8");
      const isIndex = relativePath === "index.html";
      let html = rawHtml;
      if (preHeadScripts.length > 0) {
        html = injectScriptsAtHeadStart(html, preHeadScripts);
      }
      html = isIndex
        ? injectScriptsIntoHtml(html, headScripts, bodyScripts, stripEmbeddedRuntime)
        : html;
      return c.text(html, 200, { "Content-Type": contentType });
    }

    // Stream binary file content rather than buffering it with readFileSync.
    // On video-heavy compositions Chrome requests several 32MB video files
    // back-to-back through this server; each readFileSync(32MB) blocked the
    // Node event loop long enough to wedge concurrent /health responses (see
    // renderOrchestrator.ts:1277-1306 documenting the same regression class).
    // createReadStream() pipes bounded chunks asynchronously, so the event
    // loop stays responsive even when several large assets are in flight
    // simultaneously. Chrome reassembles the chunks transparently.
    //
    // We also honor `Range:` requests (RFC 7233) so Chrome's <video> element
    // can seek into and partial-load large media without re-pulling the whole
    // file. `Accept-Ranges: bytes` is advertised on every response (including
    // full-body 200s) so the client knows ranges are supported.
    const stat = statSync(filePath);
    const totalSize = stat.size;
    const rangeHeader = c.req.header("range");
    const rangeRequest = parseRangeHeader(rangeHeader, totalSize);

    if (rangeRequest.kind === "unsatisfiable") {
      // 416 Range Not Satisfiable. RFC 7233 §4.4 mandates `Content-Range`
      // carry the total length as `bytes */<size>` so clients know how to
      // re-issue a valid range.
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes */${totalSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    if (rangeRequest.kind === "satisfiable") {
      const { start, end } = rangeRequest;
      const length = end - start + 1;
      const stream = createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    // No Range header (or malformed/multi-range): full-body 200 with
    // Accept-Ranges advertised so the client knows future Range requests
    // are supported. Node Readable -> Web ReadableStream so Hono's
    // Response can consume it. Node 18+ supports Readable.toWeb directly.
    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(totalSize),
        "Accept-Ranges": "bytes",
      },
    });
  });

  return new Promise((resolve) => {
    // Track open connections so we can force-destroy them on close.
    // Without this, server.close() waits for keep-alive connections to
    // drain, holding the Node.js event loop open indefinitely.
    const connections = new Set<IncomingMessage["socket"]>();

    // @hono/node-server serve() returns the http.Server directly.
    // Register the connection tracker before the listen callback fires
    // to avoid missing early connections.
    // Bind loopback only (SECURITY F-001, matching the studio/preview servers
    // in cli/server/portUtils.ts): this is an internal capture transport for
    // the co-located headless Chrome (the URL above is already localhost), so
    // it must not listen on 0.0.0.0 where an IDE's port auto-forward surfaces
    // it as a transient, breakage-prone "preview".
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        port: info.port,
        addPreHeadScript: (script: string) => {
          preHeadScripts.push(script);
        },
        close: () => {
          for (const socket of connections) socket.destroy();
          connections.clear();
          server.close();
        },
      });
    });

    server.on("connection", (socket: IncomingMessage["socket"]) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
    });
  });
}

export { HF_BRIDGE_SCRIPT, HF_EARLY_STUB, VIRTUAL_TIME_SHIM };
