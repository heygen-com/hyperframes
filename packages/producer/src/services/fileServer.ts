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
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";

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
      setTimeout(waitForPlayer, 50);
      return;
    }
    if (installMediaFallbackPlayer()) {
      return;
    }
    setTimeout(waitForPlayer, 50);
  }
  waitForPlayer();
})();`;

/**
 * Bridge script: maps window.__player (Hyperframe runtime) → window.__hf (engine protocol).
 * Injected after RENDER_MODE_SCRIPT so the engine's frameCapture can find window.__hf.
 */
const HF_BRIDGE_SCRIPT = `(function() {
  function bridge() {
    var p = window.__player;
    if (!p || typeof p.renderSeek !== "function" || typeof p.getDuration !== "function") {
      return false;
    }
    window.__hf = {
      get duration() { return p.getDuration(); },
      seek: function(t) { p.renderSeek(t); },
    };
    return true;
  }
  if (bridge()) return;
  var iv = setInterval(function() {
    if (bridge()) clearInterval(iv);
  }, 50);
})();`;

function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  const runtimeSrcMarkers = [
    "hyperframe.runtime.iife.js",
    "hyperframe-runtime.modular-runtime.inline.js",
    "data-hyperframes-preview-runtime",
  ];
  const runtimeInlineMarkers = [
    "__hyperframeRuntimeBootstrapped",
    "__hyperframeRuntime",
    "__hyperframeRuntimeTeardown",
    "window.__player =",
    "window.__playerReady",
    "window.__renderReady",
  ];

  const shouldStrip = (block: string): boolean => {
    const lowered = block.toLowerCase();
    for (const marker of runtimeSrcMarkers) {
      if (lowered.includes(marker.toLowerCase())) {
        return true;
      }
    }
    for (const marker of runtimeInlineMarkers) {
      if (block.includes(marker)) {
        return true;
      }
    }
    return false;
  };

  return html.replace(scriptRe, (block) => (shouldStrip(block) ? "" : block));
}

function injectScriptsIntoHtml(
  html: string,
  headScripts: string[],
  bodyScripts: string[],
  stripEmbedded: boolean,
): string {
  if (stripEmbedded) {
    html = stripEmbeddedRuntimeScripts(html);
  }

  if (headScripts.length > 0) {
    const headTags = headScripts.map((src) => `<script>${src}</script>`).join("\n");
    if (html.includes("</head>")) {
      // Use function replacement to avoid $& interpolation in runtime source
      html = html.replace("</head>", () => `${headTags}\n</head>`);
    } else if (html.includes("<body")) {
      html = html.replace("<body", () => `${headTags}\n<body`);
    } else {
      html = headTags + "\n" + html;
    }
  }

  if (bodyScripts.length > 0) {
    const bodyTags = bodyScripts.map((src) => `<script>${src}</script>`).join("\n");
    if (html.includes("</body>")) {
      // Use function replacement to avoid $& interpolation in runtime source
      html = html.replace("</body>", () => `${bodyTags}\n</body>`);
    } else {
      html = html + "\n" + bodyTags;
    }
  }

  return html;
}

export interface FileServerOptions {
  projectDir: string;
  compiledDir?: string;
  port?: number;
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

  // Default scripts: Hyperframe runtime in <head>, render mode in </body>
  const headScripts = options.headScripts ?? [getVerifiedHyperframeRuntimeSource()];
  const bodyScripts = options.bodyScripts ?? [RENDER_MODE_SCRIPT, HF_BRIDGE_SCRIPT];

  const app = new Hono();

  app.get("/*", (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    // Remove leading slash
    const relativePath = requestPath.replace(/^\//, "");
    const compiledPath = compiledDir ? join(compiledDir, relativePath) : null;
    const hasCompiledFile = Boolean(
      compiledPath && existsSync(compiledPath) && statSync(compiledPath).isFile(),
    );
    const filePath = hasCompiledFile ? (compiledPath as string) : join(projectDir, relativePath);

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return c.text("Not found", 404);
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      const rawHtml = readFileSync(filePath, "utf-8");
      const isIndex = relativePath === "index.html";
      const html = isIndex
        ? injectScriptsIntoHtml(rawHtml, headScripts, bodyScripts, stripEmbeddedRuntime)
        : rawHtml;
      return c.text(html, 200, { "Content-Type": contentType });
    }

    const content = readFileSync(filePath);
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      const actualPort = info.port;
      const url = `http://localhost:${actualPort}`;

      resolve({
        url,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}
