export const MOTION_BLUR_FINGERPRINT_FIELDS = [
  "canvas2d",
  "webgl",
  "video",
  "iframe",
  "customElement",
  "svgClip",
  "mask",
  "scrollContainer",
  "threeD",
  "overflowingMover",
  "frontOfMover",
  "blendMode",
  "fixedInMover",
  "pseudoOutside",
] as const;

export type MotionBlurFingerprintField = (typeof MOTION_BLUR_FINGERPRINT_FIELDS)[number];

export type MotionBlurFingerprint = Record<MotionBlurFingerprintField, number>;

export function emptyMotionBlurFingerprint(): MotionBlurFingerprint {
  return {
    canvas2d: 0,
    webgl: 0,
    video: 0,
    iframe: 0,
    customElement: 0,
    svgClip: 0,
    mask: 0,
    scrollContainer: 0,
    threeD: 0,
    overflowingMover: 0,
    frontOfMover: 0,
    blendMode: 0,
    fixedInMover: 0,
    pseudoOutside: 0,
  };
}
