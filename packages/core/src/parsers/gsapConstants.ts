/**
 * GSAP property and ease constants.
 *
 * Extracted into a standalone module so browser code can import them
 * without pulling in gsapParser (which depends on recast / @babel/parser).
 */

export const SUPPORTED_PROPS = [
  "opacity",
  "visibility",
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "autoAlpha",
  "width",
  "height",
];

export const SUPPORTED_EASES = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "power4.in",
  "power4.out",
  "power4.inOut",
  "back.in",
  "back.out",
  "back.inOut",
  "elastic.in",
  "elastic.out",
  "elastic.inOut",
  "bounce.in",
  "bounce.out",
  "bounce.inOut",
  "expo.in",
  "expo.out",
  "expo.inOut",
];
