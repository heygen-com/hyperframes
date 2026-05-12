/**
 * File Server for Render Mode
 *
 * Lightweight HTTP server that serves the project directory inside Docker.
 * Key responsibility: inject the verified Hyperframe runtime + render mode extension
 * into index.html on-the-fly, so Puppeteer can load the composition with
 * all relative URLs (compositions, CSS, JS, assets) resolving correctly.
 */
import { injectScriptsAtHeadStart, injectScriptsIntoHtml } from "@hyperframes/core/compiler";
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
export declare function isPathInside(child: string, parent: string, options?: IsPathInsideOptions): boolean;
declare const VIRTUAL_TIME_SHIM: string;
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
declare const HF_EARLY_STUB = "(function() {\n  if (typeof window === \"undefined\") return;\n  if (!window.__hf) window.__hf = {};\n})();";
/**
 * Bridge script: maps window.__player (Hyperframe runtime) → window.__hf (engine protocol).
 * Injected after RENDER_MODE_SCRIPT so the engine's frameCapture can find window.__hf.
 *
 * This script *patches* the existing __hf object rather than replacing it, so
 * fields written during page-script execution (e.g. transitions metadata from
 * @hyperframes/shader-transitions) are preserved through to engine query time.
 */
declare const HF_BRIDGE_SCRIPT = "(function() {\n  var __realSetInterval =\n    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalSetInterval === \"function\"\n      ? window.__HF_VIRTUAL_TIME__.originalSetInterval\n      : window.setInterval.bind(window);\n  var __realClearInterval =\n    window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.originalClearInterval === \"function\"\n      ? window.__HF_VIRTUAL_TIME__.originalClearInterval\n      : window.clearInterval.bind(window);\n  function getDeclaredDuration() {\n    var root = document.querySelector('[data-composition-id]');\n    if (!root) return 0;\n    var d = Number(root.getAttribute('data-duration'));\n    return Number.isFinite(d) && d > 0 ? d : 0;\n  }\n  function seekSameOriginChildFrames(frameWindow, nextTimeMs) {\n    var frames;\n    try {\n      frames = frameWindow.frames;\n    } catch (_error) {\n      return;\n    }\n    if (!frames || typeof frames.length !== \"number\") return;\n    for (var i = 0; i < frames.length; i++) {\n      var childWindow = null;\n      try {\n        childWindow = frames[i];\n        if (!childWindow || childWindow === frameWindow) continue;\n        if (\n          childWindow.__HF_VIRTUAL_TIME__ &&\n          typeof childWindow.__HF_VIRTUAL_TIME__.seekToTime === \"function\"\n        ) {\n          childWindow.__HF_VIRTUAL_TIME__.seekToTime(nextTimeMs);\n        }\n      } catch (_error) {\n        continue;\n      }\n      seekSameOriginChildFrames(childWindow, nextTimeMs);\n    }\n  }\n  function bridge() {\n    var p = window.__player;\n    if (!p || typeof p.renderSeek !== \"function\" || typeof p.getDuration !== \"function\") {\n      return false;\n    }\n    var hf = window.__hf || {};\n    Object.defineProperty(hf, \"duration\", {\n      configurable: true,\n      enumerable: true,\n      get: function() {\n        var d = p.getDuration();\n        return d > 0 ? d : getDeclaredDuration();\n      },\n    });\n    hf.seek = function(t) {\n      p.renderSeek(t);\n      var nextTimeMs = (Math.max(0, Number(t) || 0)) * 1000;\n      if (window.__HF_VIRTUAL_TIME__ && typeof window.__HF_VIRTUAL_TIME__.seekToTime === \"function\") {\n        window.__HF_VIRTUAL_TIME__.seekToTime(nextTimeMs);\n      }\n      seekSameOriginChildFrames(window, nextTimeMs);\n    };\n    window.__hf = hf;\n    return true;\n  }\n  if (bridge()) return;\n  var iv = __realSetInterval(function() {\n    if (bridge()) __realClearInterval(iv);\n  }, 50);\n})();";
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
export declare function createFileServer(options: FileServerOptions): Promise<FileServerHandle>;
export { HF_BRIDGE_SCRIPT, HF_EARLY_STUB, VIRTUAL_TIME_SHIM };
//# sourceMappingURL=fileServer.d.ts.map