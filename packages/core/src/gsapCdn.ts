const GSAP_CDN_VERSION = "3.15.0";

export function gsapCdnDist(gsapVersion?: string): string {
  const version = gsapVersion && /^\d+(\.\d+)*$/.test(gsapVersion) ? gsapVersion : GSAP_CDN_VERSION;
  return `https://cdn.jsdelivr.net/npm/gsap@${version}/dist/`;
}

/** MotionPathPlugin at the composition's own gsap version; a skew registers with a GSAP warning. */
export function motionPathPluginUrl(gsapVersion?: string): string {
  return `${gsapCdnDist(gsapVersion)}MotionPathPlugin.min.js`;
}
