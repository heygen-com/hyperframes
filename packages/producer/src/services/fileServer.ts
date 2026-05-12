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
import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { injectScriptsAtHeadStart, injectScriptsIntoHtml } from "@hyperframes/core/compiler";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";

export { injectScriptsAtHeadStart, injectScriptsIntoHtml };

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
      flushAnimationFrame();
      return virtualNowMs;
    },
    getTime: function() {
      return virtualNowMs;
    },
  };
})();`;

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

const RENDER_MODE_SCRIPT = `(function() {
  var __realSetTimeout =
    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalSetTimeout === "function"
      ? window.__HF_VIRTUAL_TIME__.originalSetTimeout
      : window.setTimeout.bind(window);
  var __seekMode = ${JSON.stringify(RENDER_SEEK_MODE)};
  var __seekDiagnostics = ${RENDER_SEEK_DIAGNOSTICS ? "true" : "false"};
  var __seekStep = ${RENDER_SEEK_STEP};
  var __seekOffsetFraction = ${RENDER_SEEK_OFFSET_FRACTION};
  window.__HF_EXPORT_RENDER_SEEK_CONFIG = {
    mode: __seekMode,
    diagnostics: __seekDiagnostics,
    step: __seekStep,
    offsetFraction: __seekOffsetFraction,
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
    window.__renderReady = true;
    return true;
  }

  function waitForPlayer() {
    var hasComposition = Boolean(document.querySelector('[data-composition-id]'));
    if (hasComposition) {
      if (window.__player && typeof window.__player.renderSeek === "function") {
        window.__playerReady = true;
        window.__renderReady = true;
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

/**
 * Early stub: ensures `window.__hf` exists *before* any user `<script>` in
 * `<body>` executes. Without this, libraries that opportunistically write to
 * `__hf` during page-script execution (notably `@hyperframes/shader-transitions`,
 * which writes the active transition map to `__hf.transitions` inside its
 * `init()` call) silently no-op because `__hf` hasn't been created yet — the
 * full bridge script is injected at end-of-body and runs *after* user scripts.
 *
 * Injected at the very start of `<head>` so it runs before all other scripts.
 */
const HF_EARLY_STUB = `(function() {
  if (typeof window === "undefined") return;
  if (!window.__hf) window.__hf = {};
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
    return Number.isFinite(d) && d > 0 ? d : 0;
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
        var d = p.getDuration();
        return d > 0 ? d : getDeclaredDuration();
      },
    });
    hf.seek = function(t) {
      p.renderSeek(t);
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
  /** Strip embedded runtime scripts from HTML before injection. Default: true. */
  stripEmbeddedRuntime?: boolean;
}

export interface FileServerHandle {
  url: string;
  port: number;
  close: () => void;
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
  const bodyScripts = options.bodyScripts ?? [RENDER_MODE_SCRIPT, HF_BRIDGE_SCRIPT];

  const app = new Hono();

  app.get("/*", (c) => {
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
      const rawHtml = readFileSync(filePath, "utf-8");
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

    const content = readFileSync(filePath);
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
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
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        port: info.port,
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
