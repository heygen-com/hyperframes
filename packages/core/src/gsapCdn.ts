export const GSAP_CDN_VERSION = "3.15.0";
const GSAP_CDN_BASE_URL = "https://cdn.jsdelivr.net/npm";
export const GSAP_BASE_URL_META = "hyperframes-gsap-base-url";
export const GSAP_PLUGIN_LOAD_ATTR = "data-hf-gsap-plugin";
export const NO_PATH_TWEEN_META = "hf-no-path-tween";

export const namesMotionPath = (script: string) => /motionPath["']?\s*[:{]/.test(script);

const pathOf = (src: string) =>
  URL.canParse(src, "http://localhost/") ? new URL(src, "http://localhost/").pathname : null;

export function isGsapCoreUrl(src: string): boolean {
  return /\/gsap(-\d+(\.\d+)*)?(\.min)?\.js$/i.test(pathOf(src) ?? "");
}

function motionPathBesideGsap(gsapFile: string): string {
  return `${gsapFile.replace(/[?#].*$/, "").replace(/[^/]*$/, "")}MotionPathPlugin.min.js`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/** An npm-style mirror root; callers choose configuration without coupling this helper to a host. */
export function normalizeGsapBaseUrl(baseUrl?: string): string {
  const value = baseUrl?.trim();
  if (!value) return GSAP_CDN_BASE_URL;
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value) || /[?#]/.test(value)) {
    throw new Error("GSAP base URL must be an absolute HTTP(S) URL without a query or fragment");
  }
  const url = new URL(value);
  if (url.username || url.password) {
    throw new Error("GSAP base URL must not contain credentials");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("GSAP base URL must use HTTPS unless it points at this machine");
  }
  return url.href.replace(/\/+$/, "");
}

/** A same-origin path to the host's bundled GSAP, which holds only GSAP_CDN_VERSION. */
export function normalizeGsapLocalRoot(root: string): string {
  const value = root.trim();
  if (!/^\/(?![/\\])/.test(value) || /[?#\\]/.test(value)) {
    throw new Error("GSAP local root must be a same-origin path such as /vendor/npm");
  }
  const origin = "http://local.invalid";
  const url = new URL(value, origin);
  const path = url.pathname.replace(/\/+$/, "");
  if (url.origin !== origin || !path) {
    throw new Error("GSAP local root must be a same-origin path such as /vendor/npm");
  }
  return path;
}

export function gsapCdnDist(gsapVersion?: string, baseUrl?: string): string {
  const version = gsapVersion && /^\d+(\.\d+)*$/.test(gsapVersion) ? gsapVersion : GSAP_CDN_VERSION;
  if (baseUrl?.trim().startsWith("/")) {
    const root = normalizeGsapLocalRoot(baseUrl);
    return `${version === GSAP_CDN_VERSION ? root : GSAP_CDN_BASE_URL}/gsap@${version}/dist/`;
  }
  return `${normalizeGsapBaseUrl(baseUrl)}/gsap@${version}/dist/`;
}

export function motionPathPluginUrl(gsapVersion?: string, baseUrl?: string): string {
  return `${gsapCdnDist(gsapVersion, baseUrl)}MotionPathPlugin.min.js`;
}

/** MotionPathPlugin from a configured mirror, else from beside the page's own GSAP file; null with neither. */
export function motionPathPluginFor(page: {
  gsapFile: string | null;
  mirror?: string | null;
  version?: string;
}) {
  const version = page.version ?? page.gsapFile?.match(/gsap@([\d.]+)/)?.[1];
  if (page.mirror) return motionPathPluginUrl(version, page.mirror);
  return page.gsapFile ? motionPathBesideGsap(page.gsapFile) : null;
}
