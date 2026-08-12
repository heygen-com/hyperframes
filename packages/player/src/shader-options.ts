/**
 * Shader transition option types, constants, and pure helper functions for
 * injecting shader capture scale and loading mode parameters into composition
 * URLs and srcdoc HTML.
 */

export const SHADER_CAPTURE_SCALE_ATTR = "shader-capture-scale";
export const SHADER_LOADING_ATTR = "shader-loading";
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

function normalizeShaderLoadingMode(value: string | null): ShaderLoadingMode {
  if (value === null || value.trim() === "") return "composition";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "none" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "off"
  ) {
    return "none";
  }
  if (
    normalized === "player" ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "on"
  ) {
    return "player";
  }
  return "composition";
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
  return injectShaderOptionsIntoSrcdoc(
    srcdoc,
    normalizeShaderCaptureScale(el.getAttribute(SHADER_CAPTURE_SCALE_ATTR)),
    getShaderModeFromElement(el),
  );
}
