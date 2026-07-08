import { resolveEase } from "@hyperframes/core";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/parsers";
import { parseAttrWrapper } from "./attr.ts";
import { addUniqueNote, note, statusFor } from "./notes.ts";
import { parseRegistrationPostamble } from "./registration.ts";
import type { ClassificationNote, CodemodClassification } from "./types.ts";

const ALLOWED_EXTRAS = new Set(["stagger", "repeat", "yoyo"]);
const PLUGIN_NAMES = [
  "ScrollTrigger",
  "Draggable",
  "Flip",
  "TextPlugin",
  "DrawSVGPlugin",
  "MorphSVGPlugin",
  "Physics2DPlugin",
  "CustomWiggle",
];

export function classifyGsapScript(script: string, parsed: ParsedGsap): CodemodClassification {
  const reasons: ClassificationNote[] = [];
  const warnings: ClassificationNote[] = [];

  addRawSourceReasons(script, parsed, reasons);
  addParsedReasons(parsed, reasons);
  addAnimationReasons(parsed.animations, reasons, warnings);
  if (parseRegistrationPostamble(parsed.postamble, parsed.timelineVar) === null) {
    addUniqueNote(
      reasons,
      note("unrecognized-postamble", "postamble is not only timeline registration"),
    );
  }

  return {
    status: statusFor(reasons, warnings),
    reasons,
    warnings,
    parsed,
  };
}

function addRawSourceReasons(
  script: string,
  parsed: ParsedGsap,
  reasons: ClassificationNote[],
): void {
  if (/SplitText/i.test(script) || hasHandRolledTextSplit(script)) {
    addUniqueNote(
      reasons,
      note("splitText", "SplitText or hand-rolled text splitting feeds the timeline"),
    );
  }
  if (/CustomEase\.create\s*\(/.test(script)) {
    addUniqueNote(
      reasons,
      note("customEase-beyond-shim", "CustomEase registrations are outside the inline path shim"),
    );
  }
  if (/MotionPathPlugin|motionPath\s*:/.test(script)) {
    addUniqueNote(reasons, note("motionPath", "motionPath requires manual conversion"));
  }
  if (hasAdvancedGsapUtils(script)) {
    addUniqueNote(reasons, note("gsap-utils-advanced", "gsap.utils usage beyond toArray"));
  }
  if (hasTimelineControlCall(script, parsed.timelineVar)) {
    addUniqueNote(
      reasons,
      note("computed-timeline", "timeline call/add/addPause is not rewritten safely"),
    );
  }
  const tweenBodies = gsapTweenArgumentSources(script, parsed.timelineVar);
  if (tweenBodies.some(hasTweenCallback)) {
    addUniqueNote(
      reasons,
      note("computed-timeline", "timeline callback properties need manual review"),
    );
  }
  if (tweenBodies.some((body) => /\bdelay\s*:/.test(body))) {
    addUniqueNote(
      reasons,
      note("computed-timeline", "GSAP delay is not represented in parsed placement data"),
    );
  }
  addPluginReasons(script, reasons);
}

function hasTimelineControlCall(script: string, timelineVar: string): boolean {
  const escapedVar = escapeRegExp(timelineVar);
  return new RegExp(`\\b${escapedVar}\\s*\\.\\s*(?:call|add|addPause)\\s*\\(`).test(script);
}

function gsapTweenArgumentSources(script: string, timelineVar: string): string[] {
  const escapedVar = escapeRegExp(timelineVar);
  const calls = new RegExp(
    `(?:\\b${escapedVar}\\s*\\.\\s*(?:fromTo|from|to|set)|\\bgsap\\s*\\.\\s*set)\\s*\\(`,
    "g",
  );
  const bodies: string[] = [];
  for (const match of script.matchAll(calls)) {
    const start = match.index ?? 0;
    const open = script.indexOf("(", start);
    const close = findMatchingParen(script, open);
    if (close !== null) bodies.push(script.slice(open + 1, close));
  }
  return bodies;
}

function findMatchingParen(source: string, open: number): number | null {
  if (open < 0) return null;
  let depth = 0;
  let state: "code" | "lineComment" | "blockComment" | "string" = "code";
  let quote = "";
  let escaped = false;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    const stateResult = updateScanState(state, char, next, quote, escaped);
    state = stateResult.state;
    quote = stateResult.quote;
    escaped = stateResult.escaped;
    if (stateResult.skipNext) index += 1;
    if (state !== "code") continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function updateScanState(
  state: "code" | "lineComment" | "blockComment" | "string",
  char: string,
  next: string,
  quote: string,
  escaped: boolean,
): {
  state: "code" | "lineComment" | "blockComment" | "string";
  quote: string;
  escaped: boolean;
  skipNext: boolean;
} {
  if (state === "lineComment") {
    return char === "\n" || char === "\r"
      ? { state: "code", quote, escaped: false, skipNext: false }
      : { state, quote, escaped: false, skipNext: false };
  }
  if (state === "blockComment") {
    return char === "*" && next === "/"
      ? { state: "code", quote, escaped: false, skipNext: true }
      : { state, quote, escaped: false, skipNext: false };
  }
  if (state === "string") {
    if (escaped) return { state, quote, escaped: false, skipNext: false };
    if (char === "\\") return { state, quote, escaped: true, skipNext: false };
    if (char === quote) return { state: "code", quote: "", escaped: false, skipNext: false };
    return { state, quote, escaped: false, skipNext: false };
  }
  if (char === "/" && next === "/")
    return { state: "lineComment", quote, escaped: false, skipNext: true };
  if (char === "/" && next === "*")
    return { state: "blockComment", quote, escaped: false, skipNext: true };
  if (char === "'" || char === '"' || char === "`")
    return { state: "string", quote: char, escaped: false, skipNext: false };
  return { state, quote, escaped: false, skipNext: false };
}

function hasTweenCallback(source: string): boolean {
  return /\b(onComplete|onStart|onUpdate|onRepeat|onReverseComplete)\s*(?::|\()/.test(source);
}

function hasHandRolledTextSplit(script: string): boolean {
  return (
    /\.split\s*\(\s*["'](?:\s?|)["']\s*\)/.test(script) &&
    /chars|words|createElement|innerHTML/.test(script)
  );
}

function hasAdvancedGsapUtils(script: string): boolean {
  for (const match of script.matchAll(/gsap\.utils\.([A-Za-z_$][\w$]*)/g)) {
    if (match[1] !== "toArray") return true;
  }
  return false;
}

function addPluginReasons(script: string, reasons: ClassificationNote[]): void {
  if (/gsap\.registerPlugin\s*\([^)]*CustomEase/.test(script)) {
    addUniqueNote(
      reasons,
      note("customEase-beyond-shim", "registered CustomEase name needs manual review"),
    );
  }
  if (/gsap\.registerPlugin\s*\([^)]*MotionPathPlugin/.test(script)) {
    addUniqueNote(reasons, note("motionPath", "registered MotionPathPlugin needs manual review"));
  }
  for (const plugin of PLUGIN_NAMES) {
    if (new RegExp(`\\b${plugin}\\b`).test(script)) {
      addUniqueNote(
        reasons,
        note(`plugin:${plugin}`, `${plugin} plugin usage needs manual review`),
      );
    }
  }
}

function addParsedReasons(parsed: ParsedGsap, reasons: ClassificationNote[]): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(parsed.timelineVar)) {
    addUniqueNote(reasons, note("computed-timeline", "timeline is not a simple identifier"));
  }
  if (parsed.multipleTimelines || parsed.unsupportedTimelinePattern) {
    addUniqueNote(reasons, note("computed-timeline", "multiple or unsupported timelines"));
  }
}

function addAnimationReasons(
  animations: GsapAnimation[],
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): void {
  for (const animation of animations) {
    if (animation.arcPath)
      addUniqueNote(reasons, note("motionPath", "motionPath requires manual conversion"));
    if (
      (animation.hasUnresolvedKeyframes || animation.hasUnresolvedSelector) &&
      !hasReason(reasons, "splitText")
    ) {
      addUniqueNote(reasons, note("computed-timeline", "unresolved selector or keyframes"));
    }
    if (animation.keyframes && !animation.extras?.stagger && !animation.arcPath) {
      addUniqueNote(reasons, note("keyframes", "native GSAP keyframes need manual review"));
    }
    if (animation.resolvedStart === undefined) {
      addUniqueNote(reasons, note("computed-timeline", "animation start could not be resolved"));
    }
    if (animation.provenance && animation.provenance.kind !== "literal") {
      addUniqueNote(reasons, note("computed-timeline", "computed timeline construction"));
    }
    if (isNonSelectorTarget(animation.targetSelector)) {
      addUniqueNote(
        reasons,
        note("non-selector-target", "tween target is not a CSS selector string"),
      );
    }
    addPropertyReasons(animation, reasons, warnings);
    addExtraReasons(animation, reasons, warnings);
    addEaseReasons(animation, reasons, warnings);
  }
}

function hasReason(reasons: ClassificationNote[], code: string): boolean {
  return reasons.some((reason) => reason.code === code);
}

function addPropertyReasons(
  animation: GsapAnimation,
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): void {
  for (const [key, value] of propertyEntries(animation)) {
    if (key === "attr" && parseAttrWrapper(value) === null) {
      addUniqueNote(reasons, note("attr-wrapper", "GSAP attr wrapper is not statically literal"));
    }
    if (key === "autoAlpha") {
      addUniqueNote(
        warnings,
        note("autoAlpha-expansion", "autoAlpha expands to opacity and visibility"),
      );
    }
    if (key === "transformPerspective") {
      addUniqueNote(
        warnings,
        note("transformPerspective-perspective", "transformPerspective maps to CSS perspective"),
      );
    }
  }
}

function propertyEntries(animation: GsapAnimation): Array<[string, number | string]> {
  return [
    ...Object.entries(animation.properties),
    ...Object.entries(animation.fromProperties ?? {}),
  ];
}

function isNonSelectorTarget(selector: string): boolean {
  return selector === "dwell/hold" || selector.startsWith("proxy ");
}

function addExtraReasons(
  animation: GsapAnimation,
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): void {
  for (const key of Object.keys(animation.extras ?? {})) {
    if (!ALLOWED_EXTRAS.has(key)) {
      addUniqueNote(reasons, note("unsupported-extra", `Unsupported GSAP extra: ${key}`));
    }
  }
  const repeat = animation.extras?.repeat;
  if (isInfiniteRepeat(repeat)) {
    addUniqueNote(
      warnings,
      note("infinite-repeat", "repeat:-1 or repeat:Infinity creates an infinite loop"),
    );
  }
}

function isInfiniteRepeat(value: unknown): boolean {
  const raw = rawText(value);
  return raw === "-1" || raw === "Infinity";
}

function addEaseReasons(
  animation: GsapAnimation,
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): void {
  const eases = animationEases(animation);
  for (const ease of eases) {
    if (isEaseShimDivergence(ease)) {
      addUniqueNote(warnings, note("ease-shim-divergence", "ease shim divergence"));
    }
    const resolved = resolveEase(ease);
    if (resolved.warning) {
      addUniqueNote(
        reasons,
        note(
          "customEase-beyond-shim",
          `Unrecognized or fallback ease needs manual review: ${ease}`,
        ),
      );
    }
  }
}

function animationEases(animation: GsapAnimation): string[] {
  const eases: string[] = [];
  if (animation.ease) eases.push(animation.ease);
  const keyframes = animation.keyframes;
  if (keyframes?.ease) eases.push(keyframes.ease);
  if (keyframes?.easeEach) eases.push(keyframes.easeEach);
  for (const keyframe of keyframes?.keyframes ?? []) {
    if (keyframe.ease) eases.push(keyframe.ease);
  }
  return eases;
}

function isEaseShimDivergence(ease: string): boolean {
  const compact = ease.trim().replace(/\s+/g, "").toLowerCase();
  return compact.startsWith("expo.") || /^steps\(\d+\)$/.test(compact);
}

function rawText(value: unknown): string | null {
  if (typeof value === "string")
    return value.startsWith("__raw:") ? value.slice(6).trim() : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
