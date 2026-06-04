/**
 * Recast-free GSAP helpers: serialization, keyframe<->animation conversion,
 * validation, and shared types.
 *
 * This module MUST NOT import recast / @babel/parser. It is part of the
 * isomorphic core layer that the barrel and browser code depend on. AST
 * parsing of GSAP source lives in the Node-only `./gsapParser` module.
 */
import type { Keyframe, KeyframeProperties, ValidationResult } from "../core.types";

export type GsapMethod = "set" | "to" | "from" | "fromTo";

export interface GsapAnimation {
  id: string;
  targetSelector: string;
  method: GsapMethod;
  position: number | string;
  properties: Record<string, number | string>;
  fromProperties?: Record<string, number | string>;
  duration?: number;
  ease?: string;
  /** Non-editable GSAP config (stagger, yoyo, repeat, etc.) preserved for round-trips. */
  extras?: Record<string, unknown>;
  /** Native GSAP keyframes data — present when the tween uses keyframes: { ... }. */
  keyframes?: GsapKeyframesData;
  /** True when the tween has a `keyframes` property that couldn't be statically resolved (dynamic). */
  hasUnresolvedKeyframes?: boolean;
  /** True when the tween's target selector couldn't be statically resolved (dynamic). */
  hasUnresolvedSelector?: boolean;
}

export interface GsapPercentageKeyframe {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}

export type GsapKeyframeFormat = "percentage" | "object-array" | "simple-array";

export interface GsapKeyframesData {
  format: GsapKeyframeFormat;
  keyframes: GsapPercentageKeyframe[];
  ease?: string;
  easeEach?: string;
}

export interface ParsedGsap {
  animations: GsapAnimation[];
  timelineVar: string;
  preamble: string;
  postamble: string;
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
}

export { SUPPORTED_PROPS, SUPPORTED_EASES } from "./gsapConstants";

// ── Serialization ───────────────────────────────────────────────────────────

export function serializeGsapAnimations(
  animations: GsapAnimation[],
  timelineVar = "tl",
  options?: { includeMediaSync?: boolean; preamble?: string; postamble?: string },
): string {
  const sorted = [...animations].sort((a, b) => {
    const aNum = typeof a.position === "number" ? a.position : Number.MAX_SAFE_INTEGER;
    const bNum = typeof b.position === "number" ? b.position : Number.MAX_SAFE_INTEGER;
    return aNum - bNum;
  });
  const lines = sorted.map((anim) => {
    const selector = `"${anim.targetSelector}"`;
    const props: Record<string, number | string> = { ...anim.properties };
    if (anim.duration !== undefined) props.duration = anim.duration;
    if (anim.ease) props.ease = anim.ease;
    let propsStr = serializeObject(props);
    if (anim.extras && Object.keys(anim.extras).length > 0) {
      const extrasStr = serializeExtras(anim.extras);
      if (Object.keys(props).length === 0) {
        propsStr = `{ ${extrasStr} }`;
      } else {
        // Insert extras before the closing brace
        propsStr = propsStr.slice(0, -2) + `, ${extrasStr} }`;
      }
    }
    const posStr = typeof anim.position === "string" ? `"${anim.position}"` : anim.position;
    switch (anim.method) {
      case "set":
        return `    ${timelineVar}.set(${selector}, ${propsStr}, ${posStr});`;
      case "to":
        return `    ${timelineVar}.to(${selector}, ${propsStr}, ${posStr});`;
      case "from":
        return `    ${timelineVar}.from(${selector}, ${propsStr}, ${posStr});`;
      case "fromTo": {
        const fromStr = serializeObject(anim.fromProperties || {});
        return `    ${timelineVar}.fromTo(${selector}, ${fromStr}, ${propsStr}, ${posStr});`;
      }
    }
  });

  let mediaSync = "";
  if (options?.includeMediaSync) {
    mediaSync = `
    ${timelineVar}.eventCallback("onUpdate", function() {
      const time = ${timelineVar}.time();
      document.querySelectorAll("video[data-start], audio[data-start]").forEach(function(media) {
        const start = parseFloat(media.dataset.start);
        const end = parseFloat(media.dataset.end) || Infinity;
        const mediaTime = time - start;
        if (time >= start && time < end) {
          if (Math.abs(media.currentTime - mediaTime) > 0.1) {
            media.currentTime = mediaTime;
          }
          if (media.paused && !${timelineVar}.paused()) {
            media.play().catch(function() {});
          }
        } else if (!media.paused) {
          media.pause();
        }
      });
    });`;
  }

  const preamble = options?.preamble || `const ${timelineVar} = gsap.timeline({ paused: true });`;
  const postamble = options?.postamble ? `\n    ${options.postamble}` : "";

  return `
    ${preamble}
${lines.join("\n")}${mediaSync}${postamble}
  `;
}

function serializeValue(value: unknown): string {
  if (typeof value === "string" && value.startsWith("__raw:")) {
    return value.slice(6);
  }
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function serializeObject(obj: Record<string, number | string>): string {
  const entries = Object.entries(obj).map(([key, value]) => {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    return `${safeKey}: ${serializeValue(value)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function serializeExtras(extras: Record<string, unknown>): string {
  return Object.entries(extras)
    .map(([key, value]) => {
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      return `${safeKey}: ${serializeValue(value)}`;
    })
    .join(", ");
}

// ── Element filtering ─────────────────────────────────────────────────────────

/**
 * Filter animations to those targeting `#<elementId>` (id-only match). For the
 * studio panel's id-OR-selector matching, see `getAnimationsForElement` in
 * `useGsapTweenCache.ts` — distinct on purpose, hence the distinct name.
 */
export function getAnimationsForElementId(
  animations: GsapAnimation[],
  elementId: string,
): GsapAnimation[] {
  const selector = `#${elementId}`;
  return animations.filter((a) => a.targetSelector === selector);
}

// ── Validation (regex-based, no AST needed) ─────────────────────────────────

const FORBIDDEN_GSAP_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\.call\s*\(/, message: "call() method not allowed" },
  { pattern: /\.add\s*\(/, message: "add() method not allowed" },
  { pattern: /\.addLabel\s*\(/, message: "addLabel() method not allowed" },
  { pattern: /\.addPause\s*\(/, message: "addPause() method not allowed" },
  { pattern: /gsap\.registerPlugin\s*\(/, message: "registerPlugin() not allowed" },
  { pattern: /gsap\.registerEffect\s*\(/, message: "registerEffect() not allowed" },
  { pattern: /ScrollTrigger/, message: "ScrollTrigger not allowed" },
  { pattern: /MotionPathPlugin/, message: "MotionPathPlugin not allowed" },
  { pattern: /onComplete\s*:/, message: "onComplete callback not allowed" },
  { pattern: /onUpdate\s*:/, message: "onUpdate callback not allowed" },
  { pattern: /onStart\s*:/, message: "onStart callback not allowed" },
  { pattern: /onRepeat\s*:/, message: "onRepeat callback not allowed" },
  { pattern: /onReverseComplete\s*:/, message: "onReverseComplete callback not allowed" },
  { pattern: /repeat\s*:\s*-1/, message: "Infinite repeat (repeat: -1) not allowed" },
  { pattern: /Math\.random\s*\(/, message: "Random values (Math.random) not allowed" },
  { pattern: /Date\.now\s*\(/, message: "Date-dependent values (Date.now) not allowed" },
  { pattern: /new\s+Date\s*\(/, message: "Date constructor not allowed" },
  { pattern: /setTimeout\s*\(/, message: "setTimeout not allowed" },
  { pattern: /setInterval\s*\(/, message: "setInterval not allowed" },
  { pattern: /requestAnimationFrame\s*\(/, message: "requestAnimationFrame not allowed" },
];

export function validateCompositionGsap(script: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const { pattern, message } of FORBIDDEN_GSAP_PATTERNS) {
    if (pattern.test(script)) errors.push(message);
  }
  if (/yoyo\s*:\s*true/.test(script)) {
    warnings.push("yoyo animations may behave unexpectedly when scrubbing");
  }
  if (/stagger\s*:/.test(script)) {
    warnings.push("stagger animations may not serialize correctly");
  }
  return { valid: errors.length === 0, errors, warnings };
}

// ── Keyframe Conversion Helpers ─────────────────────────────────────────────

export function keyframesToGsapAnimations(
  elementId: string,
  keyframes: Keyframe[],
  elementStartTime: number,
  base?: { x?: number; y?: number; scale?: number },
): GsapAnimation[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const animations: GsapAnimation[] = [];
  const baseX = base?.x ?? 0;
  const baseY = base?.y ?? 0;
  const baseScale = base?.scale ?? 1;

  sorted.forEach((kf, i) => {
    const absoluteTime = elementStartTime + kf.time;
    const isFirst = i === 0;
    const prevKf = i > 0 ? sorted[i - 1] : null;
    const duration = prevKf ? kf.time - prevKf.time : undefined;
    const position = prevKf ? elementStartTime + prevKf.time : absoluteTime;

    const properties: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(kf.properties)) {
      if (typeof value !== "number") continue;
      if (key === "x") properties.x = baseX + value;
      else if (key === "y") properties.y = baseY + value;
      else if (key === "scale") properties.scale = baseScale * value;
      else properties[key] = value;
    }

    animations.push({
      id: `${elementId}-kf-${kf.id}`,
      targetSelector: `#${elementId}`,
      method: isFirst ? "set" : "to",
      position,
      properties,
      duration: isFirst ? undefined : duration,
      ease: kf.ease,
    });
  });

  return animations;
}

export function gsapAnimationsToKeyframes(
  animations: GsapAnimation[],
  elementStartTime: number,
  options?: {
    baseX?: number;
    baseY?: number;
    baseScale?: number;
    clampTimeToZero?: boolean;
    skipBaseSet?: boolean;
  },
): Keyframe[] {
  const validMethods: GsapMethod[] = ["set", "to", "from", "fromTo"];
  const baseX = options?.baseX ?? 0;
  const baseY = options?.baseY ?? 0;
  const baseScale = options?.baseScale ?? 1;
  const clampTimeToZero = options?.clampTimeToZero ?? true;
  const skipBaseSet = options?.skipBaseSet ?? false;
  const baseTimeEpsilon = 0.001;
  const baseValueEpsilon = 0.00001;

  return animations
    .filter((a) => validMethods.includes(a.method) && typeof a.position === "number")
    .map((a) => {
      const relativeTimeRaw = (a.position as number) - elementStartTime;
      const time = clampTimeToZero ? Math.max(0, relativeTimeRaw) : relativeTimeRaw;

      const properties: Partial<KeyframeProperties> = {};
      for (const [key, value] of Object.entries(a.properties)) {
        if (typeof value !== "number") continue;
        if (key === "x") properties.x = value - baseX;
        else if (key === "y") properties.y = value - baseY;
        else if (key === "scale") {
          properties.scale = baseScale !== 0 ? value / baseScale : value;
        } else {
          (properties as Record<string, number>)[key] = value;
        }
      }

      if (
        skipBaseSet &&
        a.method === "set" &&
        time < baseTimeEpsilon &&
        Object.values(properties).every(
          (v) => typeof v === "number" && Math.abs(v) < baseValueEpsilon,
        )
      ) {
        return null;
      }

      return {
        id: a.id.replace(/^.*-kf-/, ""),
        time,
        properties: properties as KeyframeProperties,
        ease: a.ease,
      };
    })
    .filter((kf): kf is NonNullable<typeof kf> => kf !== null) as Keyframe[];
}
