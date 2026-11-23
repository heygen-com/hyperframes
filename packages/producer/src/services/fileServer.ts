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
import { answerOwnLoopbackHostOnly, settleOnBrowserSafePort } from "@hyperframes/engine";
import type { IncomingMessage } from "node:http";
import {
  existsSync,
  realpathSync,
  statSync,
  createReadStream,
  openSync,
  fstatSync,
  closeSync,
  constants,
  readFile,
} from "node:fs";
import { promisify } from "node:util";

import { Readable } from "node:stream";
import { join, extname, resolve, sep } from "node:path";
import { injectScriptsAtHeadStart, injectScriptsIntoHtml } from "@hyperframes/core/compiler";
import { injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import {
  PREVIEW_FOR_ANOTHER_SITE_META,
  serviceWorkerScriptFetch,
} from "@hyperframes/core/studio-preview-mark";
import { fpsToNumber, type Fps, terminalText } from "@hyperframes/core";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { stripSdrPngColourTags } from "@hyperframes/core/compiler/png-colour-tags";
import { openRangeEnd } from "@hyperframes/studio-server/media-range";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";
import { servedPath } from "./servedPath.js";
import { getHfEarlyStub } from "../generated/hf-early-stub-inline.js";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { refusesOutsideLink } from "../utils/paths.js";

const readFileAsync = promisify(readFile);

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
  ".mjs": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".cube": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/vnd.microsoft.icon",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
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
 *   - `bytes=start-`: open-ended, from start to EOF (audio/video: see `openRangeEnd`).
 *   - `bytes=-SUFFIX`: last SUFFIX bytes.
 *
 * Multi-range requests (`bytes=0-99,200-299`) are treated as `absent`. The
 * caller serves the full body with 200. The hyperframes producer's use case
 * (Chrome `<video>` seeks, range-aware media stack) only ever issues single
 * ranges, so we don't take on the multipart-byteranges complexity here.
 *
 * Exported for unit tests; not part of the public package surface.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
  contentType = "application/octet-stream",
): RangeRequest {
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

  // Open-ended form: `bytes=start-` returns from start to EOF, or one bounded piece of audio/video.
  if (rawEnd === "") {
    if (start >= size) return { kind: "unsatisfiable" };
    return { kind: "satisfiable", start, end: openRangeEnd(start, size - 1, contentType) };
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
 * Page-side virtual-time shim, installed before page scripts on every render path.
 * Holds Date.now, performance.now, rAF and later timers at the seek time, and seeds Math.random and
 * crypto.getRandomValues from it, so a re-render repeats. Draws at page load or inside a frame also match
 * across worker counts; a value resolved on a tween's first render depends on the frame a worker reaches first.
 */
const VIRTUAL_TIME_SHIM = String.raw`(function() {
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

  // Seeded Math.random / crypto.getRandomValues, keyed by virtual time.
  // Mulberry32: single uint32 state, deterministic, fast.
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
    // Knuth's multiplicative hash + golden-ratio offset gives a well-
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

  // Timers set once rendering has started run on film time: each seek fires every timer due by then, in
  // due order. Until a seek after the page reports ready, timers keep the wall clock: setup code waits on
  // them while the renderer may already be seeking.
  var rendering = false;
  var timerQueue = [];
  var nextTimerId = 1000000000;
  var firingDepth = 0;
  function addTimer(callback, delay, args, repeats) {
    // A timer set from a firing timer waits at least 1 ms, so a zero-delay chain cannot stall a seek.
    var ms = Math.max(firingDepth > 0 ? 1 : 0, Number(delay) || 0);
    var entry = { id: nextTimerId++, callback: callback, args: args, due: virtualNowMs + ms, every: repeats ? Math.max(1, ms) : 0, cancelled: false };
    timerQueue.push(entry);
    return entry.id;
  }
  function cancelTimer(id) {
    for (var i = 0; i < timerQueue.length; i++) {
      if (timerQueue[i].id === id) {
        timerQueue[i].cancelled = true;
        return true;
      }
    }
    return false;
  }
  function fireDueTimers(untilMs) {
    // Frame times are fractional, so a timer due on a frame lands a rounding error past it; it still fires on it.
    untilMs += 0.000001;
    while (true) {
      var next = null;
      for (var i = 0; i < timerQueue.length; i++) {
        var candidate = timerQueue[i];
        if (!candidate.cancelled && candidate.due <= untilMs && (next === null || candidate.due < next.due)) next = candidate;
      }
      if (next === null) break;
      var dueMs = next.due;
      if (next.every) next.due += next.every;
      else next.cancelled = true;
      virtualNowMs = dueMs;
      firingDepth++;
      try {
        next.callback.apply(window, next.args);
      } catch (err) {
        originalSetTimeout(function() { throw err; }, 0);
      }
      firingDepth--;
    }
    timerQueue = timerQueue.filter(function(entry) { return !entry.cancelled; });
  }
  window.setTimeout = function(callback, delay) {
    if (!rendering || typeof callback !== "function") return originalSetTimeout.apply(null, arguments);
    return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), false);
  };
  window.setInterval = function(callback, delay) {
    if (!rendering || typeof callback !== "function") return originalSetInterval.apply(null, arguments);
    return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), true);
  };
  window.clearTimeout = function(id) {
    if (!cancelTimer(id)) originalClearTimeout(id);
  };
  window.clearInterval = function(id) {
    if (!cancelTimer(id)) originalClearInterval(id);
  };

  function seekToTime(nextTimeMs) {
    var safeTimeMs = Math.max(0, Number(nextTimeMs) || 0);
    if (!rendering && window.__renderReady === true) {
      rendering = true;
      // A worker whose first frame is past the start plays the film's first frame first, so timers the
      // page starts there keep the schedule a one-worker render gives them.
      if (safeTimeMs > 0) seekToTime(0);
    }
    reseedRngFromTime(safeTimeMs);
    fireDueTimers(safeTimeMs);
    virtualNowMs = safeTimeMs;
    flushAnimationFrame();
    return virtualNowMs;
  }

  window.__HF_VIRTUAL_TIME__ = {
    originalSetTimeout: originalSetTimeout,
    originalClearTimeout: originalClearTimeout,
    originalSetInterval: originalSetInterval,
    originalClearInterval: originalClearInterval,
    originalRequestAnimationFrame: originalRequestAnimationFrame,
    originalCancelAnimationFrame: originalCancelAnimationFrame,
    seekToTime: seekToTime,
    getTime: function() {
      return virtualNowMs;
    },
  };
})();`;

// ── HDR passthrough callback record ─────────────────────────────────────────
// What page code has asked to run on seeks, for a caller that must know whether a frame depends on the
// seeks before it and not on its time alone (the HDR passthrough reuses one capture across frames it
// seeks out of order; `hdrPassthrough/eligibility.ts` reads it). Only renders with the passthrough on
// get it (`virtualTimeShimFor`): every other page is served `VIRTUAL_TIME_SHIM` exactly.
//
// It is spliced into the shim at four anchors rather than written into it, so the shim stays one text
// that renders with the flag off read unchanged. The record must be invisible to the page: a page that
// falls back to the layered path must render exactly as it would with the flag off. So it calls nothing
// the page can replace or observe. Every intrinsic it uses is captured when the shim runs, before any
// page script, and called through saved references; it reads stacks with the page's stack hooks set
// aside, and parses them without regular expressions (which update `RegExp.$1` and friends). A caller
// it cannot classify counts as page code.
//
// Distinct animation-frame callbacks are kept up to a cap; film-time timers and string timers are
// counted, as are observers whose callback runs no page script and custom element definitions. A
// registration from the renderer's own code (a `hyperframes://injected/<n>` script the file server
// adds, the compiler's `hyperframes://position-seek-reapply`, a `pptr:` DevTools evaluation) is kept
// apart; the page code watch declines any page script that takes one of those names
// (`RENDERER_SCRIPT_NAMES` in `hdrPassthrough/scriptOrigins.ts`), so the name is the renderer's.
const CALLBACK_RECORD_STATE = String.raw`
  var CALLBACKS_KEPT = 32;
  var frameCallbacks = [];
  var rendererFrameCallbacks = [];
  var frameCallbacksOverflow = false;
  var filmTimers = 0;
  var stringTimers = 0;
  var recordUncurry = Function.prototype.bind.bind(Function.prototype.call);
  var recordIndexOf = recordUncurry(String.prototype.indexOf);
  var recordLastIndexOf = recordUncurry(String.prototype.lastIndexOf);
  var recordSlice = recordUncurry(String.prototype.slice);
  var recordHasOwn = recordUncurry(Object.prototype.hasOwnProperty);
  var recordDefine = Object.defineProperty;
  var recordDescriptor = Object.getOwnPropertyDescriptor;
  var RecordError = Error;
  var STACK_HOOKS = ["prepareStackTrace", "stackTraceLimit"];
  // Frames: readStackAside, calledByPage, the shim's wrapper, the wrapper's caller, one to spare.
  var STACK_FRAMES = 5;
  var RENDERER_SCRIPTS = ["hyperframes://injected/", "hyperframes://position-seek-reapply", "pptr:"];
  // Property descriptors have no prototype: defineProperty reads "get" and "set" through it.
  function recordAdd(list, value) {
    recordDefine(list, list.length, { __proto__: null, value: value, writable: true, enumerable: true, configurable: true });
  }
  // A descriptor as getOwnPropertyDescriptor returned it, rebuilt without a prototype.
  function recordOwnDescriptor(found) {
    if (recordHasOwn(found, "get") || recordHasOwn(found, "set")) {
      return { __proto__: null, get: found.get, set: found.set, enumerable: found.enumerable, configurable: found.configurable };
    }
    return { __proto__: null, value: found.value, writable: found.writable, enumerable: found.enumerable, configurable: found.configurable };
  }
  function recordHas(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
    return false;
  }
  function recordCopy(list) {
    var copy = [];
    for (var i = 0; i < list.length; i++) recordAdd(copy, list[i]);
    return copy;
  }
  // The caller's stack, read without running the page's stack hooks: both are set aside as own data
  // properties of the realm's Error and put back as they were. Null when a hook cannot be set aside.
  function readStackAside() {
    var saved = [];
    for (var i = 0; i < STACK_HOOKS.length; i++) {
      var found = recordDescriptor(RecordError, STACK_HOOKS[i]);
      if (found && !found.configurable) return null;
      recordAdd(saved, found ? recordOwnDescriptor(found) : undefined);
    }
    try {
      recordDefine(RecordError, "prepareStackTrace", { __proto__: null, value: undefined, writable: true, configurable: true });
      recordDefine(RecordError, "stackTraceLimit", { __proto__: null, value: STACK_FRAMES, writable: true, configurable: true });
      var stack = new RecordError().stack;
      return typeof stack === "string" ? stack : null;
    } catch (err) {
      return null;
    } finally {
      for (var j = 0; j < STACK_HOOKS.length; j++) {
        if (saved[j]) recordDefine(RecordError, STACK_HOOKS[j], saved[j]);
        else delete RecordError[STACK_HOOKS[j]];
      }
    }
  }
  // Line n of a stack (0 is the message), or null.
  function stackLine(stack, n) {
    var start = 0;
    for (var i = 0; i < n; i++) {
      var next = recordIndexOf(stack, "\n", start);
      if (next < 0) return null;
      start = next + 1;
    }
    var end = recordIndexOf(stack, "\n", start);
    return end < 0 ? recordSlice(stack, start) : recordSlice(stack, start, end);
  }
  // A frame's location: what is inside a frame's last parentheses, or after "at ". An eval frame's
  // location names the evaluated code ("eval at f (...), <anonymous>:1:1"), never the renderer's.
  function frameLocation(line) {
    if (line.length > 0 && line[line.length - 1] === ")") {
      var open = recordLastIndexOf(line, " (");
      return open < 0 ? null : recordSlice(line, open + 2, line.length - 1);
    }
    var at = recordIndexOf(line, "at ");
    return at < 0 ? null : recordSlice(line, at + 3);
  }
  function isRendererLocation(location) {
    if (recordIndexOf(location, " ") >= 0 || recordIndexOf(location, "(") >= 0 || recordIndexOf(location, ")") >= 0) return false;
    for (var i = 0; i < RENDERER_SCRIPTS.length; i++) {
      if (recordIndexOf(location, RENDERER_SCRIPTS[i]) === 0) return true;
    }
    return false;
  }
  // Whether the code that called the shim's wrapper is the page's. Call from the wrapper itself: the
  // stack's first line is the message, then readStackAside, this function, the wrapper and its caller.
  function calledByPage() {
    var stack = readStackAside();
    var caller = stack === null ? null : stackLine(stack, 4);
    var location = caller === null ? null : frameLocation(caller);
    return location === null || !isRendererLocation(location);
  }
  function noteFrameCallback(callback, byPage) {
    var list = byPage ? frameCallbacks : rendererFrameCallbacks;
    if (list.length < CALLBACKS_KEPT) recordAdd(list, callback);
    else if (byPage) frameCallbacksOverflow = true;
  }
  // Observer callbacks and custom element reactions run from the browser, on the seeks that mutate,
  // resize or move what they watch. V8's call counts see a page function that runs there, but not a
  // builtin, a bound function, a callable Proxy or a WebAssembly export, which run no page script:
  // so an observer whose callback is one of those is counted here, as is every custom element
  // definition (the registry keeps the lifecycle callbacks it read at define time, which nothing can
  // read back). The constructors are wrapped in Proxies of themselves, which forward everything else.
  var RecordProxy = Proxy;
  var recordConstruct = Reflect.construct;
  var recordApply = Reflect.apply;
  var recordFunctionText = recordUncurry(Function.prototype.toString);
  var NATIVE_CODE = "{ [native code] }";
  var OBSERVERS = ["MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver", "ReportingObserver"];
  var OBSERVER_ALIASES = ["WebKitMutationObserver"];
  var nativeObservers = 0;
  var nativeObserverKinds = [];
  var customElementDefinitions = 0;
  // Whether calling callback runs no page script: a function's source never ends like native code's.
  function isNativeCallback(callback) {
    var text;
    try {
      text = recordFunctionText(callback);
    } catch (err) {
      return true;
    }
    return text.length >= NATIVE_CODE.length && recordSlice(text, text.length - NATIVE_CODE.length) === NATIVE_CODE;
  }
  // Replaces owner[name] when it is a data property holding original, keeping its attributes.
  function recordReplace(owner, name, original, replacement) {
    var found = owner ? recordDescriptor(owner, name) : undefined;
    if (!found || !recordHasOwn(found, "value") || found.value !== original || !found.configurable) return;
    recordDefine(owner, name, { __proto__: null, value: replacement, writable: found.writable, enumerable: found.enumerable, configurable: true });
  }
  function recordWrapObserver(name) {
    var found = recordDescriptor(window, name);
    var original = found && recordHasOwn(found, "value") ? found.value : undefined;
    if (typeof original !== "function") return;
    var wrapped = new RecordProxy(original, {
      __proto__: null,
      construct: function(target, args, newTarget) {
        if (args.length === 0 || isNativeCallback(args[0])) {
          nativeObservers++;
          if (nativeObserverKinds.length < CALLBACKS_KEPT) recordAdd(nativeObserverKinds, name);
        }
        return recordConstruct(target, args, newTarget);
      },
    });
    recordReplace(window, name, original, wrapped);
    var prototype = recordDescriptor(original, "prototype");
    if (prototype && recordHasOwn(prototype, "value")) recordReplace(prototype.value, "constructor", original, wrapped);
    for (var i = 0; i < OBSERVER_ALIASES.length; i++) recordReplace(window, OBSERVER_ALIASES[i], original, wrapped);
  }
  try {
    for (var recordO = 0; recordO < OBSERVERS.length; recordO++) recordWrapObserver(OBSERVERS[recordO]);
    var recordRegistry = recordDescriptor(window, "CustomElementRegistry");
    var recordRegistryPrototype = recordRegistry && typeof recordRegistry.value === "function" ? recordDescriptor(recordRegistry.value, "prototype") : undefined;
    var recordDefineMethod = recordRegistryPrototype ? recordDescriptor(recordRegistryPrototype.value, "define") : undefined;
    if (recordDefineMethod && typeof recordDefineMethod.value === "function") {
      recordReplace(recordRegistryPrototype.value, "define", recordDefineMethod.value, new RecordProxy(recordDefineMethod.value, {
        __proto__: null,
        apply: function(target, thisArg, args) {
          customElementDefinitions++;
          return recordApply(target, thisArg, args);
        },
      }));
    }
  } catch (err) {
    nativeObservers = -1;
  }
`;

/** Notes a new animation-frame callback; runs right after the wrapper's own callback check. */
const CALLBACK_RECORD_FRAME = String.raw`    if (!recordHas(frameCallbacks, callback) && !recordHas(rendererFrameCallbacks, callback)) {
      noteFrameCallback(callback, calledByPage());
    }
`;

/** Counts a timer; runs first in the setTimeout / setInterval wrappers. */
const CALLBACK_RECORD_TIMER = String.raw`    if (typeof callback !== "function") stringTimers++;
    else if (rendering && calledByPage()) filmTimers++;
`;

/** `__HF_VIRTUAL_TIME__.callbackActivity()`: page-side only (it holds functions). */
const CALLBACK_RECORD_READ = String.raw`    callbackActivity: function() {
      var pendingFrames = [];
      for (var i = 0; i < rafQueue.length; i++) {
        if (!rafQueue[i].cancelled) recordAdd(pendingFrames, rafQueue[i].callback);
      }
      var pendingTimers = 0;
      for (var j = 0; j < timerQueue.length; j++) {
        if (!timerQueue[j].cancelled) pendingTimers++;
      }
      return {
        frameCallbacks: recordCopy(frameCallbacks),
        frameCallbacksOverflow: frameCallbacksOverflow,
        pendingFrames: pendingFrames,
        filmTimers: filmTimers,
        stringTimers: stringTimers,
        pendingTimers: pendingTimers,
        nativeObservers: nativeObservers,
        nativeObserverKinds: recordCopy(nativeObserverKinds),
        customElementDefinitions: customElementDefinitions,
      };
    },
`;

/** Inserts `insert` before (or after) the one occurrence of `anchor` in `source`. */
function spliceAt(
  source: string,
  anchor: string,
  insert: string,
  where: "before" | "after",
): string {
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + 1) >= 0) {
    throw new Error(`virtual-time shim: anchor not found exactly once: ${JSON.stringify(anchor)}`);
  }
  const cut = where === "before" ? at : at + anchor.length;
  return source.slice(0, cut) + insert + source.slice(cut);
}

/** `shim` with the callback record spliced in; throws when an anchor is missing. */
export function withCallbackRecord(shim: string): string {
  let out = spliceAt(
    shim,
    "  window.requestAnimationFrame = function(callback) {\n",
    CALLBACK_RECORD_STATE,
    "before",
  );
  out = spliceAt(
    out,
    '  window.requestAnimationFrame = function(callback) {\n    if (typeof callback !== "function") return 0;\n',
    CALLBACK_RECORD_FRAME,
    "after",
  );
  out = spliceAt(
    out,
    "  window.setTimeout = function(callback, delay) {\n",
    CALLBACK_RECORD_TIMER,
    "after",
  );
  out = spliceAt(
    out,
    "  window.setInterval = function(callback, delay) {\n",
    CALLBACK_RECORD_TIMER,
    "after",
  );
  return spliceAt(
    out,
    "    getTime: function() {\n      return virtualNowMs;\n    },\n",
    CALLBACK_RECORD_READ,
    "after",
  );
}

/** The shim with the callback record, or null when main's shim moved an anchor (the passthrough then declines). */
const VIRTUAL_TIME_SHIM_WITH_CALLBACK_RECORD: string | null = (() => {
  try {
    return withCallbackRecord(VIRTUAL_TIME_SHIM);
  } catch {
    return null;
  }
})();

/**
 * The virtual-time shim for a render's pages. With the HDR passthrough off this is
 * `VIRTUAL_TIME_SHIM` itself, so those renders serve the same page as without the feature;
 * with it on, the shim with the callback record the passthrough's eligibility reads. If the
 * record cannot be spliced in, the plain shim: the passthrough then finds no record and falls
 * back.
 */
export function virtualTimeShimFor(options: { experimentalHdrPassthrough?: boolean }): string {
  if (!options.experimentalHdrPassthrough) return VIRTUAL_TIME_SHIM;
  return VIRTUAL_TIME_SHIM_WITH_CALLBACK_RECORD ?? VIRTUAL_TIME_SHIM;
}

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

export function resolveRenderFpsConfig(fps: Fps | undefined): {
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
    // init.ts defers __renderReady until the timeline is bound (a different runtime).
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
  /** Serve project symlinks that lead outside projectDir, as local preview does. Default: false. */
  allowOutsideProjectAssets?: boolean;
  includeOutsideScripts?: boolean;
}

export interface FileServerHandle {
  url: string;
  port: number;
  close: () => void;
  addPreHeadScript: (script: string) => void;
  /** The text of every script the server injects into index.html, as the page compiles it. */
  injectedScriptTexts: () => string[];
}

/** The contents of each inline `<script>` tag in HTML the injection helpers wrote. */
function inlineScriptTexts(html: string): string[] {
  const texts: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = html.indexOf("<script>", cursor);
    if (open < 0) return texts;
    // Injected sources are escaped so that "</script" never occurs inside them.
    const close = html.indexOf("</script>", open);
    if (close < 0) return texts;
    texts.push(html.slice(open + "<script>".length, close));
    cursor = close + "</script>".length;
  }
}

/**
 * The scripts `createFileServer` injects into index.html, as the page compiles them: what the
 * injection helpers write for each list, read back from an empty document.
 */
function injectedScriptTexts(
  preHeadScripts: readonly string[],
  headScripts: readonly string[],
  bodyScripts: readonly string[],
): string[] {
  const empty = "<!doctype html><html><head></head><body></body></html>";
  return [
    ...inlineScriptTexts(injectScriptsAtHeadStart(empty, preHeadScripts)),
    ...inlineScriptTexts(injectScriptsIntoHtml(empty, headScripts, bodyScripts, false)),
  ];
}

const OFFER_NO_FRAMING_SITE_AN_EDITING_PORT = `<meta name="${PREVIEW_FOR_ANOTHER_SITE_META}">`;

/**
 * Set before the Hyperframes runtime executes so render/probe pages can avoid
 * preview-only initialization work that mutates the live visual timeline.
 * Audio automation is discovered by the producer in an isolated pass and
 * baked before frame capture.
 */
export const RENDER_CAPTURE_MODE_SHIM = "globalThis.__HF_RENDER_CAPTURE_MODE = true;";

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

function openRegularFile(filePath: string) {
  let fd: number;
  try {
    // Reject FIFOs with fstat without waiting for a writer to connect.
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return null;
    // A failed open of a directory/socket has platform-specific errors.
    // Classifying it here never authorizes a later pathname read.
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) return null;
    throw error;
  }
  let accepted = false;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    accepted = true;
    return { fd, stat, filePath };
  } finally {
    if (!accepted) closeSync(fd);
  }
}

export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const {
    projectDir,
    compiledDir,
    port = 0,
    stripEmbeddedRuntime = true,
    allowOutsideProjectAssets = false,
    includeOutsideScripts = false,
  } = options;

  // HF_EARLY_STUB must run before *any* page script so libraries that write
  // to window.__hf during page-script execution (e.g. shader-transitions
  // populating __hf.transitions) find it already defined. The full bridge in
  // bodyScripts later upgrades this stub with `seek` / `duration` once the
  // Hyperframe runtime's __player is ready, while preserving any fields
  // already written.
  const preHeadScripts = [
    HF_EARLY_STUB,
    RENDER_CAPTURE_MODE_SHIM,
    ...(options.preHeadScripts ?? []),
  ];
  // Default scripts: Hyperframe runtime in <head>, render mode in </body>
  const headScripts = options.headScripts ?? [getVerifiedHyperframeRuntimeSource()];
  const bodyScripts = options.bodyScripts ?? [buildRenderModeScript(options.fps), HF_BRIDGE_SCRIPT];

  const app = new Hono();
  const warnLeftOut = (line: string) => console.warn(`[FileServer] ${terminalText(line)}`);
  const outsidePolicy = { includeScripts: includeOutsideScripts };
  let listeningPort = -1;

  app.use(async function loadEachFileOnlyAsItsNamedType(c, next) {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  });
  answerOwnLoopbackHostOnly(app, () => listeningPort);
  app.use(async function refuseServiceWorkerScripts(c, next) {
    const serviceWorker = c.req.header("service-worker");
    if (!serviceWorkerScriptFetch({ serviceWorker, fetchDest: c.req.header("sec-fetch-dest") }))
      return next();
    return c.text("Forbidden", 403);
  });

  app.get("/*", async (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    const relativePath = servedPath(requestPath);

    // compiledDir (the build's output) wins over projectDir. A candidate `..` pushes outside its root is
    // rejected: `path.join` does not enforce containment, so `GET /../etc/passwd` would be served.
    // compiledDir stays lexical: it links extracted frame directories in from the work directory.
    let file: ReturnType<typeof openRegularFile> = null;
    for (const root of compiledDir ? [compiledDir, projectDir] : [projectDir]) {
      const candidate = join(root, relativePath);
      const resolveSymlinks = !allowOutsideProjectAssets && root !== compiledDir;
      if (!isPathInside(candidate, root, { resolveSymlinks })) continue;
      if (isPrivateFileUnder(root, candidate, isStudioPrivatePath)) continue;
      const checksLinks = allowOutsideProjectAssets && root !== compiledDir;
      if (checksLinks && refusesOutsideLink(root, candidate, warnLeftOut, outsidePolicy)) continue;
      file = openRegularFile(candidate);
      if (file) break;
    }

    if (!file) {
      if (!/favicon\.ico$/i.test(requestPath)) {
        console.warn(`[FileServer] 404 Not Found: ${terminalText(requestPath)}`);
      }
      return c.text("Not found", 404);
    }

    const { fd, stat, filePath } = file;
    let streamOwnsFd = false;
    try {
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      if (ext === ".html") {
        // Use the async read here so we don't block the Node event loop while
        // reading an HTML file (typically small, but a 200KB+ AI-generated
        // composition during a concurrent render still costs a ms of stall).
        // The injection step is sync — it's pure string ops on the buffered
        // HTML — but the read itself is the only step that touches the disk.
        const rawHtml = await readFileAsync(fd, "utf-8");
        const isIndex = relativePath === "index.html";
        let html = rawHtml;
        if (preHeadScripts.length > 0) {
          html = injectScriptsAtHeadStart(html, preHeadScripts);
        }
        html = isIndex
          ? injectScriptsIntoHtml(html, headScripts, bodyScripts, stripEmbeddedRuntime)
          : html;
        html = injectTagsAtHeadStart(html, OFFER_NO_FRAMING_SITE_AN_EDITING_PORT);
        return c.text(html, 200, { "Content-Type": contentType });
      }

      if (ext === ".png") {
        const untagged = stripSdrPngColourTags(await readFileAsync(fd));
        if (untagged) {
          const headers = {
            "Content-Type": contentType,
            "Content-Length": String(untagged.length),
          };
          return new Response(c.req.method === "HEAD" ? null : new Uint8Array(untagged), {
            headers,
          });
        }
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
      const totalSize = stat.size;
      const rangeHeader = c.req.header("range");
      const rangeRequest = parseRangeHeader(rangeHeader, totalSize, contentType);

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

      const range = rangeRequest.kind === "satisfiable" ? rangeRequest : null;
      const responseOptions = {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(range ? range.end - range.start + 1 : totalSize),
          "Accept-Ranges": "bytes",
          ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}` } : {}),
        },
      };
      // HEAD has no body consumer to take ownership of a stream's descriptor.
      if (c.req.method === "HEAD") return new Response(null, responseOptions);
      const stream = createReadStream(filePath, {
        fd,
        autoClose: true,
        start: range?.start ?? 0,
        ...(range ? { end: range.end } : {}),
      });
      streamOwnsFd = true;
      try {
        const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
        return new Response(webStream, responseOptions);
      } catch (error) {
        stream.destroy();
        throw error;
      }
    } finally {
      // Streams close on completion, error or cancellation. HTML/416/errors
      // before stream creation remain owned by this request.
      if (!streamOwnsFd) closeSync(fd);
    }
  });

  return new Promise((resolve, reject) => {
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
      // An OS-picked port (0) must be one Chromium will load from; a caller-chosen one is theirs.
      const bound =
        port === 0 ? settleOnBrowserSafePort(server, "127.0.0.1") : Promise.resolve(info.port);
      bound.then((boundPort) => {
        listeningPort = boundPort;
        resolve({
          url: `http://localhost:${boundPort}`,
          port: boundPort,
          addPreHeadScript: (script: string) => {
            preHeadScripts.push(script);
          },
          injectedScriptTexts: () => injectedScriptTexts(preHeadScripts, headScripts, bodyScripts),
          close: () => {
            for (const socket of connections) socket.destroy();
            connections.clear();
            server.close();
          },
        });
      }, reject);
    });

    server.on("connection", (socket: IncomingMessage["socket"]) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
    });
    server.on("error", reject);
  });
}

export { HF_BRIDGE_SCRIPT, HF_EARLY_STUB, VIRTUAL_TIME_SHIM };
