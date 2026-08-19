import { resolve } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import {
  createMediaCodecProbeCache,
  proxyVariantFor,
  scanProjectMediaCodecMap,
  type HtmlSourceLike,
  type MediaCodecMap,
  type MediaCodecProbeCache,
} from "./mediaCodecMap.js";
import { resolveProxy, PROXY_PARAMS_VERSION } from "./proxyTranscoder.js";

/**
 * Transparent-media-proxy wiring shared by `routes/preview.ts`
 * (docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md, unit U3).
 * Split out of the route module to keep it under the repo's 600-line file cap.
 */

/**
 * Preview-route-local adapter surface for the auto-proxy feature. Both
 * fields are optional so any existing `StudioApiAdapter` value remains
 * structurally assignable without editing the shared interface:
 * `autoProxy` defaults to true (on) when omitted — a later unit wires the
 * CLI `--no-proxy` flag / `hyperframes.json` setting through it;
 * `mediaCodecProbeCache` lets a host share one probe cache across
 * preview/play/static-server surfaces instead of each constructing its own.
 */
export type PreviewApiAdapter = StudioApiAdapter & {
  autoProxy?: boolean;
  mediaCodecProbeCache?: MediaCodecProbeCache;
};

export function isAutoProxyEnabled(adapter: PreviewApiAdapter): boolean {
  return adapter.autoProxy !== false;
}

/** One probe cache per server instance — construct once in `registerPreviewRoutes`
 * and reuse across every request so the mtime-cache benefit in
 * `scanProjectMediaCodecMap` actually applies. A host that wants to share the
 * cache across other surfaces (play, static project server) can pass its own
 * via `adapter.mediaCodecProbeCache`. */
export function resolvePreviewMediaCodecProbeCache(
  adapter: PreviewApiAdapter,
): MediaCodecProbeCache {
  return adapter.mediaCodecProbeCache ?? createMediaCodecProbeCache();
}

/**
 * ETag salt for `?hf-proxy=` asset requests, mirroring `variablesEtagSalt` in
 * preview.ts: salted by the raw param value plus the transcoder's params
 * version, so a future proxy-recipe change (which bumps `PROXY_PARAMS_VERSION`)
 * or a different proxy variant invalidates cached 304s without needing to
 * touch the proxy file itself.
 */
export function proxyEtagSalt(raw: string | undefined): string {
  if (raw === undefined) return "";
  return `:proxy:${raw}:${PROXY_PARAMS_VERSION}`;
}

// Mirrors `injectScriptTagIntoHead` in routes/preview.ts (kept local rather
// than imported to avoid a helpers → routes dependency edge for one
// two-line utility).
function injectScriptTagIntoHead(html: string, scriptTag: string): string {
  if (html.includes("</head>")) return html.replace("</head>", `${scriptTag}\n</head>`);
  return `${scriptTag}\n${html}`;
}

/**
 * Injects `window.__HF_MEDIA_CODEC_MAP__` (the U1 codec-facts scan) into
 * served composition HTML, and fire-and-forget pre-warms `resolveProxy` for
 * every browser-hostile entry so an element's proactive swap usually hits a
 * warm cache (KTD: protects the per-origin connection budget under held
 * responses). No second concurrency limiter here — the transcoder's own
 * global bound throttles both pre-warm and element-triggered calls.
 * Pre-warm failures are swallowed; an actual `?hf-proxy=` request surfaces
 * them as a 502. Alpha-bearing entries pre-warm their VP8/WebM variant.
 *
 * The single shared implementation for every auto-proxy surface — the studio
 * preview route (via `injectMediaCodecMap` below) and the CLI's composition /
 * static project servers (via the `./media-proxy-preview` subpath export).
 * Empty maps leave HTML untouched, preserving the normal no-hostile-media
 * preview path. On-demand proxy requests enforce the same eligibility gate.
 */
export async function injectMediaCodecMapIntoHtml(
  html: string,
  projectDir: string,
  htmlSources: HtmlSourceLike[],
  probeCache?: MediaCodecProbeCache,
): Promise<string> {
  let map: MediaCodecMap;
  try {
    map = await scanProjectMediaCodecMap(
      projectDir,
      htmlSources,
      probeCache ? { cache: probeCache } : {},
    );
  } catch {
    // Best-effort: a scan failure must never block serving the page.
    return html;
  }
  if (Object.keys(map).length === 0) return html;
  for (const [rootRelativePathname, facts] of Object.entries(map)) {
    if (!facts.browserHostile) continue;
    resolveProxy(
      projectDir,
      resolve(projectDir, rootRelativePathname.replace(/^\/+/, "")),
      proxyVariantFor(facts),
    ).catch(() => {
      // Swallowed: the pre-warm is best-effort. A real `?hf-proxy=` request
      // for this asset re-attempts the transcode and reports failure (502).
    });
  }
  // <-escape prevents a src path containing "</script>" from breaking out of
  // the injected tag, mirroring injectPreviewVariables in routes/preview.ts.
  const json = JSON.stringify(map)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const tag = `<script data-hf-media-codec-map>window.__HF_MEDIA_CODEC_MAP__=${json};</script>`;
  return injectScriptTagIntoHead(html, tag);
}

/**
 * Adapter-aware wrapper used by the studio preview routes: skipped entirely
 * (no scan, no injection) when auto-proxy is off for this adapter.
 */
export async function injectMediaCodecMap(
  html: string,
  adapter: PreviewApiAdapter,
  projectDir: string,
  compSrcPath: string,
  probeCache: MediaCodecProbeCache,
): Promise<string> {
  if (!isAutoProxyEnabled(adapter)) return html;
  return injectMediaCodecMapIntoHtml(html, projectDir, [{ html, compSrcPath }], probeCache);
}
