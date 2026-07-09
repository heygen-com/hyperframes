import { resolveEase } from "@hyperframes/core";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/parsers";
import { parseAttrWrapper } from "./attr.ts";
import { rawText } from "./text.ts";
import { addUniqueNote, note, statusFor } from "./notes.ts";
import { parseDirectRegistrationPostamble, parseRegistrationPostamble } from "./registration.ts";
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
  addParsedReasons(script, parsed, reasons);
  addAnimationReasons(parsed.animations, reasons, warnings);
  if (parseRegistration(parsed) === null) {
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

// fallow-ignore-next-line complexity
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
  if (parsed.unsupportedTimelineControls) {
    addUniqueNote(
      reasons,
      note("computed-timeline", "timeline call/add/addPause is not rewritten safely"),
    );
  }
  const tweenBodies = gsapTweenArgumentSources(
    script,
    parsed.sourceTimelineVar ?? parsed.timelineVar,
  );
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

// fallow-ignore-next-line complexity
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

type ParenScanState = "code" | "lineComment" | "blockComment" | "string";

interface ParenScanResult {
  state: ParenScanState;
  quote: string;
  escaped: boolean;
  skipNext: boolean;
}

function scanResult(
  state: ParenScanState,
  quote: string,
  escaped = false,
  skipNext = false,
): ParenScanResult {
  return { state, quote, escaped, skipNext };
}

function lineCommentTransition(char: string, quote: string): ParenScanResult {
  const ends = char === "\n" || char === "\r";
  return scanResult(ends ? "code" : "lineComment", quote);
}

function blockCommentTransition(char: string, next: string, quote: string): ParenScanResult {
  if (char === "*" && next === "/") return scanResult("code", quote, false, true);
  return scanResult("blockComment", quote);
}

// fallow-ignore-next-line complexity
function stringTransition(char: string, quote: string, escaped: boolean): ParenScanResult {
  if (escaped) return scanResult("string", quote);
  if (char === "\\") return scanResult("string", quote, true);
  if (char === quote) return scanResult("code", "");
  return scanResult("string", quote);
}

// fallow-ignore-next-line complexity
function codeTransition(char: string, next: string, quote: string): ParenScanResult {
  if (char === "/" && next === "/") return scanResult("lineComment", quote, false, true);
  if (char === "/" && next === "*") return scanResult("blockComment", quote, false, true);
  if (char === "'" || char === '"' || char === "`") return scanResult("string", char);
  return scanResult("code", quote);
}

function updateScanState(
  state: ParenScanState,
  char: string,
  next: string,
  quote: string,
  escaped: boolean,
): ParenScanResult {
  if (state === "lineComment") return lineCommentTransition(char, quote);
  if (state === "blockComment") return blockCommentTransition(char, next, quote);
  if (state === "string") return stringTransition(char, quote, escaped);
  return codeTransition(char, next, quote);
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

// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
function addParsedReasons(script: string, parsed: ParsedGsap, reasons: ClassificationNote[]): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(parsed.timelineVar)) {
    addUniqueNote(reasons, note("computed-timeline", "timeline is not a simple identifier"));
  }
  if (parsed.multipleTimelines || parsed.unsupportedTimelinePattern) {
    addUniqueNote(reasons, note("computed-timeline", "multiple or unsupported timelines"));
  }
  if (parsed.animations.length === 0 && appearsToContainTweenSyntax(script)) {
    addUniqueNote(
      reasons,
      note(
        "computed-timeline",
        "parser resolved zero animations from a script that appears to contain tweens",
      ),
    );
  }
  if (parsed.registrationId && parsed.animations.length === 0) {
    addUniqueNote(reasons, note("computed-timeline", "empty direct-registration timeline"));
  }
}

function appearsToContainTweenSyntax(script: string): boolean {
  return /\.\s*(?:fromTo|from|to|set)\s*\(/.test(script);
}

// fallow-ignore-next-line complexity
function addStructureReasons(animation: GsapAnimation, reasons: ClassificationNote[]): void {
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
  if (isNonSelectorTarget(animation.targetSelector)) {
    addUniqueNote(
      reasons,
      note("non-selector-target", "tween target is not a CSS selector string"),
    );
  }
}

function addAnimationReasons(
  animations: GsapAnimation[],
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): void {
  for (const animation of animations) {
    addStructureReasons(animation, reasons);
    addPropertyReasons(animation, reasons, warnings);
    addExtraReasons(animation, reasons, warnings);
    addEaseReasons(animation, reasons, warnings);
  }
}

function hasReason(reasons: ClassificationNote[], code: string): boolean {
  return reasons.some((reason) => reason.code === code);
}

// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegistration(parsed: ParsedGsap) {
  if (parsed.registrationId) {
    return parseDirectRegistrationPostamble(parsed.postamble, parsed.registrationId);
  }
  return parseRegistrationPostamble(parsed.postamble, parsed.timelineVar);
}
