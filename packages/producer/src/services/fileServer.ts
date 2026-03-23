/**
 * File Server for Render Mode
 *
 * Wraps @hyperframes/engine's generic file server with producer-specific
 * defaults: the verified Hyperframe runtime injected into <head>, and the
 * render-mode extension (renderSeek + __hf bridge) injected before </body>.
 *
 * Render-seek configuration is read from EngineConfig (which itself resolves
 * PRODUCER_* env vars as backward-compatible fallbacks).
 */

import {
  createFileServer as createEngineFileServer,
  type FileServerOptions as EngineFileServerOptions,
  type FileServerHandle,
  resolveConfig,
  type EngineConfig,
} from "@hyperframes/engine";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";

// ── Script builders ─────────────────────────────────────────────────────────

/**
 * Build the render-mode extension script from config values.
 * Adds renderSeek() for frame-accurate seeking without media sync
 * (videos are replaced with frame images during render).
 */
function buildRenderModeScript(config: EngineConfig): string {
  return `(function() {
  var __seekMode = ${JSON.stringify(config.renderSeekMode)};
  var __seekDiagnostics = ${config.renderSeekDiagnostics ? "true" : "false"};
  var __seekStep = ${config.renderSeekStep};
  var __seekOffsetFraction = ${config.renderSeekOffsetFraction};
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
}

/**
 * Bridge script: maps window.__player (Hyperframe runtime) -> window.__hf (engine protocol).
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

// ── Public API ──────────────────────────────────────────────────────────────

export interface FileServerOptions {
  projectDir: string;
  compiledDir?: string;
  port?: number;
  /** Scripts injected into <head> of index.html. Default: verified Hyperframe runtime. */
  headScripts?: string[];
  /** Scripts injected before </body> of index.html. Default: render mode extension + __hf bridge. */
  bodyScripts?: string[];
  /** Strip embedded runtime scripts from HTML before injection. Default: true. */
  stripEmbeddedRuntime?: boolean;
}

export type { FileServerHandle };

/**
 * Create a file server for render mode.
 *
 * Wraps the engine's generic file server with producer-specific defaults:
 * - headScripts: verified Hyperframe runtime source
 * - bodyScripts: render-mode extension (renderSeek config from EngineConfig) + __hf bridge
 */
export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const config = resolveConfig();
  const headScripts = options.headScripts ?? [getVerifiedHyperframeRuntimeSource()];
  const bodyScripts = options.bodyScripts ?? [buildRenderModeScript(config), HF_BRIDGE_SCRIPT];

  const engineOptions: EngineFileServerOptions = {
    projectDir: options.projectDir,
    compiledDir: options.compiledDir,
    port: options.port,
    headScripts,
    bodyScripts,
    stripEmbeddedRuntime: options.stripEmbeddedRuntime,
  };

  return createEngineFileServer(engineOptions);
}
