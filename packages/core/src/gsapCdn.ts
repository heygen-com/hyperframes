const GSAP_CDN_VERSION = "3.15.0";
const GSAP_CDN_BASE_URL = "https://cdn.jsdelivr.net/npm";
export const GSAP_BASE_URL_META = "hyperframes-gsap-base-url";

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
  return url.href.replace(/\/+$/, "");
}

export function gsapCdnDist(gsapVersion?: string, baseUrl?: string): string {
  const version = gsapVersion && /^\d+(\.\d+)*$/.test(gsapVersion) ? gsapVersion : GSAP_CDN_VERSION;
  return `${normalizeGsapBaseUrl(baseUrl)}/gsap@${version}/dist/`;
}

/** MotionPathPlugin at the composition's own gsap version; a skew registers with a GSAP warning. */
export function motionPathPluginUrl(gsapVersion?: string, baseUrl?: string): string {
  return `${gsapCdnDist(gsapVersion, baseUrl)}MotionPathPlugin.min.js`;
}
