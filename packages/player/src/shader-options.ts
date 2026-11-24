/**
 * Shader transition option types, constants, and pure helper functions for
 * injecting shader capture scale and loading mode parameters into composition
 * URLs and srcdoc HTML.
 */

import {
  carriesRuntime,
  ensureRuntimeBeforeBodyScripts,
  inlineRuntimeBeforeBodyScripts,
  withBaseHref,
} from "./runtime-in-srcdoc.js";
import { sealedRuntimeSource } from "./sealed-runtime.js";
import { RUNTIME_CDN_URL } from "./runtime-url.js";

export const SHADER_CAPTURE_SCALE_ATTR = "shader-capture-scale";
export const SHADER_LOADING_ATTR = "shader-loading";
export const RUNTIME_SRC_ATTR = "runtime-src";
const SHADER_CAPTURE_SCALE_PARAM = "__hf_shader_capture_scale";
const SHADER_LOADING_PARAM = "__hf_shader_loading";

export const SHADER_LOADING_PHRASES = [
  "Preparing scene transitions",
  "Sampling outgoing scene motion",
  "Sampling incoming scene motion",
  "Caching transition frames",
  "Finalizing transition preview",
];

export type ShaderLoadingMode = "composition" | "player" | "none";

export interface ShaderTransitionState {
  ready?: boolean;
  progress?: number;
  total?: number;
  currentTransition?: number;
  transitionTotal?: number;
  transitionFrame?: number;
  transitionFrames?: number;
  phase?: "cached" | "capturing" | "finalizing";
  loading?: boolean;
}

function normalizeShaderCaptureScale(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.min(1, Math.max(0.25, parsed)));
}

const SHADER_LOADING_WORDS = new Map<string, ShaderLoadingMode>([
  ["none", "none"],
  ["false", "none"],
  ["0", "none"],
  ["off", "none"],
  ["player", "player"],
  ["true", "player"],
  ["1", "player"],
  ["on", "player"],
]);

function normalizeShaderLoadingMode(value: string | null): ShaderLoadingMode {
  return SHADER_LOADING_WORDS.get(value?.trim().toLowerCase() ?? "") ?? "composition";
}

/** Drop one of our own keys from raw `a=1&b=2` pairs, matched by name so that
 *  nothing around it has to be decoded. */
function withoutParam(pairs: string[], key: string): string[] {
  return pairs.filter((pair) => pair !== "" && pair.split("=")[0] !== key);
}

/**
 * The player's own params, appended to the query the composition author wrote
 * rather than merged into a re-serialized copy of it.
 *
 * `new URLSearchParams(query).toString()` is a form-encoding round trip: it
 * re-encodes the *whole* query as application/x-www-form-urlencoded, which
 * writes every space as `+`. A composition reading its own query with
 * `decodeURIComponent` — percent-decoding, which leaves `+` alone — cannot undo
 * that, so a value of "Ship it today" arrived on the page as "Ship+it+today".
 * The two codecs are not inverses, and the player has no business picking one
 * for a query it is only passing along. The author's bytes now travel through
 * byte-identical; only our two keys are rewritten.
 */
function withShaderQueryParams(
  src: string,
  scale: string | null,
  loadingMode: ShaderLoadingMode,
): string {
  const hashIndex = src.indexOf("#");
  const beforeHash = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "";
  let pairs = withoutParam(query.split("&"), SHADER_CAPTURE_SCALE_PARAM);
  pairs = withoutParam(pairs, SHADER_LOADING_PARAM);
  if (scale !== null) pairs.push(`${SHADER_CAPTURE_SCALE_PARAM}=${encodeURIComponent(scale)}`);
  if (loadingMode !== "composition") {
    pairs.push(`${SHADER_LOADING_PARAM}=${encodeURIComponent(loadingMode)}`);
  }
  const nextQuery = pairs.join("&");
  return `${path}${nextQuery ? `?${nextQuery}` : ""}${hash}`;
}

function injectShaderOptionsIntoSrcdoc(
  html: string,
  scale: string | null,
  loadingMode: ShaderLoadingMode,
): string {
  if (scale === null && loadingMode === "composition") return html;
  const lines: string[] = [];
  if (scale !== null) lines.push(`window.__HF_SHADER_CAPTURE_SCALE=${JSON.stringify(scale)};`);
  if (loadingMode !== "composition") {
    lines.push(`window.__HF_SHADER_LOADING=${JSON.stringify(loadingMode)};`);
  }
  const script = `<script data-hyperframes-player-shader-options>${lines.join("")}</script>`;
  if (/<head\b[^>]*>/i.test(html))
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}${script}`);
  return `${script}${html}`;
}

/**
 * Convenience wrappers that read shader attributes directly from an element,
 * avoiding boilerplate in the web component class body.
 */

export function getShaderModeFromElement(el: Element): ShaderLoadingMode {
  return normalizeShaderLoadingMode(el.getAttribute(SHADER_LOADING_ATTR));
}

export function getShaderCaptureScaleFromElement(el: Element): number {
  return Number(normalizeShaderCaptureScale(el.getAttribute(SHADER_CAPTURE_SCALE_ATTR)) ?? "1");
}

export function prepareSrcForElement(el: Element, src: string): string {
  return withShaderQueryParams(
    src,
    normalizeShaderCaptureScale(el.getAttribute(SHADER_CAPTURE_SCALE_ATTR)),
    getShaderModeFromElement(el),
  );
}

export function prepareSrcdocForElement(el: Element, srcdoc: string): string {
  // Runtime first, and in the head: a component's inline script reads its
  // variables while the body is parsing, long before the probe's own injection
  // could land. See runtime-in-srcdoc.ts.
  return ensureRuntimeBeforeBodyScripts(
    injectShaderOptionsIntoSrcdoc(
      srcdoc,
      normalizeShaderCaptureScale(el.getAttribute(SHADER_CAPTURE_SCALE_ATTR)),
      getShaderModeFromElement(el),
    ),
    runtimeSrcFromElement(el),
  );
}

/**
 * `prepareSrcdocForElement` for a sealed frame, which the player cannot reach into after it loads:
 * the runtime goes in as text, unless the embedder named its own `runtime-src`.
 */
export async function prepareSealedSrcdocForElement(
  el: Element,
  html: string,
  base?: string,
): Promise<string> {
  const doc =
    runtimeSrcFromElement(el) !== RUNTIME_CDN_URL
      ? prepareSrcdocForElement(el, html)
      : await withSealedRuntime(
          injectShaderOptionsIntoSrcdoc(
            html,
            normalizeShaderCaptureScale(el.getAttribute(SHADER_CAPTURE_SCALE_ATTR)),
            getShaderModeFromElement(el),
          ),
        );
  return base ? withBaseHref(doc, base) : doc;
}

async function withSealedRuntime(page: string): Promise<string> {
  return carriesRuntime(page)
    ? page
    : inlineRuntimeBeforeBodyScripts(page, await sealedRuntimeSource());
}

export function runtimeSrcFromElement(el: Element): string {
  const configured = el.getAttribute(RUNTIME_SRC_ATTR)?.trim();
  if (!configured) return RUNTIME_CDN_URL;
  try {
    const url = new URL(configured, document.baseURI);
    // A srcdoc frame runs with `allow-same-origin` by default, so it inherits the embedder's
    // origin. An unrestricted host here would therefore be arbitrary script execution in the
    // embedding page, reachable through a prop bag since React spreads unknown props onto
    // custom elements. Loopback and same-origin cover the local rig this exists for; a foreign
    // origin has to be a deliberate, named opt-in rather than a scheme check falling through.
    const okScheme = url.protocol === "http:" || url.protocol === "https:";
    const loopback =
      url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return okScheme && (loopback || url.origin === location.origin) ? url.href : RUNTIME_CDN_URL;
  } catch {
    return RUNTIME_CDN_URL;
  }
}
