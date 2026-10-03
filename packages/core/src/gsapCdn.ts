const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@";

export const GSAP_CDN_VERSION = "3.15.0";

/** MotionPathPlugin at the composition's own gsap version; a skew registers with a GSAP warning. */
export function motionPathPluginUrl(gsapVersion?: string): string {
  const version = gsapVersion && /^\d+(\.\d+)*$/.test(gsapVersion) ? gsapVersion : GSAP_CDN_VERSION;
  return `${GSAP_CDN}${version}/dist/MotionPathPlugin.min.js`;
}
