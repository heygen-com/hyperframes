/**
 * Recast-free GSAP helpers: serialization, keyframe<->animation conversion,
 * validation, and shared types.
 *
 * This module MUST NOT import recast / @babel/parser. It is part of the
 * isomorphic core layer that the barrel and browser code depend on. AST
 * parsing of GSAP source lives in the Node-only `./gsapParser` module.
 */
import type { Keyframe, KeyframeProperties, ValidationResult } from "../core.types";
import type { PropertyGroupName } from "./gsapConstants";

export type GsapMethod = "set" | "to" | "from" | "fromTo";

/** How a tween was constructed in source — drives display classification and editability. */
export type GsapProvenanceKind = "literal" | "helper" | "loop" | "runtime-dynamic";

/**
 * Origin of a parsed tween. `literal` tweens map 1:1 to a source call and edit
 * directly; `helper`/`loop` tweens are expanded from a reused construct (unroll
 * to edit); `runtime-dynamic` tweens come from live introspection (override to
 * edit). Absent provenance is treated as `literal`.
 */
export interface GsapProvenance {
  kind: GsapProvenanceKind;
  /** Helper function name (kind === "helper"). */
  fn?: string;
  /** 1-based ordinal of the originating call site / loop construct in source order. */
  callSite?: number;
  /** 0-based iteration index (kind === "loop"). */
  iteration?: number;
  /** Source offset [start, end] of the originating call/loop, when known. */
  sourceRange?: [number, number];
}

/** How a tween's keyframes can be edited, derived from its provenance. */
export type KeyframeEditability = "direct" | "unroll" | "source";

/**
 * Map provenance to an editing strategy:
 * - `direct` — literal tween, maps 1:1 to source; edit in place.
 * - `unroll` — helper/loop expansion; unroll to literal tweens, then edit.
 * - `source` — runtime-dynamic value; not statically editable, edit the code.
 */
export function editabilityForProvenance(provenance?: GsapProvenance): KeyframeEditability {
  if (!provenance || provenance.kind === "literal") return "direct";
  if (provenance.kind === "runtime-dynamic") return "source";
  return "unroll";
}

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
  /** Arc motion path config — present when the tween uses motionPath for curved position interpolation. */
  arcPath?: ArcPathConfig;
  /** True when the tween has a `keyframes` property that couldn't be statically resolved (dynamic). */
  hasUnresolvedKeyframes?: boolean;
  /** True when the tween's target selector couldn't be statically resolved (dynamic). */
  hasUnresolvedSelector?: boolean;
  /** Absolute start time computed by walking the timeline chain (handles +=, -=, <, >, labels). */
  resolvedStart?: number;
  /** True when no position arg was authored — the tween is sequentially placed by GSAP. */
  implicitPosition?: boolean;
  /** Which property group this tween belongs to (position, scale, size, rotation, visual, other).
   *  Undefined for legacy mixed tweens that bundle multiple groups. */
  propertyGroup?: PropertyGroupName;
  /** How this tween was constructed in source. Absent ⇒ literal. */
  provenance?: GsapProvenance;
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

export interface ArcPathSegment {
  curviness: number;
  cp1?: { x: number; y: number };
  cp2?: { x: number; y: number };
}

export interface ArcPathConfig {
  enabled: boolean;
  autoRotate: boolean | number;
  segments: ArcPathSegment[];
}

export interface MotionPathShape {
  arcPath: ArcPathConfig;
  waypoints: Array<{ x: number; y: number }>;
}

/**
 * Build arcPath segments + waypoints from resolved path coordinates. Shared by
 * the AST parser (coords from literal nodes) and the runtime scanner (coords
 * from a live `vars.motionPath`), so both produce identical arc config.
 */
export function buildArcPath(
  coords: Array<{ x: number; y: number }>,
  curviness: number,
  autoRotate: boolean | number,
  isCubic: boolean,
): MotionPathShape | undefined {
  const first = coords[0];
  if (coords.length < 2 || !first) return undefined;
  const segments: ArcPathSegment[] = [];
  let waypoints: Array<{ x: number; y: number }>;
  if (isCubic && coords.length >= 4) {
    // coords are [anchor, cp1, cp2, anchor, cp1, cp2, anchor, ...].
    waypoints = [first];
    for (let i = 1; i + 2 < coords.length; i += 3) {
      const cp1 = coords[i];
      const cp2 = coords[i + 1];
      const anchor = coords[i + 2];
      if (!cp1 || !cp2 || !anchor) continue;
      waypoints.push(anchor);
      segments.push({ curviness, cp1, cp2 });
    }
  } else {
    waypoints = coords;
    for (let i = 0; i < waypoints.length - 1; i++) segments.push({ curviness });
  }
  return { arcPath: { enabled: true, autoRotate, segments }, waypoints };
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

// ── Split-animation types (used by gsapWriterAcorn) ─────────────────────────

export interface SplitAnimationsOptions {
  originalId: string;
  newId: string;
  splitTime: number;
  elementStart: number;
  elementDuration: number;
}

export interface SplitAnimationsResult {
  script: string;
  /** Non-ID-selector animations that the engine cannot safely retarget. */
  skippedSelectors: string[];
}

// ── Serialization ───────────────────────────────────────────────────────────

export function serializeGsapAnimations(
  animations: GsapAnimation[],
  timelineVar = "tl",
  options?: { includeMediaSync?: boolean; preamble?: string; postamble?: string },
): string {
  const sorted = [...animations].sort((a, b) => {
    const aNum =
      a.resolvedStart ?? (typeof a.position === "number" ? a.position : Number.MAX_SAFE_INTEGER);
    const bNum =
      b.resolvedStart ?? (typeof b.position === "number" ? b.position : Number.MAX_SAFE_INTEGER);
    return aNum - bNum;
  });
  // fallow-ignore-next-line complexity
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

export function serializeValue(value: unknown): string {
  if (typeof value === "string" && value.startsWith("__raw:")) {
    return value.slice(6);
  }
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function safeJsKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function serializeObject(obj: Record<string, number | string>): string {
  const entries = Object.entries(obj).map(([key, value]) => {
    return `${safeJsKey(key)}: ${serializeValue(value)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function serializeExtras(extras: Record<string, unknown>): string {
  return Object.entries(extras)
    .map(([key, value]) => {
      return `${safeJsKey(key)}: ${serializeValue(value)}`;
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
  { pattern: /\.addPause\s*\(/, message: "addPause() method not allowed" },
  { pattern: /gsap\.registerEffect\s*\(/, message: "registerEffect() not allowed" },
  { pattern: /ScrollTrigger/, message: "ScrollTrigger not allowed" },
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

  // fallow-ignore-next-line complexity
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

  return (
    animations
      .filter(
        (a): a is GsapAnimation & { position: number } =>
          validMethods.includes(a.method) && typeof a.position === "number",
      )
      // fallow-ignore-next-line complexity
      .map((a) => {
        const relativeTimeRaw = a.position - elementStartTime;
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
      .filter((kf): kf is NonNullable<typeof kf> => kf !== null)
  );
}

// ── Keyframe-conversion transforms (pure; shared by recast + acorn writers) ────

/**
 * CSS identity values for properties whose "rest" state isn't 0 — used to
 * synthesize the missing endpoint when converting a flat tween to keyframes.
 */
const CSS_IDENTITY: Record<string, number> = {
  opacity: 1,
  autoAlpha: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
};

function cssIdentityValue(prop: string): number {
  return CSS_IDENTITY[prop] ?? 0;
}

/** Build the identity-endpoint map for a flat tween's properties. */
function buildIdentityMap(props: Record<string, number | string>): Record<string, number | string> {
  const identity: Record<string, number | string> = {};
  for (const [key, val] of Object.entries(props)) {
    if (val != null) identity[key] = typeof val === "number" ? cssIdentityValue(key) : val;
  }
  return identity;
}

/**
 * Resolve the 0% (from) and 100% (to) property maps for a tween being
 * converted to percentage keyframes.
 *
 * @param resolvedFromValues — Despite the "from" in the name (historical), these
 *   are runtime-captured DOM values that override the conversion endpoint:
 *   - For to():    overrides fromProps (the 0% state / where the element is now).
 *   - For from():  overrides toProps  (the 100% state / where the element rests).
 *   - For fromTo(): merges into toProps (the 100% endpoint the user is editing).
 */
export function resolveConversionProps(
  anim: GsapAnimation,
  resolvedFromValues?: Record<string, number | string>,
): { fromProps: Record<string, number | string>; toProps: Record<string, number | string> } {
  if (anim.method === "to") {
    const identity = buildIdentityMap(anim.properties);
    const fromProps = resolvedFromValues ? { ...identity, ...resolvedFromValues } : identity;
    return { fromProps, toProps: { ...anim.properties } };
  }
  if (anim.method === "from") {
    const identity = buildIdentityMap(anim.properties);
    const toProps = resolvedFromValues ? { ...identity, ...resolvedFromValues } : identity;
    return { fromProps: { ...anim.properties }, toProps };
  }
  // fromTo(fromVars, toVars): anim.fromProperties = fromVars (0% state),
  // anim.properties = toVars (100% state). resolvedFromValues contains the
  // current DOM position from a drag — it represents the NEW destination, so
  // it merges into toProps (the 100% endpoint the user is editing), NOT into
  // fromProps. This is intentional and not inverted.
  const toProps = resolvedFromValues
    ? { ...anim.properties, ...resolvedFromValues }
    : { ...anim.properties };
  return { fromProps: { ...(anim.fromProperties ?? {}) }, toProps };
}

// ── Arc path serialization helpers (shared by recast + acorn writers) ─────────

function numericXY(props: Record<string, number | string>): { x: number; y: number } | null {
  const vx = props.x;
  const vy = props.y;
  return typeof vx === "number" && typeof vy === "number" ? { x: vx, y: vy } : null;
}

export function extractArcWaypoints(anim: GsapAnimation): Array<{ x: number; y: number }> {
  const keyframeWps = (anim.keyframes?.keyframes ?? [])
    .map((kf) => numericXY(kf.properties))
    .filter((pt): pt is { x: number; y: number } => pt !== null);
  if (keyframeWps.length >= 2) return keyframeWps;
  const propX = anim.properties.x;
  const propY = anim.properties.y;
  if (typeof propX !== "number" && typeof propY !== "number") return keyframeWps;
  const destX = typeof propX === "number" ? propX : 0;
  const destY = typeof propY === "number" ? propY : 0;
  return [
    { x: 0, y: 0 },
    { x: destX, y: destY },
  ];
}

function autoRotateSuffix(autoRotate: boolean | number): string {
  if (autoRotate === true) return ", autoRotate: true";
  if (typeof autoRotate === "number") return `, autoRotate: ${autoRotate}`;
  return "";
}

function cubicControlPoints(
  seg: ArcPathSegment,
  wp: { x: number; y: number },
  nextWp: { x: number; y: number },
): string[] {
  if (seg.cp1 && seg.cp2) {
    return [`{x: ${seg.cp1.x}, y: ${seg.cp1.y}}`, `{x: ${seg.cp2.x}, y: ${seg.cp2.y}}`];
  }
  const dx = nextWp.x - wp.x;
  const dy = nextWp.y - wp.y;
  const c = seg.curviness ?? 1;
  return [
    `{x: ${wp.x + dx * 0.33}, y: ${wp.y + dy * 0.33 - c * Math.abs(dx) * 0.25}}`,
    `{x: ${wp.x + dx * 0.66}, y: ${wp.y + dy * 0.66 - c * Math.abs(dx) * 0.25}}`,
  ];
}

function buildCubicPathEntries(
  waypoints: Array<{ x: number; y: number }>,
  segments: ArcPathSegment[],
): string[] {
  const first = waypoints[0];
  if (!first) return [];
  const entries = [`{x: ${first.x}, y: ${first.y}}`];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const wp = waypoints[i];
    const nextWp = waypoints[i + 1];
    if (!seg || !wp || !nextWp) continue;
    entries.push(...cubicControlPoints(seg, wp, nextWp));
    entries.push(`{x: ${nextWp.x}, y: ${nextWp.y}}`);
  }
  return entries;
}

export function buildMotionPathObjectCode(config: {
  waypoints: Array<{ x: number; y: number }>;
  segments: ArcPathSegment[];
  autoRotate: boolean | number;
}): string {
  const { waypoints, segments, autoRotate } = config;
  const arSuffix = autoRotateSuffix(autoRotate);
  // GSAP's simple `path` array supports only ONE scalar `curviness` for the whole
  // path, so per-segment curviness can only be expressed in the cubic form (each
  // segment's curviness baked into its control points). Emit cubic when segments
  // carry explicit control points OR when their curviness values differ — the
  // simple branch would otherwise serialize only segments[0].curviness and drop
  // every other segment's curve.
  const hasExplicitCp = segments.some((s) => s.cp1 && s.cp2);
  const curvinessVaries = segments.some(
    (s) => (s.curviness ?? 1) !== (segments[0]?.curviness ?? 1),
  );
  if ((hasExplicitCp || curvinessVaries) && waypoints.length >= 2) {
    const pathStr = buildCubicPathEntries(waypoints, segments).join(", ");
    return `{ path: [${pathStr}], type: "cubic"${arSuffix} }`;
  }
  const pathEntries = waypoints.map((wp) => `{x: ${wp.x}, y: ${wp.y}}`);
  const curviness = segments[0]?.curviness ?? 1;
  const curvPart = curviness !== 1 ? `, curviness: ${curviness}` : "";
  return `{ path: [${pathEntries.join(", ")}]${curvPart}${arSuffix} }`;
}
