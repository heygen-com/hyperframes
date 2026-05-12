/**
 * Shader transition option types, constants, and pure helper functions for
 * injecting shader capture scale and loading mode parameters into composition
 * URLs and srcdoc HTML.
 */

export const SHADER_CAPTURE_SCALE_ATTR = "shader-capture-scale";
export const SHADER_LOADING_ATTR = "shader-loading";
export const SHADER_CAPTURE_SCALE_PARAM = "__hf_shader_capture_scale";
export const SHADER_LOADING_PARAM = "__hf_shader_loading";

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

export function normalizeShaderCaptureScale(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(Math.min(1, Math.max(0.25, parsed)));
}

export function normalizeShaderLoadingMode(value: string | null): ShaderLoadingMode {
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

function setQueryParam(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

export function withShaderQueryParams(
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
  const params = new URLSearchParams(query);
  setQueryParam(params, SHADER_CAPTURE_SCALE_PARAM, scale);
  setQueryParam(params, SHADER_LOADING_PARAM, loadingMode === "composition" ? null : loadingMode);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}${hash}`;
}

export function injectShaderOptionsIntoSrcdoc(
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
