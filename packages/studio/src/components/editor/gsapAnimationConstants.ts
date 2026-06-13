import { controlPointsForGsapEase } from "./studioMotion";

export const METHOD_LABELS: Record<string, string> = {
  set: "Set",
  to: "Animate",
  from: "Animate In",
  fromTo: "From → To",
};

export const METHOD_TOOLTIPS: Record<string, string> = {
  set: "Instantly snap to these values — no transition",
  to: "Smoothly animate the element to these target values",
  from: "Element starts at these values and transitions to its normal state",
  fromTo: "Animate from one state to another",
};

export const PROP_LABELS: Record<string, string> = {
  x: "Move X",
  y: "Move Y",
  width: "Width",
  height: "Height",
  rotation: "Rotate",
  z: "Move Z",
  rotationX: "Rotate X",
  rotationY: "Rotate Y",
  rotationZ: "Rotate Z",
  perspective: "Perspective",
  transformOrigin: "Transform Origin",
  opacity: "Opacity",
  scale: "Scale",
  scaleX: "Scale X",
  scaleY: "Scale Y",
  autoAlpha: "Visibility",
  visibility: "Visible",
  scaleX_alias: "Stretch X",
  filter: "Filter",
  clipPath: "Clip Path",
  color: "Color",
  backgroundColor: "Background",
  borderColor: "Border Color",
  borderRadius: "Radius",
  fontSize: "Font Size",
  letterSpacing: "Tracking",
  skewX: "Skew X",
  skewY: "Skew Y",
  innerText: "Counter Value",
};

export const PROP_UNITS: Record<string, string> = {
  x: "px",
  y: "px",
  width: "px",
  height: "px",
  rotation: "°",
  z: "px",
  rotationX: "°",
  rotationY: "°",
  rotationZ: "°",
  perspective: "px",
  transformOrigin: "",
  opacity: "%",
  scale: "×",
  scaleX: "×",
  scaleY: "×",
  autoAlpha: "%",
  visibility: "",
};

export const PROP_TOOLTIPS: Record<string, string> = {
  x: "Move left/right (negative = left, positive = right)",
  y: "Move up/down (negative = up, positive = down)",
  opacity: "How visible (0 = invisible, 1 = fully visible)",
  scale: "Size multiplier (1 = normal, 2 = double, 0.5 = half)",
  scaleX: "Horizontal stretch (1 = normal)",
  scaleY: "Vertical stretch (1 = normal)",
  rotation: "Spin angle (360 = full rotation)",
  z: "Move forward/back along the Z axis",
  rotationX: "Rotate around the horizontal X axis",
  rotationY: "Rotate around the vertical Y axis",
  rotationZ: "Rotate around the screen-facing Z axis",
  perspective:
    "3D depth context for child elements; set it on a parent when rotating children in 3D",
  transformOrigin: "Pivot point for transforms, for example center center or 50% 50%",
  width: "Element width",
  height: "Element height",
  autoAlpha: "Like opacity but hides element completely at 0",
  visibility: "Show or hide the element",
  innerText: "End value for a number roll-up (the number it counts up/down to)",
};

export const EASE_LABELS: Record<string, string> = {
  none: "Constant speed",
  "power1.out": "Gentle slowdown",
  "power2.out": "Smooth slowdown",
  "power3.out": "Snappy slowdown",
  "power4.out": "Sharp slowdown",
  "power1.in": "Gentle speedup",
  "power2.in": "Smooth speedup",
  "power3.in": "Strong speedup",
  "power4.in": "Sharp speedup",
  "power1.inOut": "Gentle ease",
  "power2.inOut": "Smooth ease",
  "power3.inOut": "Strong ease",
  "power4.inOut": "Sharp ease",
  "back.out": "Overshoot & settle",
  "back.in": "Pull back & go",
  "back.inOut": "Pull & overshoot",
  "elastic.out": "Springy bounce",
  "elastic.in": "Wind up spring",
  "elastic.inOut": "Full spring",
  "bounce.out": "Drop & bounce",
  "bounce.in": "Reverse bounce",
  "bounce.inOut": "Double bounce",
  "expo.out": "Very snappy stop",
  "expo.in": "Very slow start",
  "expo.inOut": "Dramatic ease",
  "spring-gentle": "Gentle spring",
  "spring-bouncy": "Bouncy spring",
  "spring-stiff": "Stiff spring",
  "spring-wobbly": "Wobbly spring",
  "spring-heavy": "Heavy spring",
};

export const EASE_CURVES: Record<string, [number, number, number, number]> = {
  none: [0, 0, 1, 1],
  "power1.out": [0, 0, 0.58, 1],
  "power2.out": [0.16, 1, 0.3, 1],
  "power3.out": [0.08, 0.82, 0.17, 1],
  "power4.out": [0.06, 0.73, 0.09, 1],
  "power1.in": [0.42, 0, 1, 1],
  "power2.in": [0.55, 0.06, 0.68, 0.19],
  "power3.in": [0.6, 0.04, 0.98, 0.34],
  "power4.in": [0.7, 0, 0.84, 0],
  "power1.inOut": [0.42, 0, 0.58, 1],
  "power2.inOut": [0.45, 0.05, 0.55, 0.95],
  "power3.inOut": [0.65, 0.05, 0.35, 1],
  "power4.inOut": [0.76, 0, 0.24, 1],
  "back.out": [0.34, 1.56, 0.64, 1],
  "back.in": [0.36, 0, 0.66, -0.56],
  "back.inOut": [0.68, -0.55, 0.27, 1.55],
  "expo.out": [0.16, 1, 0.3, 1],
  "expo.in": [0.7, 0, 0.84, 0],
  "expo.inOut": [0.87, 0, 0.13, 1],
};

export function parseCustomEaseFromString(ease: string): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const match = ease.match(/^custom\((.+)\)$/);
  if (!match) return controlPointsForGsapEase("power2.out");
  const data = match[1];
  const nums = data.match(/[\d.]+/g)?.map(Number);
  if (!nums || nums.length < 6) return controlPointsForGsapEase("power2.out");
  return { x1: nums[2], y1: nums[3], x2: nums[4], y2: nums[5] };
}

export const PERCENT_PROPS = new Set(["opacity", "autoAlpha"]);

export const PROP_CONSTRAINTS: Record<string, { min?: number; max?: number; step?: number }> = {
  opacity: { min: 0, max: 1, step: 0.01 },
  autoAlpha: { min: 0, max: 1, step: 0.01 },
  scale: { min: -10, max: 10, step: 0.01 },
  scaleX: { min: -10, max: 10, step: 0.01 },
  scaleY: { min: -10, max: 10, step: 0.01 },
  rotation: { step: 1 },
  z: { step: 1 },
  rotationX: { step: 1 },
  rotationY: { step: 1 },
  rotationZ: { step: 1 },
  perspective: { min: 0, step: 1 },
  skewX: { min: -90, max: 90, step: 1 },
  skewY: { min: -90, max: 90, step: 1 },
  width: { min: 0, step: 1 },
  height: { min: 0, step: 1 },
  borderRadius: { min: 0, step: 1 },
  x: { step: 1 },
  y: { step: 1 },
  fontSize: { min: 1, step: 1 },
  letterSpacing: { step: 0.1 },
  innerText: { step: 1 },
};

export function clampPropertyValue(prop: string, value: number): number {
  const constraint = PROP_CONSTRAINTS[prop];
  if (!constraint) return value;
  let clamped = value;
  if (constraint.min !== undefined) clamped = Math.max(constraint.min, clamped);
  if (constraint.max !== undefined) clamped = Math.min(constraint.max, clamped);
  return clamped;
}

export const ADD_METHODS = ["to", "from", "fromTo", "set"] as const;

export const ADD_METHOD_LABELS: Record<string, string> = {
  to: "Animate",
  from: "Animate In",
  fromTo: "From → To",
  set: "Set Instantly",
};
