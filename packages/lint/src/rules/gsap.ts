interface LintParsedGsap {
  animations: Array<{
    targetSelector: string;
    targetIdentity?: string;
    method: string;
    position: number | string;
    properties: Record<string, number | string>;
    // fromTo() exposes its first ("from") vars object separately; a layout/reflow prop
    // that appears only here still animates and must be checked.
    fromProperties?: Record<string, number | string>;
    duration?: number;
    ease?: string;
    extras?: Record<string, unknown>;
    resolvedStart?: number;
    /** True for an off-timeline `gsap.set(...)` (applied once at load). */
    global?: boolean;
  }>;
  timelineVar: string;
}

// Use the acorn read parser: it resolves computed timelines (helpers, bounded
// loops) so lint findings like overlapping_gsap_tweens reflect true positions
// instead of all-collapsed-at-0. It's also browser-safe, so this keeps recast
// out of the lint graph entirely. Dynamic import preserves the lazy load.
async function loadParseGsapScript(): Promise<(script: string) => LintParsedGsap> {
  const mod = await import("@hyperframes/parsers/gsap-parser-acorn");
  return mod.parseGsapScriptAcorn as unknown as (script: string) => LintParsedGsap;
}

async function loadGsapScriptMotionPathFirstUseIndex(): Promise<(script: string) => number | null> {
  const mod = await import("@hyperframes/parsers/gsap-parser-acorn");
  return mod.gsapScriptMotionPathFirstUseIndex;
}
import type { LintContext } from "../context";
import type { HyperframeLintFinding, LintRule } from "../types";
import type { OpenTag } from "../utils";
import {
  readAttr,
  readDecodedAttr,
  truncateSnippet,
  stripJsComments,
  stripJsStringLiterals,
  hasCaptionStyles,
  WINDOW_TIMELINE_ASSIGN_PATTERN,
  TIMELINE_REGISTRY_OBJECT_LITERAL_PATTERN,
} from "../utils";
import { collectAllDeclaredVariableIds } from "./composition";

// ── GSAP-specific types ────────────────────────────────────────────────────

type GsapWindow = {
  targetSelector: string;
  targetIdentity?: string;
  position: number;
  end: number;
  properties: string[];
  propertyValues: Record<string, string | number>;
  fromPropertyValues?: Record<string, string | number>;
  overwriteAuto: boolean;
  /** Explicit immediateRender option; undefined keeps the GSAP method default. */
  immediateRender?: boolean;
  method: string;
  /** True for an off-timeline `gsap.set(...)` (applied once at load). */
  global?: boolean;
  raw: string;
};

const SCENE_BOUNDARY_EPSILON_SECONDS = 0.05;

// Sentinel the GSAP parser assigns to a tween whose target it cannot statically
// resolve to a concrete element (a computed variable, a helper call, etc.). It is
// NOT an identity: two distinct unresolved selectors are not the same element, so
// overlap analysis must never treat them as one.
const UNRESOLVED_TARGET = "__unresolved__";

// Parser labels for object-proxy tweens describe their role, not target
// identity. Two independent proxies can both be labelled `dwell/hold` (or the
// same driven DOM channel), so equality cannot prove they conflict.
function targetHasNoStableIdentity(selector: string, identity?: string): boolean {
  if (identity) return false;
  return (
    selector === UNRESOLVED_TARGET || selector === "dwell/hold" || selector.startsWith("proxy → ")
  );
}

// ── GSAP parsing utilities ─────────────────────────────────────────────────

/** Strip a `__raw:` prefix the parser adds to unresolvable values. */
function unwrapRaw(value: unknown): string | number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const code = value.startsWith("__raw:") ? value.slice(6) : value;
  return code.replace(/^\s*["']|["']\s*$/g, "");
}

function extrasNumber(value: unknown): number {
  const unwrapped = unwrapRaw(value);
  const numeric = typeof unwrapped === "number" ? unwrapped : Number(unwrapped);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** A readable single-line snippet of a tween for finding messages. */
function synthesizeWindowRaw(
  timelineVar: string,
  anim: LintParsedGsap["animations"][number],
): string {
  const entries = Object.entries(anim.properties).map(([k, v]) => {
    if (typeof v === "string" && v.startsWith("__raw:")) return `${k}: ${v.slice(6)}`;
    return `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`;
  });
  if (anim.duration !== undefined) entries.push(`duration: ${anim.duration}`);
  if (anim.ease) entries.push(`ease: ${JSON.stringify(anim.ease)}`);
  const pos = typeof anim.position === "number" ? anim.position : JSON.stringify(anim.position);
  return `${timelineVar}.${anim.method}("${anim.targetSelector}", { ${entries.join(", ")} }, ${pos})`;
}

const gsapWindowsCache = new Map<string, GsapWindow[]>();

async function cachedExtractGsapWindows(scriptContent: string): Promise<GsapWindow[]> {
  const cached = gsapWindowsCache.get(scriptContent);
  if (cached) return cached;
  const windows = await extractGsapWindows(scriptContent);
  gsapWindowsCache.set(scriptContent, windows);
  return windows;
}

// fallow-ignore-next-line complexity
async function extractGsapWindows(script: string): Promise<GsapWindow[]> {
  if (!/gsap\.timeline/.test(script)) return [];
  const parseGsapScript = await loadParseGsapScript();
  const parsed = parseGsapScript(script);
  if (parsed.animations.length === 0) return [];

  const windows: GsapWindow[] = [];
  for (const animation of parsed.animations) {
    const start =
      animation.resolvedStart ??
      (typeof animation.position === "number" ? animation.position : null);
    if (start === null) continue;
    const repeat = extrasNumber(animation.extras?.repeat);
    const infiniteRepeat = repeat < 0;
    const cycleCount = infiniteRepeat ? 1 : repeat > 0 ? repeat + 1 : 1;
    const effectiveDuration =
      animation.method === "set" ? 0 : (animation.duration ?? 0) * cycleCount;
    const immediateRender = unwrapRaw(animation.extras?.immediateRender);
    windows.push({
      targetSelector: animation.targetSelector,
      targetIdentity: animation.targetIdentity,
      position: start,
      end:
        infiniteRepeat && animation.method !== "set"
          ? Number.POSITIVE_INFINITY
          : start + effectiveDuration,
      properties: Object.keys(animation.properties),
      propertyValues: animation.properties,
      fromPropertyValues: animation.fromProperties,
      overwriteAuto: unwrapRaw(animation.extras?.overwrite) === "auto",
      immediateRender:
        immediateRender === "true" ? true : immediateRender === "false" ? false : undefined,
      method: animation.method,
      global: animation.global,
      raw: synthesizeWindowRaw(parsed.timelineVar, animation),
    });
  }
  return windows;
}

function numberValue(value: string | number | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function stringValue(value: string | number | undefined): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function zeroValue(value: string | number | undefined): boolean {
  if (typeof value === "number") return value === 0;
  if (typeof value !== "string") return false;
  return Number(value.trim()) === 0;
}

function isGsapColorProperty(property: string): boolean {
  const normalized = property.toLowerCase();
  return (
    !normalized.startsWith("--") &&
    (normalized.endsWith("color") || normalized === "fill" || normalized === "stroke")
  );
}

function collectStaticCssVariableDefinitions(
  tags: readonly OpenTag[],
  styles: LintContext["styles"],
): Set<string> {
  const definitions = new Set<string>();
  const sources = [
    ...styles.map((style) => style.content),
    ...tags.map((tag) => readDecodedAttr(tag.raw, "style") ?? ""),
  ];
  const definitionPattern = /(?:^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/gm;
  for (const source of sources) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const match of withoutComments.matchAll(definitionPattern)) {
      if (match[1]) definitions.add(match[1]);
    }
  }
  for (const id of collectAllDeclaredVariableIds(tags) ?? []) definitions.add(`--${id}`);
  return definitions;
}

function cssVariableReferencesWithoutFallback(value: unknown): string[] {
  const text = unwrapRaw(value);
  if (typeof text !== "string") return [];
  const variables: string[] = [];
  for (const match of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
    if (match[1] && !match[2]) variables.push(match[1]);
  }
  return variables;
}

function isHiddenGsapState(values: Record<string, string | number>): boolean {
  const visibility = stringValue(values.visibility)?.toLowerCase();
  const display = stringValue(values.display)?.toLowerCase();
  return (
    zeroValue(values.opacity) ||
    zeroValue(values.autoAlpha) ||
    visibility === "hidden" ||
    display === "none"
  );
}

function hiddenSetTargetSelectors(target: string, aliases: Map<string, string>): string[] {
  const parts =
    target.startsWith("[") && target.endsWith("]") ? target.slice(1, -1).split(",") : [target];
  return parts
    .flatMap((part) => {
      const trimmed = part.trim();
      const resolved = /^(["'`])([^"'`]+)\1$/.exec(trimmed)?.[2] ?? aliases.get(trimmed);
      return resolved === undefined ? [] : resolved.split(",");
    })
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
}

function extractStandaloneHiddenSelectors(script: string): Set<string> {
  const selectors = new Set<string>();
  const source = stripJsComments(script);
  const functionRanges = collectFunctionBodyRanges(source);
  const aliases = new Map<string, string>();
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`]+)\2\s*;/g,
  )) {
    aliases.set(match[1] ?? "", match[3] ?? "");
  }
  const pattern =
    /gsap\.set\s*\(\s*(\[[^[\]]*\]|"[^"]*"|'[^']*'|`[^`]*`|[^,()[\]]+?)\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // Skip callback/handler bodies; keep IIFEs (they run at parse time).
    if (indexInsideNonIifeRange(match.index, source, functionRanges)) continue;
    const targets = hiddenSetTargetSelectors((match[1] ?? "").trim(), aliases);
    if (targets.length === 0) continue;
    const body = match[2] ?? "";
    if (/(?:opacity|autoAlpha)\s*:\s*0(?:\.0+)?\s*(?:,|$)/.test(body)) {
      for (const selector of targets) selectors.add(selector);
    }
  }
  return selectors;
}

function oneValue(
  values: Record<string, string | number>,
  keys: string[],
): string | number | undefined {
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isVisibleGsapState(values: Record<string, string | number>): boolean {
  const opacity = oneValue(values, ["opacity", "autoAlpha"]);
  if (typeof opacity === "number") return opacity > 0;
  if (typeof opacity === "string" && opacity.trim()) {
    const numeric = Number(opacity);
    if (Number.isFinite(numeric)) return numeric > 0;
  }

  const visibility = stringValue(values.visibility)?.toLowerCase();
  if (visibility === "visible" || visibility === "inherit") return true;

  const display = stringValue(values.display)?.toLowerCase();
  if (display && display !== "none") return true;

  return false;
}

function makesOverlayVisible(win: GsapWindow): boolean {
  if (win.method === "from" && isHiddenGsapState(win.propertyValues)) return true;
  return isVisibleGsapState(win.propertyValues);
}

function findTagEnd(source: string, tag: OpenTag): number {
  const escapedTagName = tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<\\/?${escapedTagName}\\b[^>]*>`, "gi");
  pattern.lastIndex = tag.index;

  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    const isClosing = /^<\s*\//.test(raw);
    const isSelfClosing = /\/\s*>$/.test(raw);
    if (!isClosing && !isSelfClosing) depth += 1;
    if (isClosing) depth -= 1;
    if (depth === 0) return pattern.lastIndex;
  }

  return source.length;
}

// A tag's `class` attribute, split into tokens, but only when it carries the
// `clip` marker class — the common "is this a clip element?" filter used by
// several rules that walk every tag looking for clips.
type ClipTagClasses = { classAttr: string; classes: string[] };

function getClipTagClasses(tag: OpenTag): ClipTagClasses | null {
  const classAttr = readAttr(tag.raw, "class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  return classes.includes("clip") ? { classAttr, classes } : null;
}

function readStyleProperty(style: string, property: string): string | null {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = style.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function cssZero(value: string | null): boolean {
  if (!value) return false;
  return /^0(?:\.0+)?(?:px|%|vw|vh|rem|em)?$/i.test(value.trim());
}

function styleHasHiddenInitialState(style: string): boolean {
  const opacity = readStyleProperty(style, "opacity");
  if (opacity && Number(opacity) === 0) return true;
  if (readStyleProperty(style, "visibility")?.toLowerCase() === "hidden") return true;
  if (readStyleProperty(style, "display")?.toLowerCase() === "none") return true;
  return false;
}

function styleHasOpaqueBackground(style: string): boolean {
  const background =
    readStyleProperty(style, "background") || readStyleProperty(style, "background-color");
  if (!background) return false;
  const normalized = background.toLowerCase().replace(/\s+/g, "");
  if (normalized === "transparent" || normalized === "none") return false;
  if (/rgba?\([^)]*,0(?:\.0+)?\)$/.test(normalized)) return false;
  if (/hsla?\([^)]*,0(?:\.0+)?\)$/.test(normalized)) return false;
  return true;
}

function styleLooksFullFrameOverlay(style: string): boolean {
  const position = readStyleProperty(style, "position")?.toLowerCase();
  if (position !== "fixed" && position !== "absolute") return false;
  const coversFrame =
    cssZero(readStyleProperty(style, "inset")) ||
    (cssZero(readStyleProperty(style, "top")) &&
      cssZero(readStyleProperty(style, "right")) &&
      cssZero(readStyleProperty(style, "bottom")) &&
      cssZero(readStyleProperty(style, "left")));
  return coversFrame && styleHasOpaqueBackground(style);
}

function collectSimpleStyleRules(styles: LintContext["styles"]): Map<string, string> {
  const rules = new Map<string, string>();
  for (const style of styles) {
    for (const [, selectorList, body] of style.content.matchAll(/([^{}]+)\{([^}]+)\}/g)) {
      if (!selectorList || !body) continue;
      for (const selector of selectorList.split(",")) {
        const token = selector.trim();
        if (!/^[#.][A-Za-z0-9_-]+$/.test(token)) continue;
        rules.set(token, `${rules.get(token) || ""};${body}`);
      }
    }
  }
  return rules;
}

function tagSimpleSelectors(tag: OpenTag): string[] {
  const selectors: string[] = [];
  const id = readAttr(tag.raw, "id");
  if (id) selectors.push(`#${id}`);
  const classes = readAttr(tag.raw, "class")?.split(/\s+/).filter(Boolean) ?? [];
  for (const className of classes) selectors.push(`.${className}`);
  return selectors;
}

function combinedTagStyle(tag: OpenTag, styleRules: Map<string, string>): string {
  const styles = [readAttr(tag.raw, "style") || ""];
  for (const selector of tagSimpleSelectors(tag)) {
    const ruleStyle = styleRules.get(selector);
    if (ruleStyle) styles.push(ruleStyle);
  }
  return styles.filter(Boolean).join(";");
}

// fallow-ignore-next-line complexity
function cssTransformToGsapProps(cssTransform: string): string | null {
  const parts: string[] = [];

  // translate(-50%, -50%) or translate(X, Y)
  const translateMatch = cssTransform.match(
    /translate\(\s*(-?[\d.]+)(%|px)?\s*,\s*(-?[\d.]+)(%|px)?\s*\)/,
  );
  if (translateMatch) {
    const [, xVal, xUnit, yVal, yUnit] = translateMatch;
    if (xUnit === "%") parts.push(`xPercent: ${xVal}`);
    else parts.push(`x: ${xVal}`);
    if (yUnit === "%") parts.push(`yPercent: ${yVal}`);
    else parts.push(`y: ${yVal}`);
  }

  // translateX(-50%) or translateX(px)
  const txMatch = cssTransform.match(/translateX\(\s*(-?[\d.]+)(%|px)?\s*\)/);
  if (txMatch) {
    const [, val, unit] = txMatch;
    parts.push(unit === "%" ? `xPercent: ${val}` : `x: ${val}`);
  }

  // translateY(-50%) or translateY(px)
  const tyMatch = cssTransform.match(/translateY\(\s*(-?[\d.]+)(%|px)?\s*\)/);
  if (tyMatch) {
    const [, val, unit] = tyMatch;
    parts.push(unit === "%" ? `yPercent: ${val}` : `y: ${val}`);
  }

  // scale(N)
  const scaleMatch = cssTransform.match(/scale\(\s*([\d.]+)\s*\)/);
  if (scaleMatch) {
    parts.push(`scale: ${scaleMatch[1]}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

// ── CSS-transform ↔ GSAP-transform conflict matching ─────────────────────────

// Transform components that COMBINE with a CSS translate/scale on the same
// element. GSAP bakes the element's existing CSS transform in when it seeks, so
// these stack rather than override in the capture path (e.g. CSS translateX(-50%)
// + xPercent:-50 renders as -100% — off-centre). `rotation` is excluded: it maps
// to CSS rotate(), which this rule treats separately (no false positive on spin).
const CONFLICTING_TRANSLATE_PROPS = ["x", "y", "xPercent", "yPercent"];
const CONFLICTING_SCALE_PROPS = ["scale", "scaleX", "scaleY"];

type GsapTransformCall = {
  method: string;
  selector: string;
  properties: string[];
  raw: string;
};

// Decompose a (possibly grouped / descendant / compound) GSAP target selector
// into the simple `#id` / `.class` tokens of the elements it actually targets —
// the RIGHTMOST compound of each comma group is the targeted element. This lets a
// CSS rule keyed by a simple selector (`.m04-label`) match a scoped GSAP selector
// (`"#root .m04-label, #root .m04-sub"`), which the prior exact-string lookup
// missed — so every scoped/grouped selector slipped past the rule entirely.
function targetedSelectorTokens(selector: string): Set<string> {
  const tokens = new Set<string>();
  for (const group of selector.split(",")) {
    const compounds = group
      .trim()
      .split(/[\s>+~]+/)
      .filter(Boolean);
    const last = compounds[compounds.length - 1];
    if (!last) continue;
    const simple = last.match(/[#.][A-Za-z0-9_-]+/g);
    if (simple) for (const token of simple) tokens.add(token);
  }
  return tokens;
}

// Find a CSS transform conflicting with a GSAP target selector: exact-string
// match first (fast path + back-compat with the original behaviour), then a
// token match so scoped/grouped/descendant selectors resolve to their class/id.
function matchCssTransform(gsapSelector: string, cssMap: Map<string, string>): string | undefined {
  if (cssMap.size === 0) return undefined;
  const direct = cssMap.get(gsapSelector);
  if (direct) return direct;
  const tokens = targetedSelectorTokens(gsapSelector);
  for (const [cssSelector, value] of cssMap) {
    if (tokens.has(cssSelector)) return value;
  }
  return undefined;
}

// Scan for STANDALONE `gsap.set/to/from/fromTo("selector", { ...props })` calls.
// The acorn timeline parser only captures calls rooted on the timeline var
// (`tl.to`, `tl.set`, …); a top-level `gsap.set("#root .label", { xPercent: -50 })`
// — a common way to seat shared base transforms before the timeline runs — is
// invisible to it, so the conflict rule never saw it. Variable selectors
// (`gsap.set(kicker, …)`) can't be resolved statically and are skipped.
function extractStandaloneGsapTransformCalls(script: string): GsapTransformCall[] {
  const calls: GsapTransformCall[] = [];
  const pattern = /gsap\.(set|to|from|fromTo)\s*\(\s*(["'])([^"']+)\2\s*,\s*\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(script)) !== null) {
    const method = match[1] ?? "set";
    const selector = match[3] ?? "";
    const propsBody = match[4] ?? "";
    const properties = [...propsBody.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1] ?? "");
    calls.push({ method, selector, properties, raw: truncateSnippet(match[0]) ?? match[0] });
  }
  return calls;
}

// Run a global regex over every script's content, yielding each match plus a
// context-padded snippet around it. Shared by the repeat-count and
// group-selector-keyframes rules below, which differ only in the pattern,
// whether comments are stripped first, and the context window size.
function scanScriptsForRegexMatches(
  scripts: LintContext["scripts"],
  pattern: RegExp,
  options: { stripComments: boolean; contextBefore: number; contextAfter: number },
): Array<{ match: RegExpExecArray; snippet: string }> {
  const hits: Array<{ match: RegExpExecArray; snippet: string }> = [];
  for (const script of scripts) {
    const content = options.stripComments ? stripJsComments(script.content) : script.content;
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const contextStart = Math.max(0, match.index - options.contextBefore);
      const contextEnd = Math.min(
        content.length,
        match.index + match[0].length + options.contextAfter,
      );
      hits.push({ match, snippet: content.slice(contextStart, contextEnd) });
    }
  }
  return hits;
}

// ── Seek-order safety helpers ───────────────────────────────────────────────
//
// The renderer distributes frames across workers; cold render workers seek
// non-linearly straight into their range instead of playing sequentially from 0.
// Any state that depends on seek ORDER — relative tween bases, callback-measured
// geometry, per-init random values — renders differently per worker, visible as
// position jumps or dead animation at chunk boundaries.

const RELATIVE_TWEEN_VALUE = /^[+-]=/;

function isRelativeTweenValue(value: string | number | undefined): boolean {
  return typeof value === "string" && RELATIVE_TWEEN_VALUE.test(value.trim());
}

// DOM reads split by transform sensitivity. Transform-sensitive reads report
// live animated geometry, so their result depends on the worker's own seek
// order. Transform-invariant layout reads (intrinsic size, path geometry) give
// the same answer on every worker as long as layout itself is not animated.
const TRANSFORM_SENSITIVE_READ =
  /\.getBoundingClientRect\s*\(|\bgetComputedStyle\s*\(|\bgsap\.getProperty\s*\(/;
const TRANSFORM_INVARIANT_READ =
  /\.(?:getTotalLength|getBBox)\s*\(|\.(?:offsetWidth|offsetHeight|clientWidth|clientHeight)\b/;
// Measurement set for CALLBACK analysis: gsap.getProperty is deliberately
// excluded — callbacks that read animated values to drive derived output
// (scramble text, typewriter cursors) are per-frame deterministic and
// seek-idempotent, so they render the same on every worker.
const CALLBACK_MEASUREMENT_PATTERN =
  /\.(?:getBoundingClientRect|getTotalLength|getBBox)\s*\(|\bgetComputedStyle\s*\(|\.(?:offsetWidth|offsetHeight|clientWidth|clientHeight)\b/;

function indexTagsByToken(tags: OpenTag[]): Map<string, OpenTag[]> {
  const tagsByToken = new Map<string, OpenTag[]>();
  const addToken = (token: string, tag: OpenTag): void => {
    const list = tagsByToken.get(token);
    if (list) list.push(tag);
    else tagsByToken.set(token, [tag]);
  };
  for (const tag of tags) {
    const id = readAttr(tag.raw, "id");
    if (id) addToken(`#${id}`, tag);
    for (const cls of readAttr(tag.raw, "class")?.split(/\s+/).filter(Boolean) ?? [])
      addToken(`.${cls}`, tag);
  }
  return tagsByToken;
}

function resolveSelectorTagIndexes(
  selector: string,
  tagsByToken: Map<string, OpenTag[]>,
): Set<number> {
  const indexes = new Set<number>();
  for (const token of targetedSelectorTokens(selector)) {
    for (const tag of tagsByToken.get(token) ?? []) indexes.add(tag.index);
  }
  return indexes;
}

// A selector whose comma groups are each a single simple compound (no
// combinators, no attribute selectors) — the only shape that resolves
// faithfully through simple #id/.class tokens. Descendant selectors
// (".card-a .icon") and composition-scoped selectors
// ('[data-composition-id="a"] .dot') would mis-join across elements or
// compositions, so token-based matching must bail on them.
function selectorResolvesFaithfully(selector: string): boolean {
  return selector.split(",").every((group) => {
    const token = group.trim();
    if (!token || token.includes("[")) return false;
    return !/[\s>+~]/.test(token);
  });
}

// Two GSAP targets provably hit the same element when their stable identities
// are equal, or when their (faithfully resolvable) selectors resolve to
// intersecting element sets — an id selector and a class selector can name the
// same node. Selectors with combinators or attribute parts are skipped rather
// than guessed at.
function targetsShareElement(
  a: { selector: string; identity?: string },
  b: { selector: string; identity?: string },
  tagsByToken: Map<string, OpenTag[]>,
): boolean {
  if (
    !targetHasNoStableIdentity(a.selector, a.identity) &&
    !targetHasNoStableIdentity(b.selector, b.identity) &&
    (a.identity ?? a.selector) === (b.identity ?? b.selector)
  ) {
    return true;
  }
  if (!selectorResolvesFaithfully(a.selector) || !selectorResolvesFaithfully(b.selector)) {
    return false;
  }
  const aTags = resolveSelectorTagIndexes(a.selector, tagsByToken);
  if (aTags.size === 0) return false;
  const bTags = resolveSelectorTagIndexes(b.selector, tagsByToken);
  for (const index of bTags) if (aTags.has(index)) return true;
  return false;
}

/**
 * The structure-only view of `source`: string, template and regex literal
 * CONTENTS blanked to spaces, with delimiters, length and newline positions
 * preserved. Every text scanner below shares one shape — mask once, take each
 * structural decision (bracket depth, keyword, delimiter) from `masked[i]`, and
 * slice the ORIGINAL text, which the preserved length keeps index-aligned 1:1.
 *
 * The literal awareness itself is delegated, never re-derived here:
 * `stripJsStringLiterals` already handles escape sequences and, crucially,
 * regex-vs-division disambiguation — including recovering locally from a
 * misread — so neither a quote inside a sanitizer regex (`/'/g`) nor an
 * unrelated `{}/2`-shaped division elsewhere in the script can desync the
 * depth counts below.
 *
 * Cached by exact input string, since the scanners below mask the SAME text
 * repeatedly (once per regex match, once per function signature, ...) and
 * `stripJsStringLiterals` walks a character at a time, so re-deriving it per
 * call is quadratic in script size. This is a small LRU, not a single slot:
 * callers legitimately interleave masking the whole script, one function's
 * body, and a small param/arg list within the same pass, and a single-slot
 * cache would evict the (expensive) whole-script entry on every (cheap) small
 * one — quadratic again, just with a smaller constant. A handful of entries
 * comfortably covers that real interleaving without unbounded growth.
 */
const MASK_CACHE_LIMIT = 16;
const maskCache = new Map<string, string>();
function maskLiterals(source: string): string {
  const cached = maskCache.get(source);
  if (cached !== undefined) {
    // Re-inserting moves this key to the END of the Map's iteration order —
    // Maps preserve insertion order — so eviction below (oldest-first) is
    // true least-recently-USED, not merely least-recently-inserted. Without
    // this, a frequently reused entry (typically the whole script, masked
    // once but read on nearly every call) could still be evicted the moment
    // enough OTHER distinct strings are masked, even though it was just used.
    maskCache.delete(source);
    maskCache.set(source, cached);
    return cached;
  }
  const masked = stripJsStringLiterals(source);
  maskCache.set(source, masked);
  if (maskCache.size > MASK_CACHE_LIMIT) {
    const oldestKey = maskCache.keys().next().value;
    if (oldestKey !== undefined) maskCache.delete(oldestKey);
  }
  return masked;
}

/**
 * Source from the delimiter at `openIndex` to its matching closer, inclusive.
 * Only REAL brackets count toward depth — one inside a string, template or
 * regex literal (a default value `a = "("`, a sanitizer regex `/{/g`) has been
 * masked out before the scan.
 */
function matchBalanced(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): string | null {
  const masked = maskLiterals(source);
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = masked[i] ?? "";
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

/**
 * +1 for an opening bracket, -1 for a closing one, 0 otherwise — the one
 * definition of "which masked characters move nesting depth" that every
 * depth-tracking scanner below shares, instead of each re-testing its own copy
 * of the `({[` / `)}]` character sets.
 */
function bracketDelta(ch: string): number {
  if ("({[".includes(ch)) return 1;
  if (")}]".includes(ch)) return -1;
  return 0;
}

/**
 * Index of the `{` opening the innermost object literal or block enclosing
 * `index`, or -1 when `index` sits inside none. Scans masked text backwards, so
 * a brace that is really literal content opens and closes nothing.
 */
function enclosingOpenBraceIndex(masked: string, index: number): number {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const ch = masked[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** The nearest object literal `{...}` enclosing `index` (comment-stripped source). */
function enclosingObjectLiteral(source: string, index: number): string | null {
  const braceIndex = enclosingOpenBraceIndex(maskLiterals(source), index);
  if (braceIndex < 0) return null;
  return matchBalanced(source, braceIndex, "{", "}");
}

function objectLiteralHasTopLevelRelativeValue(objectLiteral: string): boolean {
  const masked = maskLiterals(objectLiteral);
  let depth = 0;
  for (let i = 0; i < objectLiteral.length; i++) {
    const ch = masked[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      // Masking blanks literal contents but keeps their delimiters, so every
      // quote still standing here is a genuine one. A relative value is always
      // a string (`x: "+=10"`), and its contents have to be read back from the
      // ORIGINAL text. Testing at closing quotes too is harmless: only an
      // OPENING quote can be followed by `+=`/`-=`.
      if (depth === 1 && /^[+-]=/.test(objectLiteral.slice(i + 1))) return true;
    } else {
      depth += bracketDelta(ch);
    }
  }
  return false;
}

function isInsideGsapTweenVars(source: string, index: number, timelineVars: string[]): boolean {
  const braceIndex = enclosingOpenBraceIndex(maskLiterals(source), index);
  if (braceIndex < 0) return false;
  const before = source.slice(Math.max(0, braceIndex - 240), braceIndex).replace(/\s+/g, " ");
  const receivers = ["gsap", ...timelineVars].map(escapeRegExp).join("|");
  return new RegExp(`(?:${receivers})\\.(?:set|to|from|fromTo|timeline)\\b[\\s\\S]*$`).test(before);
}

/**
 * An expression starting at `start`, ending at the first `,` / closer that sits
 * at depth 0 outside any literal.
 */
function sliceExpression(source: string, start: number): string {
  const masked = maskLiterals(source);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = masked[i] ?? "";
    const delta = bracketDelta(ch);
    if (delta > 0) depth++;
    else if (delta < 0) {
      if (depth === 0) return source.slice(start, i);
      depth--;
    } else if (ch === "," && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

type ParsedFunctionValue = { firstParam: string | null; body: string };

function normalizeFirstParam(raw: string): string | null {
  let param = raw.trim().replace(/=.*$/, "").trim();
  param = param.replace(/\s*:\s*[\w$|<>,\s[\].]+$/, "").trim();
  if (!param || /^[[{]/.test(param)) return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(param)) return null;
  return param;
}

/** Parse a function-shaped source string into its first parameter and body. */
function parseFunctionValueSource(code: string): ParsedFunctionValue | null {
  const src = code.trim();
  const match =
    src.match(/^(?:async\s+)?function\s*[\w$]*\s*\(([^)]*)\)/) ??
    src.match(/^(?:async\s*)?\(([^)]*)\)\s*=>/) ??
    src.match(/^(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/);
  if (!match) return null;
  const firstParam = normalizeFirstParam((match[1] ?? "").split(",")[0] ?? "");
  return { firstParam, body: src.slice(match[0].length) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Methods that exist on numbers: calling them on the (index) first parameter of
// a GSAP function value is valid and must not be flagged.
const NUMBER_METHODS = new Set([
  "toFixed",
  "toString",
  "toPrecision",
  "toExponential",
  "toLocaleString",
  "valueOf",
]);

// Index is a NUMBER — non-number member access on the first param throws at init.
function firstParamMemberAccessHazard(fn: ParsedFunctionValue): string | null {
  if (!fn.firstParam) return null;
  const pattern = new RegExp(
    `\\b${escapeRegExp(fn.firstParam)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fn.body)) !== null) {
    const member = match[1] ?? "";
    const after = fn.body.slice(match.index + match[0].length);
    const isCall = /^\s*\(/.test(after);
    if (isCall && NUMBER_METHODS.has(member)) continue;
    return member;
  }
  return null;
}

/** Names of timeline variables (`const tl = gsap.timeline(...)`) in a script. */
function collectTimelineVarNames(source: string): string[] {
  return [...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\b/g)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
}

type FunctionSignature = { params: Array<string | null>; body: string };

/** Split `text` on top-level commas — depth-aware, so a comma inside `(...)`/`[...]`/`{...}` doesn't split. */
function splitTopLevelByComma(text: string): string[] {
  const masked = maskLiterals(text);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = masked[i] ?? "";
    if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    } else {
      depth += bracketDelta(ch);
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Parameter names of a parameter list (without its parentheses); null per destructured/rest param. */
function paramNames(paramList: string): Array<string | null> {
  return splitTopLevelByComma(paramList).map(normalizeFirstParam);
}

// Parameter names for a `const name = ...` prefix already matched by
// `assignPattern` below — mirrors that pattern's own three shapes
// (function expression / parenthesized arrow / bare-identifier arrow), the
// same three shapes `parseFunctionValueSource` also matches independently.
// If a shape is ever added to one, it won't automatically apply to the
// others; an unmatched shape here just yields `[]` (params unresolved),
// which falls back to the old conservative whole-function taint rather than
// silently misbehaving.
function extractAssignedParamNames(prefix: string): Array<string | null> {
  const match =
    prefix.match(/function\b[^(]*\(([^)]*)\)/) ??
    prefix.match(/\(([^)]*)\)\s*=>\s*$/) ??
    prefix.match(/([A-Za-z_$][\w$]*)\s*=>\s*$/);
  return match ? paramNames(match[1] ?? "") : [];
}

// Named function signatures in a script (declarations plus `const f = ...` function
// expressions and arrows). Expression-bodied arrows keep their single line.
function collectNamedFunctionSignatures(source: string): Map<string, FunctionSignature> {
  const signatures = new Map<string, FunctionSignature>();
  const declPattern = /(?:^|[^.\w$])function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = declPattern.exec(source)) !== null) {
    const parenIndex = declPattern.lastIndex - 1;
    const paramsWithParens = matchBalanced(source, parenIndex, "(", ")");
    if (!paramsWithParens) continue;
    const braceIndex = source.indexOf("{", parenIndex + paramsWithParens.length);
    if (braceIndex < 0) continue;
    const body = matchBalanced(source, braceIndex, "{", "}");
    if (!body) continue;
    const params = paramNames(paramsWithParens.slice(1, -1));
    signatures.set(match[1] ?? "", { params, body });
  }
  const assignPattern =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^{]*|\([^)]*\)\s*=>\s*|[A-Za-z_$][\w$]*\s*=>\s*)/g;
  while ((match = assignPattern.exec(source)) !== null) {
    const bodyStart = assignPattern.lastIndex;
    const body =
      source[bodyStart] === "{"
        ? matchBalanced(source, bodyStart, "{", "}")
        : sliceExpression(source, bodyStart);
    if (!body) continue;
    const params = extractAssignedParamNames(match[0]);
    signatures.set(match[1] ?? "", { params, body });
  }
  return signatures;
}

// The regex source for a direct call `name(...)`, tolerating optional
// chaining (`name?.(...)`) — still a real, synchronous call site, just one
// that no-ops instead of throwing when `name` is nullish.
function directCallPatternSource(name: string): string {
  return `\\b${escapeRegExp(name)}\\s*(?:\\?\\.)?\\(`;
}

// `name.call(...)` / `name.apply(...)` / `name.bind(...)()`, and their
// optional-chained forms `name?.call(...)` etc. — the Function.prototype
// invocation forms. Split out from `invokesName` because
// `expressionReachesMeasurement` needs this half on its own.
function invokesNameViaCallApplyBind(text: string, name: string): boolean {
  return new RegExp(
    `\\b${escapeRegExp(name)}\\s*(?:\\?\\.|\\.)\\s*(?:call|apply|bind)\\s*\\(`,
  ).test(text);
}

// Does `text` invoke `name` directly — `name(...)` or one of the
// Function.prototype forms above? All of them call the function synchronously,
// right here. Only a BY-REFERENCE handoff (`setTimeout(name, 0)`,
// `[1].forEach(name)`) is not a call and is deliberately excluded: the
// invocation there happens inside setTimeout's/forEach's own implementation,
// out of view here.
function invokesName(text: string, name: string): boolean {
  return (
    new RegExp(directCallPatternSource(name)).test(text) || invokesNameViaCallApplyBind(text, name)
  );
}

/** Does `text` measure directly, or call an already-tainted function? Requires a call — a bare name mention is not enough. */
function textReachesMeasurement(text: string, measuring: Set<string>): boolean {
  if (CALLBACK_MEASUREMENT_PATTERN.test(text)) return true;
  for (const name of measuring) {
    if (invokesName(text, name)) return true;
  }
  return false;
}

// Two-hop closure: functions whose body measures the DOM directly, plus
// functions that call one of those (bounded fixpoint — no deep recursion).
function collectMeasuringFunctionNames(signatures: Map<string, FunctionSignature>): Set<string> {
  const measuring = new Set<string>();
  for (const [name, { body }] of signatures) {
    if (CALLBACK_MEASUREMENT_PATTERN.test(body)) measuring.add(name);
  }
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const [name, { body }] of signatures) {
      if (measuring.has(name)) continue;
      if (!textReachesMeasurement(body, measuring)) continue;
      measuring.add(name);
      grew = true;
    }
    if (!grew) break;
  }
  return measuring;
}

type LiteralArg = { kind: "boolean"; value: boolean } | { kind: "string"; value: string };

function parseLiteralArg(argText: string): LiteralArg | null {
  const trimmed = argText.trim();
  if (trimmed === "true") return { kind: "boolean", value: true };
  if (trimmed === "false") return { kind: "boolean", value: false };
  const stringMatch = trimmed.match(/^(["'])([^"'`]*)\1$/);
  if (stringMatch) return { kind: "string", value: stringMatch[2] ?? "" };
  return null;
}

/** Body text of the case matching `value` in a `switch (paramName)`, up to the next `case`/`default`. */
function sliceUntilNextCase(text: string, start: number): string {
  const masked = maskLiterals(text);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = masked[i] ?? "";
    const prev = masked[i - 1] ?? "";
    const delta = bracketDelta(ch);
    if (delta > 0) depth++;
    else if (delta < 0) {
      if (depth === 0) return text.slice(start, i);
      depth--;
    } else if (depth === 0 && !/[\w$]/.test(prev) && /^(?:case|default)\b/.test(masked.slice(i))) {
      // The LEADING word-boundary check (`prev`) matters as much as the
      // trailing `\b`: without it the "case" inside an identifier such as
      // "lowercase(" reads as a case label and truncates the body here,
      // silently dropping the rest — including any measurement — from both
      // this slice and the caller's outside-the-statement remainder scan
      // (which only covers text outside the whole switch statement). Both
      // checks read `masked`, so a "case"/"default"-shaped substring inside a
      // string or regex literal cannot be mistaken for a real case label.
      return text.slice(start, i);
    }
  }
  return text.slice(start);
}

// A branch is only decisive when nothing OUTSIDE the branching statement (the
// half-open span `[start, end)` of `body`) measures: an unconditional
// measurement elsewhere in the function applies whichever branch a call took.
function measuresOutsideStatement(
  body: string,
  start: number,
  end: number,
  measuring: Set<string>,
): boolean {
  return textReachesMeasurement(body.slice(0, start) + body.slice(end), measuring);
}

// Substituting the caller's literal for `paramName` is only sound if nothing
// in the WHOLE function body could have changed what that name refers to or
// holds: a reassignment (`m = !m`, `m ||= x`, `m++`), or a shadowing rebinding
// (a nested function/arrow/method/catch parameter, a function declaration, a
// for-of/for-in reuse of the name as the loop variable, or a
// let/const/var/destructured declaration reusing the name). Either breaks
// the "still holds the caller's literal" assumption branch resolution
// depends on, so callers bail to unresolved rather than risk the wrong
// branch.
//
// The scan covers the whole body, not just the text before the branch: a
// rebind that appears textually AFTER the branch still matters whenever the
// branch can re-execute — inside a `for`/`while`/`do` loop, an
// `Array#forEach`/`map`/etc. callback, a recursive call, or any other
// repetition shape — since a later pass re-reads the (now-mutated) value.
// Enumerating every repetition construct a real author might use to decide
// "does this specific rebind matter" is an open-ended, unwinnable text-only
// classification problem (a prior, narrower version of this function tried
// exactly that — gating the wide scan behind a loop-keyword check — and two
// independent reviews each found a real repetition shape it missed). Always
// scanning the whole body costs some precision (an ordinary, unrelated
// reassignment after the branch with no repetition anywhere still forces a
// conservative bail), but that's a tolerated false positive, not a false
// negative — consistent with this rule's fail-closed design.
function paramMayBeRebound(body: string, paramName: string): boolean {
  const name = escapeRegExp(paramName);
  const assignmentPattern = new RegExp(
    `\\b${name}\\s*(?:=(?!=)|\\+=|-=|\\*\\*=|\\*=|/=|%=|<<=|>>>=|>>=|&=|\\|=|\\^=|\\|\\|=|&&=|\\?\\?=|\\+\\+|--)` +
      `|(?:\\+\\+|--)\\s*${name}\\b`,
  );
  const inParamList = `\\([^)]*\\b${name}\\b[^)]*\\)`;
  const shadowPattern = new RegExp(
    [
      `\\bfunction\\b[^(]*${inParamList}`, // nested function's parameter
      `\\bfunction\\s+${name}\\s*\\(`, // nested function DECLARATION reusing the name
      `${inParamList}\\s*=>`, // arrow's parenthesized parameter
      `\\b${name}\\s*=>`, // arrow's bare single parameter
      `\\b(?:let|const|var)\\s+${name}\\b`, // redeclaration
      `[{[][^}\\]]*\\b${name}\\b[^}\\]]*[}\\]]\\s*=`, // destructured binding
      `\\bcatch\\s*${inParamList}`, // catch clause parameter
      // `for (name of ...)` / `for (name in ...)` reusing the param as the
      // loop variable — reassigns on every iteration without ever matching
      // the assignment or declaration alternatives above (no `=`, no
      // let/const/var).
      `\\bfor\\s*(?:await\\s+)?\\(\\s*${name}\\s+(?:of|in)\\s+`,
      // Object/class method shorthand parameter (`run(paramName) {`) — has
      // neither `function` nor `=>`, so it needs its own alternative. The
      // control-flow keywords are excluded so an EARLIER, unrelated
      // if/while/switch/for/catch using the same real (non-shadowed) name
      // doesn't force a gratuitous bail.
      `\\b(?!if\\b|while\\b|switch\\b|for\\b|catch\\b|function\\b)[A-Za-z_$][\\w$]*\\s*${inParamList}\\s*\\{`,
    ].join("|"),
  );
  return assignmentPattern.test(body) || shadowPattern.test(body);
}

// A literal boolean argument resolves `if (paramName) {A} else {B}` (or its
// negation) to exactly one branch.
function resolveBooleanIfElseBranch(
  body: string,
  paramName: string,
  value: boolean,
  measuring: Set<string>,
): string | null {
  const ifPattern = new RegExp(`\\bif\\s*\\(\\s*(!)?\\s*${escapeRegExp(paramName)}\\s*\\)\\s*\\{`);
  const ifMatch = ifPattern.exec(body);
  if (!ifMatch) return null;
  if (paramMayBeRebound(body, paramName)) return null;
  const thenBraceIndex = ifMatch.index + ifMatch[0].length - 1;
  const thenBlock = matchBalanced(body, thenBraceIndex, "{", "}");
  if (!thenBlock) return null;
  const elseMatch = /^\s*else\s*\{/.exec(body.slice(thenBraceIndex + thenBlock.length));
  if (!elseMatch) return null;
  const elseBraceIndex = thenBraceIndex + thenBlock.length + elseMatch[0].length - 1;
  const elseBlock = matchBalanced(body, elseBraceIndex, "{", "}");
  if (!elseBlock) return null;
  const statementEnd = elseBraceIndex + elseBlock.length;
  if (measuresOutsideStatement(body, ifMatch.index, statementEnd, measuring)) return null;
  const conditionHolds = ifMatch[1] === "!" ? !value : value;
  return conditionHolds ? thenBlock : elseBlock;
}

// Finds `case "value":` at depth 0 of `switchBody` — i.e. belonging to THIS
// switch, not to a switch/if/object-literal nested inside an earlier case's
// own block. A plain (non-depth-aware) regex `.exec` would match the first
// TEXTUAL occurrence, which can be a same-valued case label nested inside a
// sibling case's inner switch. The label pattern runs against the ORIGINAL text
// (its own quoted value has to read literally, not blanked), while the depth it
// is judged at comes from `masked` — a literal's bracket-like characters (a
// `{n,m}` regex quantifier, say) must not desync the count.
function findTopLevelCaseMatch(switchBody: string, value: string): RegExpExecArray | null {
  const masked = maskLiterals(switchBody);
  const casePattern = new RegExp(`case\\s*(["'])${escapeRegExp(value)}\\1\\s*:`, "g");
  // Starts at -1, not 0: `switchBody` itself begins with the switch's own
  // wrapping `{`, so depth reaches 0 only once we're immediately inside it —
  // that's what "top-level" (belonging to THIS switch) means here.
  let depth = -1;
  // Forward-only: each match resumes the depth scan where the previous one
  // stopped, so every character is counted exactly once, in order.
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = casePattern.exec(switchBody)) !== null) {
    for (; cursor < match.index; cursor++) {
      const ch = masked[cursor] ?? "";
      depth += bracketDelta(ch);
    }
    // The match itself must sit OUTSIDE any literal too: masking blanks a
    // literal's contents to spaces, so a case-label-shaped substring inside
    // a string/template literal (e.g. `` label = `case "b":` ``) reads as
    // whitespace at `match.index` in `masked` rather than a real `c` —
    // depth alone can't tell the two apart, since a same-level string sitting
    // at the switch's own top level doesn't touch bracket depth at all.
    if (depth === 0 && masked[match.index] === "c") return match;
  }
  return null;
}

// Splits `text` into its top-level (depth-0) statements: `;`-terminated
// spans, and `{...}` BLOCK statements (if/for/while/switch/try/a bare block)
// — but not a `(...)`/`[...]` closing back to depth 0, which doesn't end a
// statement (e.g. an `if (x)` condition's own closing paren).
function splitTopLevelStatements(text: string): string[] {
  const masked = maskLiterals(text);
  const statements: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = masked[i] ?? "";
    const delta = bracketDelta(ch);
    if (delta > 0) {
      stack.push(ch);
    } else if (delta < 0) {
      const opener = stack.pop();
      if (stack.length === 0 && opener === "{" && ch === "}") {
        statements.push(text.slice(start, i + 1));
        start = i + 1;
      }
    } else if (ch === ";" && stack.length === 0) {
      statements.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) statements.push(rest);
  return statements;
}

// True when `text`'s own LAST top-level statement is an unconditional
// break/return/throw. Checking the last STATEMENT (rather than the trailing
// text) is what keeps a conditional terminator — `if (x) { break; }`, which
// still falls through when `x` is false — from reading as termination of the
// case itself. When the case body is one whole wrapping block
// (`case "x": { ...; break; }`), the check recurses into that block's own
// last statement.
function lastStatementIsTerminator(text: string): boolean {
  const statements = splitTopLevelStatements(text)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = statements[statements.length - 1];
  if (!last) return false;
  if (last.startsWith("{") && last.endsWith("}")) {
    return lastStatementIsTerminator(last.slice(1, -1));
  }
  return /^(?:break|return|throw)\b/.test(last);
}

// Same idea for `switch (paramName) { case "value": ... }` — only resolved
// when the literal's case doesn't fall through into the next case's body.
function resolveSwitchCaseBranch(
  body: string,
  paramName: string,
  value: string,
  measuring: Set<string>,
): string | null {
  const switchPattern = new RegExp(`\\bswitch\\s*\\(\\s*${escapeRegExp(paramName)}\\s*\\)\\s*\\{`);
  const switchMatch = switchPattern.exec(body);
  if (!switchMatch) return null;
  if (paramMayBeRebound(body, paramName)) return null;
  const braceIndex = switchMatch.index + switchMatch[0].length - 1;
  const switchBody = matchBalanced(body, braceIndex, "{", "}");
  if (!switchBody) return null;
  const caseMatch = findTopLevelCaseMatch(switchBody, value);
  if (!caseMatch) return null;
  const caseBody = sliceUntilNextCase(switchBody, caseMatch.index + caseMatch[0].length);
  // Both guards below mean the same thing: the matched case falls through into
  // the NEXT case at runtime, which this slice does not include and which may
  // measure — so it can't be resolved as "just this case's body."
  const trimmedCaseBody = caseBody.trim();
  if (!trimmedCaseBody) return null; // no body of its own
  if (!lastStatementIsTerminator(trimmedCaseBody)) return null;
  const statementEnd = braceIndex + switchBody.length;
  if (measuresOutsideStatement(body, switchMatch.index, statementEnd, measuring)) return null;
  return caseBody;
}

// Resolves whether ONE specific call to a tainted helper reaches measurement,
// by substituting any literal argument into the helper's own param-keyed
// branch. Returns null when the call can't be resolved this way (non-literal
// argument, or no recognized branch shape) — callers fall back to the old,
// conservative whole-function taint in that case.
//
// Two exotic shapes are known misses, documented rather than handled: (1) a
// measurement reached only through a sibling case LABEL's own expression
// (`case getMeasurement():`) — this resolver reads case BODIES, never case
// expressions; (2) sloppy-mode `arguments[1] = true` aliasing a named
// parameter — `arguments` is a live view onto non-strict parameters, so it can
// flip which literal a parameter holds without the assignment-to-that-name
// this resolver looks for ever appearing. Closing either needs AST-level
// analysis, not text scanning.
function resolveCallSiteMeasurement(
  calleeName: string,
  argsText: string,
  signatures: Map<string, FunctionSignature>,
  measuring: Set<string>,
): boolean | null {
  const signature = signatures.get(calleeName);
  if (!signature) return null;
  const args = splitTopLevelByComma(argsText);
  for (let i = 0; i < signature.params.length; i++) {
    const argText = (args[i] ?? "").trim();
    // A spread argument (`h(...args, false)`) makes every POSITIONAL argument
    // from here on unreliable — the spread can expand to any number of
    // elements at runtime, so a textually-later literal doesn't necessarily
    // bind to the param at its textual index. Positions before the spread are
    // unaffected and have already been resolved by the iterations above.
    if (argText.startsWith("...")) break;
    const paramName = signature.params[i];
    if (!paramName) continue;
    const literal = parseLiteralArg(argText);
    if (!literal) continue;
    const branch =
      literal.kind === "boolean"
        ? resolveBooleanIfElseBranch(signature.body, paramName, literal.value, measuring)
        : resolveSwitchCaseBranch(signature.body, paramName, literal.value, measuring);
    if (branch !== null) return textReachesMeasurement(branch, measuring);
  }
  return null;
}

// Requires a CALL, the same standard the taint-propagation closure above
// applies between named functions (see `invokesName`) — a bare, uncalled
// mention of a tainted name is not enough to trip the rule.
//
// Direct invocation forms (`measureFn()`, `measureFn.call(this)`,
// `.apply(...)`, `.bind(this)()`) are flagged: they run the tainted function
// synchronously, right here. A BY-REFERENCE handoff
// (`onUpdate: () => setTimeout(measureFn, 0)`, `[el].forEach(measureFn)`) is a
// deliberate, documented scope trade — there is no call syntax in the
// callback's own text to resolve, because the invocation (and whatever
// arguments it passes) happens inside setTimeout's/forEach's implementation.
//
// Known scaling characteristic, pre-existing and out of scope here: this is
// called once per callback call-site, and loops `measuring` (every DOM-touching
// named function in the WHOLE script) on each call — O(call sites × measuring
// names). A script with many call sites, each naming its OWN distinct measuring
// function, scales quadratically; one with many call sites sharing a SMALL,
// shared set of measuring functions (the realistic shape) does not. Not a
// regression from this pass's `maskLiterals` caching change — a follow-up would
// need to invert the loop (index calls by name once, not per callback).
function expressionReachesMeasurement(
  expression: string,
  measuring: Set<string>,
  signatures: Map<string, FunctionSignature>,
): boolean {
  if (CALLBACK_MEASUREMENT_PATTERN.test(expression)) return true;
  for (const name of measuring) {
    const callPattern = new RegExp(directCallPatternSource(name), "g");
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(expression)) !== null) {
      const parenIndex = match.index + match[0].length - 1;
      const argsWithParens = matchBalanced(expression, parenIndex, "(", ")");
      const resolved = argsWithParens
        ? resolveCallSiteMeasurement(name, argsWithParens.slice(1, -1), signatures, measuring)
        : null;
      // null (unresolved) and true (resolved branch measures) both taint this
      // callback; only a resolved, provably-safe branch (false) clears it.
      if (resolved !== false) return true;
    }
    // `.call`/`.apply`/`.bind` are direct invocations too, but their argument
    // shape (a leading `this`, or a further `()` for bind) doesn't match the
    // plain-call branch-resolution shape above — always conservative here,
    // same as an unresolved plain call would be.
    if (invokesNameViaCallApplyBind(expression, name)) return true;
  }
  return false;
}

// Resolve script-level element variables to the simple selector tokens they can
// denote: literal getElementById/querySelector lookups, template-literal ids
// matched against the document's actual ids, and script-assigned class names
// (createElementNS + setAttribute("class", ...)). Anything else stays unresolved.
function resolveScriptElementTokens(source: string, tags: OpenTag[]): Map<string, Set<string>> {
  const documentIds = tags.map((tag) => readAttr(tag.raw, "id")).filter((id) => id !== null);
  const tokensByVar = new Map<string, Set<string>>();
  const add = (name: string, token: string): void => {
    const tokens = tokensByVar.get(name) ?? new Set<string>();
    tokens.add(token);
    tokensByVar.set(name, tokens);
  };

  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*(["'])([^"'`]+)\2/g,
  )) {
    add(match[1] ?? "", `#${match[3] ?? ""}`);
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*`([^`]*)`/g,
  )) {
    const template = match[2] ?? "";
    const staticParts = template.split(/\$\{[^}]*\}/);
    // A template with no literal segments (`getElementById(\`${name}\`)`) would
    // match EVERY id in the document — treat it as unresolved instead.
    if (staticParts.every((part) => part === "")) continue;
    const idPattern = new RegExp(`^${staticParts.map(escapeRegExp).join(".*")}$`);
    for (const id of documentIds) {
      if (idPattern.test(id)) add(match[1] ?? "", `#${id}`);
    }
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.querySelector\(\s*(["'])([^"'`]+)\2/g,
  )) {
    for (const token of targetedSelectorTokens(match[3] ?? "")) add(match[1] ?? "", token);
  }
  for (const match of source.matchAll(
    /\b([A-Za-z_$][\w$]*)\.setAttribute\(\s*(["'])class\2\s*,\s*(["'])([^"'`]*)\3/g,
  )) {
    for (const cls of (match[4] ?? "").split(/\s+/).filter(Boolean)) add(match[1] ?? "", `.${cls}`);
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.className\s*=\s*(["'])([^"'`]*)\2/g)) {
    for (const cls of (match[3] ?? "").split(/\s+/).filter(Boolean)) add(match[1] ?? "", `.${cls}`);
  }
  return tokensByVar;
}

/** Expand selector tokens to the FULL token sets of the elements they resolve to. */
function elementLevelTokens(
  tokens: Iterable<string>,
  tagsByToken: Map<string, OpenTag[]>,
): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const token of [...expanded]) {
    for (const tag of tagsByToken.get(token) ?? []) {
      for (const own of tagSimpleSelectors(tag)) expanded.add(own);
    }
  }
  return expanded;
}

function isMultiComponentDasharray(value: string): boolean {
  const normalized = value.replace(/!important\s*$/i, "").trim();
  if (!normalized || /^none$/i.test(normalized)) return false;
  return normalized.split(/[\s,]+/).filter(Boolean).length >= 2;
}

// A GSAP strokeDasharray value that is a static string/template with >= 2
// components is the explicit "L L" fix form — safe. Variables and numbers are
// the common single-component draw-on form (the pathLength trick).
function gsapDasharrayValueLooksMultiComponent(valueSource: string): boolean {
  const literal = valueSource.trim().match(/^(["'`])([\s\S]*)\1$/)?.[2];
  if (literal === undefined) return false;
  return isMultiComponentDasharray(literal.replace(/\$\{[^}]*\}/g, "0"));
}

/** Byte ranges of every function body (declarations, expressions, block arrows). */
function collectFunctionBodyRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const openerPatterns = [/\bfunction\b[^{;()]*\([^)]*\)\s*\{/g, /=>\s*\{/g];
  for (const pattern of openerPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const braceIndex = match.index + match[0].length - 1;
      const body = matchBalanced(source, braceIndex, "{", "}");
      if (body) ranges.push({ start: braceIndex, end: braceIndex + body.length });
    }
  }
  return ranges;
}

function indexInsideAnyRange(
  index: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((range) => index > range.start && index < range.end);
}

function isIifeBody(source: string, range: { start: number; end: number }): boolean {
  let j = range.end;
  while (j < source.length && /\s/.test(source[j]!)) j++;
  if (source[j] !== ")") return false;
  j++;
  while (j < source.length && /\s/.test(source[j]!)) j++;
  return source[j] === "(" || source.startsWith(".call", j) || source.startsWith(".apply", j);
}

function indexInsideNonIifeRange(
  index: number,
  source: string,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some(
    (range) => index > range.start && index < range.end && !isIifeBody(source, range),
  );
}

// Simple selectors whose authored CSS (style blocks or inline styles) sets
// opacity to EXACTLY zero. The declaration regex is boundary-anchored so
// `opacity: 0.98` never matches; it ends at `;` or end of input, which also
// catches a final declaration without a trailing semicolon.
function collectCssOpacityZeroSelectors(
  styles: LintContext["styles"],
  tags: OpenTag[],
): Set<string> {
  const selectors = new Set<string>();
  const opacityExactlyZero = /opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/;

  for (const style of styles) {
    for (const [, selector, body] of style.content.matchAll(
      /([#.][a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g,
    )) {
      if (body && opacityExactlyZero.test(body)) {
        selectors.add((selector ?? "").trim());
      }
    }
  }

  for (const tag of tags) {
    const inlineStyle = readAttr(tag.raw, "style");
    if (!inlineStyle || !opacityExactlyZero.test(inlineStyle)) continue;
    const id = readAttr(tag.raw, "id");
    if (id) selectors.add(`#${id}`);
    for (const cls of readAttr(tag.raw, "class")?.split(/\s+/).filter(Boolean) ?? []) {
      selectors.add(`.${cls}`);
    }
  }
  return selectors;
}

// ── GSAP rules ─────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export const gsapRules: LintRule<LintContext>[] = [
  // gsap_undefined_css_variable
  async ({ tags, styles, scripts }) => {
    const definedVariables = collectStaticCssVariableDefinitions(tags, styles);
    const findings: HyperframeLintFinding[] = [];
    const reported = new Set<string>();
    for (const script of scripts) {
      for (const win of await cachedExtractGsapWindows(script.content)) {
        for (const values of [win.fromPropertyValues, win.propertyValues]) {
          for (const [property, value] of Object.entries(values ?? {})) {
            if (!isGsapColorProperty(property)) continue;
            for (const variable of cssVariableReferencesWithoutFallback(value)) {
              if (definedVariables.has(variable)) continue;
              const key = `${win.targetSelector}|${property}|${variable}`;
              if (reported.has(key)) continue;
              reported.add(key);
              findings.push({
                code: "gsap_undefined_css_variable",
                severity: "warning",
                message: `GSAP ${property} on "${win.targetSelector}" uses ${variable}, but no static CSS or composition-variable declaration defines it. The computed color may become invalid or transparent.`,
                selector: win.targetSelector,
                fixHint: `Define ${variable} in applicable CSS, declare "${variable.slice(2)}" in data-composition-variables, or add a var() fallback such as var(${variable}, #fff).`,
                snippet: truncateSnippet(win.raw),
              });
            }
          }
        }
      }
    }
    return findings;
  },

  // overlapping_gsap_tweens + gsap_animates_clip_element
  // fallow-ignore-next-line complexity
  async ({ tags, scripts, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const authoredHiddenSelectors = new Set(
      scripts.flatMap((script) => [...extractStandaloneHiddenSelectors(script.content)]),
    );

    // Build clip element selector map
    type ClipInfo = { tag: string; id: string; classes: string };
    const clipIds = new Map<string, ClipInfo>();
    const clipClasses = new Map<string, ClipInfo>();
    for (const tag of tags) {
      const clipTag = getClipTagClasses(tag);
      if (!clipTag) continue;
      const id = readAttr(tag.raw, "id");
      const info: ClipInfo = {
        tag: tag.name,
        id: id || "",
        classes: clipTag.classAttr,
      };
      if (id) clipIds.set(`#${id}`, info);
      for (const cls of clipTag.classes) {
        if (cls !== "clip") clipClasses.set(`.${cls}`, info);
      }
    }

    const styleRules = collectSimpleStyleRules(styles);
    const reportedVisibleOverlayKeys = new Set<string>();

    for (const script of scripts) {
      const gsapWindows = await cachedExtractGsapWindows(script.content);

      // overlapping_gsap_tweens
      for (let i = 0; i < gsapWindows.length; i++) {
        const left = gsapWindows[i];
        if (!left) continue;
        if (left.end <= left.position) continue;
        // Unresolved targets are unknown elements: two of them are not provably
        // the same element, so an overlap between them cannot be asserted.
        if (targetHasNoStableIdentity(left.targetSelector, left.targetIdentity)) continue;
        for (let j = i + 1; j < gsapWindows.length; j++) {
          const right = gsapWindows[j];
          if (!right) continue;
          if (right.end <= right.position) continue;
          const leftIdentity = left.targetIdentity ?? left.targetSelector;
          const rightIdentity = right.targetIdentity ?? right.targetSelector;
          if (leftIdentity !== rightIdentity) continue;
          const overlapStart = Math.max(left.position, right.position);
          const overlapEnd = Math.min(left.end, right.end);
          if (overlapEnd <= overlapStart) continue;
          if (left.overwriteAuto || right.overwriteAuto) continue;
          const sharedProperties = left.properties.filter((prop) =>
            right.properties.includes(prop),
          );
          if (sharedProperties.length === 0) continue;
          findings.push({
            code: "overlapping_gsap_tweens",
            severity: "warning",
            message: `GSAP tweens overlap on "${left.targetSelector}" for ${sharedProperties.join(", ")} between ${overlapStart.toFixed(2)}s and ${overlapEnd.toFixed(2)}s.`,
            selector: left.targetSelector,
            fixHint: 'Shorten the earlier tween, move the later tween, or add `overwrite: "auto"`.',
            snippet: truncateSnippet(`${left.raw}\n${right.raw}`),
          });
        }
      }

      // gsap_repeated_fromto_without_baseline
      const fromToWindowsBySelector = new Map<string, GsapWindow[]>();
      for (const win of gsapWindows) {
        if (win.method !== "fromTo" || win.immediateRender === false) continue;
        if (win.targetSelector === UNRESOLVED_TARGET) continue;
        const windows = fromToWindowsBySelector.get(win.targetSelector) ?? [];
        windows.push(win);
        fromToWindowsBySelector.set(win.targetSelector, windows);
      }

      const repeatedFromToGroups = [...fromToWindowsBySelector.values()].filter(
        (windows) => windows.length >= 2,
      );
      for (const fromToWindows of repeatedFromToGroups) {
        const firstFromTo = fromToWindows[0];
        if (!firstFromTo) continue;
        const selector = firstFromTo.targetSelector;
        const firstFromToIndex = gsapWindows.indexOf(firstFromTo);
        const firstFromToPosition = Math.min(...fromToWindows.map((win) => win.position));
        const hasTimelineBaseline = gsapWindows
          .slice(0, firstFromToIndex)
          .some(
            (candidate) =>
              candidate.method === "set" &&
              !candidate.global &&
              candidate.targetSelector === selector &&
              candidate.position <= firstFromToPosition,
          );
        if (hasTimelineBaseline) continue;

        findings.push({
          code: "gsap_repeated_fromto_without_baseline",
          severity: "warning",
          message:
            `${fromToWindows.length} tl.fromTo() calls target "${selector}" with no stable baseline. ` +
            `The last-authored fromTo "from" values become the element's resting state for any seek before ` +
            `the first tween actually runs, because GSAP applies fromTo from-values at authoring time ` +
            `(immediateRender), not at tween position.`,
          selector,
          fixHint:
            `Add \`immediateRender: false\` to the destination vars of each future fromTo, or set a safe ` +
            `resting state with an earlier \`tl.set("${selector}", { ... }, 0)\`. Pre-first-tween seeks must not ` +
            `inherit whichever fromTo call happened to author last.`,
          snippet: truncateSnippet(fromToWindows.map((win) => win.raw).join("\n")),
        });
      }

      // gsap_fullscreen_overlay_starts_visible
      for (const tag of tags) {
        const selectors = tagSimpleSelectors(tag);
        if (selectors.length === 0) continue;
        const overlayKey = readAttr(tag.raw, "id") || String(tag.index);
        if (reportedVisibleOverlayKeys.has(overlayKey)) continue;
        const authoredStyle = combinedTagStyle(tag, styleRules);
        if (!authoredStyle || !styleLooksFullFrameOverlay(authoredStyle)) continue;
        if (styleHasHiddenInitialState(authoredStyle)) continue;

        const visibilityWindows = gsapWindows
          .filter((win) => {
            const tokens = targetedSelectorTokens(win.targetSelector);
            if (!selectors.some((selector) => tokens.has(selector))) return false;
            return win.properties.some((prop) =>
              ["opacity", "autoAlpha", "visibility", "display"].includes(prop),
            );
          })
          .sort((a, b) => a.position - b.position);
        const startsHiddenAtZero = visibilityWindows.some(
          (win) =>
            win.position <= SCENE_BOUNDARY_EPSILON_SECONDS &&
            (isHiddenGsapState(win.propertyValues) ||
              (win.fromPropertyValues !== undefined && isHiddenGsapState(win.fromPropertyValues))),
        );
        if (startsHiddenAtZero) continue;
        if (selectors.some((selector) => authoredHiddenSelectors.has(selector))) continue;
        const firstVisible = visibilityWindows.find((win) => makesOverlayVisible(win));
        if (!firstVisible) continue;
        const selector =
          selectors.find((candidate) =>
            targetedSelectorTokens(firstVisible.targetSelector).has(candidate),
          ) ||
          selectors[0] ||
          tag.name;
        // A window only re-hides the overlay if it is a DIFFERENT tween that ends
        // hidden. Two exclusions matter:
        //   - `win !== firstVisible`: the reveal counted itself.
        //   - `method !== "from"`: a from-tween's recorded propertyValues are its
        //     START state. `from({opacity: 0})` ENDS visible, so reading those values
        //     as an end state made every from-reveal look like its own later hide.
        // Together these are what made the `from` shape report at all.
        const laterHidden = visibilityWindows.some(
          (win) =>
            win !== firstVisible &&
            win.method !== "from" &&
            win.position >= firstVisible.position &&
            isHiddenGsapState(win.propertyValues),
        );
        // Only the later-hidden shape is a real defect. The `from` shape is not:
        // gsap.from() seats its start values immediately, so on a paused timeline the
        // overlay already measures opacity 0 at t=0 and never covers an early frame.
        //
        // Worse, it had no exit. Both fixHints below (authored CSS `opacity: 0`, or an
        // immediate `gsap.set`) turn a working composition into a real defect that
        // `gsap_from_opacity_noop` correctly errors on — and that rule's fixHint says to
        // remove the very thing we just asked for, closing the loop. An agent applying
        // either hint bounces between the two errors forever.
        if (!laterHidden) continue;

        reportedVisibleOverlayKeys.add(overlayKey);
        findings.push({
          code: "gsap_fullscreen_overlay_starts_visible",
          severity: "error",
          message:
            `Full-frame overlay "${selector}" starts visible before its first GSAP opacity tween at ` +
            `${firstVisible.position.toFixed(2)}s. It will cover earlier render frames, often as a blank/white video.`,
          selector,
          elementId: readAttr(tag.raw, "id") || undefined,
          // gsap_timeline_set_initial_hide warns on `tl.set(..., 0)` initial hides
          // (a zero-duration set at 0 does not render at exactly t=0), so this hint
          // must not recommend that pattern — advise authored CSS or an immediate
          // gsap.set() instead, keeping the two rules' advice consistent.
          fixHint:
            `Add \`opacity: 0\` to "${selector}" in CSS/inline styles, or add an immediate ` +
            `\`gsap.set("${selector}", { opacity: 0 })\` (outside the timeline) before the reveal tween.`,
          snippet: truncateSnippet(firstVisible.raw),
        });
      }

      // gsap_animates_clip_element — GSAP must not compete with the framework's
      // clip visibility window. autoAlpha owns visibility as well as opacity.
      for (const win of gsapWindows) {
        const sel = win.targetSelector;
        const clipInfo = clipIds.get(sel) || clipClasses.get(sel);
        if (!clipInfo) continue;
        const conflictingProps = win.properties.filter(
          (p) => p === "visibility" || p === "display" || p === "autoAlpha",
        );
        if (conflictingProps.length === 0) continue;
        const elDesc = `<${clipInfo.tag}${clipInfo.id ? ` id="${clipInfo.id}"` : ""} class="${clipInfo.classes}">`;
        findings.push({
          code: "gsap_animates_clip_element",
          severity: "error",
          message: `GSAP animation sets ${conflictingProps.join(", ")} on a clip element. Selector "${sel}" resolves to element ${elDesc}. The framework manages clip visibility, and autoAlpha writes visibility as well as opacity — do not animate these properties on clip elements.`,
          selector: sel,
          elementId: clipInfo.id || undefined,
          fixHint:
            "Remove the visibility/display/autoAlpha tween, or move the content into a child <div> and target that instead.",
          snippet: truncateSnippet(win.raw),
        });
      }
    }
    return findings;
  },

  // gsap_css_transform_conflict
  // fallow-ignore-next-line complexity
  async ({ styles, scripts, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const cssTranslateSelectors = new Map<string, string>();
    const cssScaleSelectors = new Map<string, string>();

    // Check <style> blocks for transform rules
    for (const style of styles) {
      for (const [, selector, body] of style.content.matchAll(
        /([#.][a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g,
      )) {
        const tMatch = body?.match(/transform\s*:\s*([^;]+)/);
        if (!tMatch || !tMatch[1]) continue;
        const transformVal = tMatch[1].trim();
        if (/translate/i.test(transformVal))
          cssTranslateSelectors.set((selector ?? "").trim(), transformVal);
        if (/scale/i.test(transformVal))
          cssScaleSelectors.set((selector ?? "").trim(), transformVal);
      }
    }

    // Also check inline style="..." attributes on tags
    for (const tag of tags) {
      const inlineStyle = readAttr(tag.raw, "style");
      if (!inlineStyle) continue;
      const tMatch = inlineStyle.match(/transform\s*:\s*([^;]+)/);
      if (!tMatch || !tMatch[1]) continue;
      const transformVal = tMatch[1].trim();
      // Derive selectors from the tag's id and all classes
      const id = readAttr(tag.raw, "id");
      const classes = readAttr(tag.raw, "class")?.split(/\s+/).filter(Boolean) ?? [];
      const selectors: string[] = [];
      if (id) selectors.push(`#${id}`);
      for (const cls of classes) selectors.push(`.${cls}`);
      if (selectors.length === 0) continue;
      for (const sel of selectors) {
        if (/translate/i.test(transformVal) && !cssTranslateSelectors.has(sel))
          cssTranslateSelectors.set(sel, transformVal);
        if (/scale/i.test(transformVal) && !cssScaleSelectors.has(sel))
          cssScaleSelectors.set(sel, transformVal);
      }
    }

    if (cssTranslateSelectors.size === 0 && cssScaleSelectors.size === 0) return findings;

    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const windows = await cachedExtractGsapWindows(script.content);

      // Two sources of transform-setting calls: timeline-rooted tweens (from the
      // acorn parser) and standalone gsap.* calls (regex — the parser ignores
      // these). Normalize both into one shape and run the same conflict check.
      const calls: GsapTransformCall[] = [
        ...windows.map((win) => ({
          method: win.method,
          selector: win.targetSelector,
          properties: win.properties,
          raw: win.raw,
        })),
        ...extractStandaloneGsapTransformCalls(stripJsComments(script.content)),
      ];

      type Conflict = { cssTransform: string; props: Set<string>; raw: string };
      const conflicts = new Map<string, Conflict>();

      for (const call of calls) {
        // from() and fromTo() both supply explicit start values so GSAP owns
        // the full transform from t=0, making the CSS conflict moot
        if (call.method === "fromTo" || call.method === "from") continue;
        const sel = call.selector;
        const translateProps = call.properties.filter((p) =>
          CONFLICTING_TRANSLATE_PROPS.includes(p),
        );
        const scaleProps = call.properties.filter((p) => CONFLICTING_SCALE_PROPS.includes(p));
        const cssFromTranslate =
          translateProps.length > 0 ? matchCssTransform(sel, cssTranslateSelectors) : undefined;
        const cssFromScale =
          scaleProps.length > 0 ? matchCssTransform(sel, cssScaleSelectors) : undefined;
        if (!cssFromTranslate && !cssFromScale) continue;
        const existing = conflicts.get(sel) ?? {
          cssTransform: [cssFromTranslate, cssFromScale].filter(Boolean).join(" "),
          props: new Set<string>(),
          raw: call.raw,
        };
        for (const p of [...translateProps, ...scaleProps]) existing.props.add(p);
        conflicts.set(sel, existing);
      }

      for (const [sel, { cssTransform, props, raw }] of conflicts) {
        const propList = [...props].join("/");
        const gsapEquivalent = cssTransformToGsapProps(cssTransform);
        const fixHint = gsapEquivalent
          ? `Remove \`transform: ${cssTransform}\` from CSS and replace with GSAP properties: ${gsapEquivalent}. ` +
            `Example: tl.fromTo('${sel}', { ${gsapEquivalent} }, { ${gsapEquivalent}, ...yourAnimation }). ` +
            `tl.fromTo is exempt from this rule.`
          : `Remove the transform from CSS and use tl.fromTo('${sel}', ` +
            `{ xPercent: -50, x: -1000 }, { xPercent: -50, x: 0 }) so GSAP owns ` +
            `the full transform state. tl.fromTo is exempt from this rule.`;
        findings.push({
          code: "gsap_css_transform_conflict",
          severity: "error",
          message:
            `"${sel}" has CSS \`transform: ${cssTransform}\` and a GSAP tween animates ` +
            `${propList}. GSAP will overwrite the full CSS transform, discarding any ` +
            `translateX(-50%) centering or CSS scale value.`,
          selector: sel,
          fixHint,
          snippet: truncateSnippet(raw),
        });
      }
    }
    return findings;
  },

  // missing_gsap_script
  ({ scripts, rawSource, options }) => {
    const allScriptTexts = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs)).map((s) => s.content);
    const allScriptSrcs = scripts
      .map((s) => readAttr(`<script ${s.attrs}>`, "src") || "")
      .filter(Boolean);
    const canInheritGsapFromHost =
      options.isSubComposition || rawSource.trimStart().toLowerCase().startsWith("<template");

    const usesGsap = allScriptTexts.some((t) =>
      /gsap\.(to|from|fromTo|timeline|set|registerPlugin)\b/.test(t),
    );
    const hasGsapScript = allScriptSrcs.some((src) => /gsap/i.test(src));
    // Detect GSAP bundled inline (no src attribute). Match:
    // - Producer's CDN-inlining comment: /* inlined: ...gsap... */
    // - GSAP library internals: _gsScope, GreenSock, gsap.config
    // - Large inline scripts (>5KB) that reference gsap (likely bundled library)
    const hasInlineGsap = allScriptTexts.some(
      (t) =>
        /\/\*\s*inlined:.*gsap/i.test(t) ||
        /\b_gsScope\b/.test(t) ||
        /\bGreenSock\b/.test(t) ||
        /\bgsap\.(config|defaults|version)\b/.test(t) ||
        (t.length > 5000 && /\bgsap\b/i.test(t)),
    );

    if (!usesGsap || hasGsapScript || hasInlineGsap || canInheritGsapFromHost) return [];
    return [
      {
        code: "missing_gsap_script",
        severity: "error",
        message: "Composition uses GSAP but no GSAP script is loaded. The animation will not run.",
        fixHint:
          'Add <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script> before your animation script.',
      },
    ];
  },

  // missing_gsap_plugin
  async ({ scripts, rawSource, options }) => {
    const canInheritPluginFromHost =
      options.isSubComposition || rawSource.trimStart().toLowerCase().startsWith("<template");
    if (canInheritPluginFromHost) return [];

    const gsapScriptMotionPathFirstUseIndex = await loadGsapScriptMotionPathFirstUseIndex();
    const motionPathUseIndices = scripts.map((script) =>
      gsapScriptMotionPathFirstUseIndex(script.content),
    );
    const firstMotionPathScriptIndex = motionPathUseIndices.findIndex((index) => index !== null);
    const firstMotionPathUseIndex = motionPathUseIndices[firstMotionPathScriptIndex] ?? null;
    const firstUseScript = scripts[firstMotionPathScriptIndex];
    const executionMode = (attrs: string): "blocking" | "defer" | "module" | "async" => {
      const tag = `<script ${attrs}>`;
      const isModule = (readDecodedAttr(tag, "type") ?? "").toLowerCase() === "module";
      const hasSrc = readDecodedAttr(tag, "src") !== null;
      const hasAsync = readDecodedAttr(tag, "async") !== null;
      const hasDefer = readDecodedAttr(tag, "defer") !== null;
      if ((isModule || hasSrc) && hasAsync) return "async";
      if (isModule) return "module";
      if (hasSrc && hasDefer) return "defer";
      return "blocking";
    };
    const firstUseMode = firstUseScript ? executionMode(firstUseScript.attrs) : "blocking";
    const hasMotionPathPlugin = scripts
      .slice(0, firstMotionPathScriptIndex + 1)
      .some((script, candidateIndex) => {
        const candidateMode = executionMode(script.attrs);
        const sameScript = candidateIndex === firstMotionPathScriptIndex;
        const candidateIsPostParse = candidateMode === "defer" || candidateMode === "module";
        const firstUseIsPostParse = firstUseMode === "defer" || firstUseMode === "module";
        const executesBeforeFirstUse =
          sameScript ||
          candidateMode === "blocking" ||
          (candidateIsPostParse && firstUseIsPostParse);
        if (!executesBeforeFirstUse || (!sameScript && candidateMode === "async")) return false;
        const src = readAttr(`<script ${script.attrs}>`, "src") ?? "";
        const uncommented = stripJsComments(script.content);
        const hasStaticImport =
          /\bimport\s+(?:[\s\S]*?\sfrom\s*)?["'][^"']*\bMotionPathPlugin\b[^"']*["']/.test(
            uncommented,
          ) ||
          /\bimport\s+(?:[\w$]+\s*,\s*)?\{[^}]*\bMotionPathPlugin\b[^}]*\}\s+from\s*["'][^"']+["']/.test(
            uncommented,
          ) ||
          /\bimport\s+MotionPathPlugin\s+from\s*["'][^"']+["']/.test(uncommented);
        const inlinedMarkerIndex = script.content.search(/\/\*\s*inlined:.*MotionPathPlugin/i);
        const definitionIndex = uncommented.search(
          /\b(?:const|let|var|class|function)\s+MotionPathPlugin\b/,
        );
        if (sameScript) {
          if (hasStaticImport) return true;
          if (firstMotionPathUseIndex === null) return false;
          return (
            (inlinedMarkerIndex >= 0 && inlinedMarkerIndex < firstMotionPathUseIndex) ||
            (definitionIndex >= 0 && definitionIndex < firstMotionPathUseIndex)
          );
        }
        return (
          /MotionPathPlugin/i.test(src) ||
          hasStaticImport ||
          inlinedMarkerIndex >= 0 ||
          definitionIndex >= 0
        );
      });
    if (firstMotionPathScriptIndex < 0 || hasMotionPathPlugin) return [];
    return [
      {
        code: "missing_gsap_plugin",
        severity: "error",
        message:
          "A GSAP tween uses motionPath, but MotionPathPlugin is not loaded. Core GSAP ignores this plugin-specific property, so the intended motion will not render.",
        fixHint:
          "Load MotionPathPlugin before the animation script and register it with gsap.registerPlugin(MotionPathPlugin), or replace motionPath with core GSAP x/y tweens.",
      },
    ];
  },

  // audio_reactive_single_tween_per_group
  // fallow-ignore-next-line complexity
  ({ scripts, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!hasCaptionStyles(styles)) return findings;

    for (const script of scripts) {
      const content = script.content;
      // Detect audio data loading
      const hasAudioData = /AUDIO|audio[-_]?data|bands\[/.test(content);
      if (!hasAudioData) continue;

      // Detect caption group loop
      const hasCaptionLoop = /forEach/.test(content) && /caption|group|cg-/.test(content);
      if (!hasCaptionLoop) continue;

      // Check if audio-reactive tweens are created at intervals (loop inside the group loop)
      // vs a single tween per group (no inner time-sampling loop)
      const hasInnerSamplingLoop =
        /for\s*\(\s*var\s+\w+\s*=\s*group\.start/.test(content) ||
        /for\s*\(\s*var\s+at\s*=/.test(content) ||
        /while\s*\(\s*\w+\s*<\s*group\.end/.test(content);

      if (!hasInnerSamplingLoop) {
        // Check if there's at least a peak-based single tween (the minimal pattern)
        const hasPeakTween =
          /peak(?:Bass|Treble|Energy)/.test(content) && /group\.start/.test(content);
        if (hasPeakTween) {
          findings.push({
            code: "audio_reactive_single_tween_per_group",
            severity: "warning",
            message:
              "Audio-reactive captions use a single tween per group based on peak values. " +
              "This sets one static value at group.start — not perceptible as audio reactivity.",
            fixHint:
              "Sample audio data at 100-200ms intervals throughout each group's lifetime " +
              "(for loop from group.start to group.end) and create a tween at each sample " +
              "point for visible pulsing.",
          });
        }
      }
    }
    return findings;
  },

  // gsap_infinite_repeat
  ({ scripts, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    const declaredDuration = Number.parseFloat(
      rootTag ? (readAttr(rootTag.raw, "data-duration") ?? "") : "",
    );
    const hasFiniteCompositionWindow = Number.isFinite(declaredDuration) && declaredDuration > 0;
    // Match repeat: -1 in GSAP tweens or timeline configs
    const pattern = /repeat\s*:\s*-1(?!\d)/g;
    for (const { snippet } of scanScriptsForRegexMatches(scripts, pattern, {
      stripComments: true,
      contextBefore: 60,
      contextAfter: 60,
    })) {
      findings.push({
        code: "gsap_infinite_repeat",
        severity: hasFiniteCompositionWindow ? "warning" : "error",
        message: hasFiniteCompositionWindow
          ? `GSAP tween uses \`repeat: -1\` (infinite), but the composition declares a finite ${declaredDuration}s window. ` +
            "HyperFrames clips deterministic seeking and export to that explicit duration."
          : "GSAP tween uses `repeat: -1` (infinite) without a finite composition `data-duration`. " +
            "The timeline can report an unbounded duration and make render planning fail.",
        fixHint: hasFiniteCompositionWindow
          ? "Keep the explicit finite composition `data-duration`. Use a finite repeat count only when the loop itself must end before the composition does."
          : "Add a finite composition `data-duration`, or replace `repeat: -1` with " +
            "`repeat: Math.max(0, Math.floor(totalDuration / singleCycleDuration) - 1)`.",
        snippet: truncateSnippet(snippet),
      });
    }
    return findings;
  },

  // gsap_repeat_ceil_overshoot
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    // Match patterns like: repeat: Math.ceil(duration / X) - 1
    // or repeat: Math.ceil(totalDuration / cycleDuration) - 1
    const pattern = /repeat\s*:\s*Math\.ceil\s*\([^)]+\)\s*-\s*1/g;
    for (const { snippet } of scanScriptsForRegexMatches(scripts, pattern, {
      stripComments: false,
      contextBefore: 40,
      contextAfter: 40,
    })) {
      findings.push({
        code: "gsap_repeat_ceil_overshoot",
        severity: "warning",
        message:
          "GSAP repeat calculation uses `Math.ceil` which can overshoot the composition duration. " +
          "For example, Math.ceil(10.5 / 2) - 1 = 5 repeats → 6 cycles × 2s = 12s, exceeding 10.5s.",
        fixHint:
          "Use `Math.floor` instead of `Math.ceil` to ensure the animation fits within the duration: " +
          "`repeat: Math.max(0, Math.floor(totalDuration / cycleDuration) - 1)`. " +
          "Math.floor(10.5 / 2) - 1 = 4 repeats → 5 cycles × 2s = 10s ✓",
        snippet: truncateSnippet(snippet),
      });
    }
    return findings;
  },

  // gsap_repeat_floor_unclamped
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    // A direct floor-minus-one expression becomes GSAP's infinite -1 sentinel when
    // the visible duration is shorter than one full cycle. Math.max-wrapped forms
    // intentionally do not match because `repeat:` is followed by Math.max, not Math.floor.
    const pattern = /repeat\s*:\s*Math\.floor\s*\([^)]+\)\s*-\s*1/g;
    for (const { snippet } of scanScriptsForRegexMatches(scripts, pattern, {
      stripComments: false,
      contextBefore: 40,
      contextAfter: 40,
    })) {
      findings.push({
        code: "gsap_repeat_floor_unclamped",
        severity: "warning",
        message:
          "GSAP repeat calculation can evaluate to -1 when the composition is shorter than one cycle, " +
          "which GSAP interprets as an infinite repeat.",
        fixHint:
          "Clamp the finite repeat count at zero: " +
          "`repeat: Math.max(0, Math.floor(totalDuration / cycleDuration) - 1)`.",
        snippet: truncateSnippet(snippet),
      });
    }
    return findings;
  },

  // gsap_timeline_not_registered
  ({ scripts, rawSource, options }) => {
    const findings: HyperframeLintFinding[] = [];
    const canInheritFromHost =
      options.isSubComposition || rawSource.trimStart().toLowerCase().startsWith("<template");

    for (const script of scripts) {
      const content = script.content;
      if (!/gsap\.timeline/.test(content)) continue;
      const hasRegistration =
        WINDOW_TIMELINE_ASSIGN_PATTERN.test(content) ||
        TIMELINE_REGISTRY_OBJECT_LITERAL_PATTERN.test(content);
      if (hasRegistration || canInheritFromHost) continue;
      findings.push({
        code: "gsap_timeline_not_registered",
        severity: "error",
        message:
          "GSAP timeline is created but never registered in window.__timelines. " +
          "The runtime discovers timelines from this registry — without registration, " +
          "animations will not play during preview or render.",
        fixHint:
          "Add `window.__timelines = window.__timelines || {};` and " +
          '`window.__timelines["root"] = tl;` after creating the timeline (use the ' +
          "composition's data-composition-id as the key).",
      });
    }
    return findings;
  },

  // gsap_timeline_registered_before_async_build — registering window.__timelines[id]
  // BEFORE the timeline is built inside document.fonts.ready (or any async callback)
  // leaves an EMPTY timeline registered. The runtime's sub-composition readiness gate
  // treats "key present" as "ready" and nests the child ONCE, while still empty — so the
  // animation never renders when this composition is mounted as a sub-composition.
  // Register only AFTER the build completes (the documented async-setup contract).
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = stripJsComments(script.content);
      const regIdx = content.search(/window\s*\.\s*__timelines\s*\[/);
      if (regIdx < 0) continue;
      const fontsReadyIdx = content.search(/document\s*\.\s*fonts\s*\.\s*ready/);
      if (fontsReadyIdx < 0) continue;
      // Registering after the async boundary is the correct pattern — skip it.
      if (regIdx >= fontsReadyIdx) continue;
      // Confirm the build is actually deferred past the boundary (a tween/build call
      // appears after document.fonts.ready), i.e. the registered timeline starts empty.
      const tail = content.slice(fontsReadyIdx);
      if (!/\.(?:to|from|fromTo)\s*\(|buildEffect\s*\(/.test(tail)) continue;
      findings.push({
        code: "gsap_timeline_registered_before_async_build",
        severity: "error",
        message:
          "window.__timelines is assigned BEFORE the timeline is built inside " +
          "document.fonts.ready. An empty timeline registered early gets nested empty " +
          "when this composition is used as a sub-composition (the readiness gate treats " +
          '"key present" as "ready" and never re-nests), so the animation renders blank.',
        fixHint:
          "Move the `window.__timelines[id] = tl;` assignment to the END of the " +
          "document.fonts.ready callback, after the tweens are added. Optionally call " +
          "window.__hfForceTimelineRebind() right after, to re-nest the populated timeline.",
      });
    }
    return findings;
  },

  // CSS/GSAP-hidden reveal safety. A fromTo() whose from-vars make an element
  // visible but whose destination omits opacity works during sequential seeks,
  // yet cold render workers restore the authored hidden state and encode it
  // permanently invisible.
  // fallow-ignore-next-line complexity
  async ({ styles, scripts, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const cssOpacityZeroSelectors = collectCssOpacityZeroSelectors(styles, tags);

    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const windows = await cachedExtractGsapWindows(script.content);
      const hiddenSelectors = new Set([
        ...cssOpacityZeroSelectors,
        ...extractStandaloneHiddenSelectors(script.content),
      ]);

      for (const win of windows) {
        const sel = win.targetSelector;
        const cssKey = sel.startsWith("#") || sel.startsWith(".") ? sel : `#${sel}`;
        if (!hiddenSelectors.has(cssKey)) continue;

        if (
          win.method === "fromTo" &&
          win.fromPropertyValues &&
          isVisibleGsapState(win.fromPropertyValues) &&
          !win.properties.some((property) => property === "opacity" || property === "autoAlpha")
        ) {
          findings.push({
            code: "gsap_cold_seek_hidden_fromto_missing_reveal",
            severity: "error",
            message:
              `"${sel}" starts hidden, but its gsap.fromTo() makes it visible only in the from-vars ` +
              "and omits opacity/autoAlpha from the destination. Cold render workers restore the hidden authored state, so the encoded element can stay invisible even when sequential snapshots look correct.",
            selector: sel,
            fixHint: `Add \`opacity: 1\` (or \`autoAlpha: 1\`) to the destination vars for "${sel}" so every seek path establishes the visible end state explicitly.`,
            snippet: truncateSnippet(win.raw),
          });
          continue;
        }

        if (win.method !== "from") continue;
        if (!win.properties.includes("opacity")) continue;
        // Only a noop when the tween animates FROM 0 (same as the CSS value)
        if (win.propertyValues["opacity"] !== 0) continue;

        findings.push({
          code: "gsap_from_opacity_noop",
          severity: "error",
          message:
            `"${sel}" has CSS \`opacity: 0\` and a gsap.${win.method}() that also sets opacity to 0. ` +
            `gsap.from() animates FROM the specified value TO the current CSS value — ` +
            `since CSS is already 0, the element animates from 0→0 and never becomes visible.`,
          selector: sel,
          fixHint:
            `Remove \`opacity: 0\` from the CSS/inline style on "${sel}". ` +
            `Let gsap.from({opacity: 0}) handle the initial hidden state — ` +
            `it will animate FROM 0 TO the CSS value (1 by default).`,
          snippet: truncateSnippet(win.raw),
        });
      }
    }
    return findings;
  },

  // gsap_non_transform_motion — animating layout props (left/top/right/bottom/margin*)
  // or using roundProps snaps motion to integer device pixels. On the seek-by-frame
  // capture engine this looks smooth at high per-frame deltas (fast tweens) but visibly
  // stutters at low deltas (slow tweens / ease-out tails): sub-pixel movement rounds to
  // the same pixel for several frames, then jumps a whole pixel. Transforms (x/y/scale)
  // interpolate sub-pixel and stay smooth.
  //
  // EXEMPTION: elements rasterized via the html-in-canvas API — those under a
  // `<canvas layoutsubtree>` ancestor (e.g. the liquid-glass blocks) — are NOT laid out
  // by the browser compositor. The canvas lib reads getComputedStyle().left/top (a
  // sub-pixel value) and draws the element to a bitmap, so animating a layout prop on
  // them does not integer-snap and does not stutter. We resolve each tween's target to
  // its element(s) and skip the finding only when EVERY target is html-in-canvas; a
  // grouped tween that also touches a plain-DOM element (which does stutter) still fires.
  //
  // No suppression by design: there is intentionally no per-line/per-file opt-out (unlike
  // eslint-disable). The stance is fix-the-motion, not silence-the-rule — a plain-DOM
  // layout-prop animation always has a faithful transform equivalent (per-glyph x for
  // spacing, scale for size, x/y for position). An author who has consciously accepted a
  // stutter still has no flag to flip; that is deliberate, not a missing feature.
  async ({ scripts, tags, source }) => {
    const findings: HyperframeLintFinding[] = [];

    // Byte-ranges of every <canvas layoutsubtree>. An element whose open-tag index falls
    // inside one of these ranges is html-in-canvas composited.
    const layoutSubtreeRanges = tags
      .filter((t) => t.name.toLowerCase() === "canvas" && /\blayoutsubtree\b/i.test(t.raw))
      .map((t) => ({ start: t.index, end: findTagEnd(source, t) }));
    const isHtmlInCanvas = (tag: OpenTag): boolean =>
      layoutSubtreeRanges.some((r) => tag.index > r.start && tag.index < r.end);

    // Resolve a simple #id / .class token to the element tag(s) it matches.
    const tagsByToken = indexTagsByToken(tags);

    // True only when the selector resolves to at least one element AND every resolved
    // element is html-in-canvas. Unresolvable selectors (no match) are NOT exempt — we
    // stay conservative and let the finding fire rather than risk a false negative.
    const allTargetsHtmlInCanvas = (selector: string): boolean => {
      if (layoutSubtreeRanges.length === 0) return false;
      const matched = [...targetedSelectorTokens(selector)].flatMap(
        (token) => tagsByToken.get(token) ?? [],
      );
      return matched.length > 0 && matched.every(isHtmlInCanvas);
    };
    // Positional layout props → each maps to its transform replacement axis (x/y).
    const LAYOUT_FIX: Record<string, string[]> = {
      left: ["x"],
      right: ["x"],
      top: ["y"],
      bottom: ["y"],
      margin: ["x", "y"],
      marginLeft: ["x"],
      marginRight: ["x"],
      marginTop: ["y"],
      marginBottom: ["y"],
    };
    // Text-reflow props: animating them reflows text and snaps glyph positions to the
    // pixel grid, stuttering on slow motion exactly like positional props. They have no
    // transform replacement (the fix is to not animate them — settle via scale or hold the
    // value), and the snap happens during browser layout, UPSTREAM of any canvas raster, so
    // they are never html-in-canvas-exempt. (width/height are deliberately omitted: they
    // have legitimate animated uses — progress bars, reveals — and would over-report.)
    const REFLOW_PROPS = ["letterSpacing", "wordSpacing", "fontSize"];
    // Resolve the parser once, above the loop (the other async rules in this file do the
    // same); the dynamic-import cache makes per-iteration calls equivalent, but hoisting
    // keeps the placement from reading as load-bearing.
    const parseGsapScript = await loadParseGsapScript();
    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;

      // Two sources: timeline-rooted tweens (tl.to/from/fromTo) and standalone
      // gsap.to/from/fromTo calls the acorn parser ignores.
      //
      // Timeline tweens come straight from the acorn parser's animation list — NOT
      // cachedExtractGsapWindows, which drops every tween with a non-numeric timeline
      // position (a string label or `+=`/`-=` offset, e.g. `tl.to("#x",{left:9},"hold6")`).
      // Position is irrelevant to whether a tween animates a layout prop, so dropping
      // those would let real stutter-prone tweens escape. The parser also gives real AST
      // keys, so a nested `{}` value (an onComplete body, modifiers) and a layout-prop
      // name appearing inside a string value can't be misread — both hazards of a raw scan.
      const parsed = parseGsapScript(script.content);
      const calls: GsapTransformCall[] = [
        ...parsed.animations.map((anim) => ({
          method: anim.method,
          selector: anim.targetSelector,
          // Union the from-vars: a fromTo() can animate a layout/reflow prop that appears
          // only in its first ("from") object, which is just as stutter-prone as the to-vars.
          properties: [
            ...new Set([
              ...Object.keys(anim.properties),
              ...Object.keys(anim.fromProperties ?? {}),
            ]),
          ],
          raw: synthesizeWindowRaw(parsed.timelineVar, anim),
        })),
        ...extractStandaloneGsapTransformCalls(stripJsComments(script.content)),
      ];

      for (const call of calls) {
        // set() is instantaneous — it never animates, so it cannot stutter. A set() that
        // seats an integer-snapped layout position (e.g. tl.set("#x",{left:100})) before a
        // later transform tween is a single from-state frame, not motion; intentionally skipped.
        if (call.method === "set") continue;
        // Object.hasOwn, not `in`: a tween property named `toString`/`constructor` would
        // match the prototype chain and resolve LAYOUT_FIX[p] to an inherited function.
        let layoutProps = call.properties.filter((p) => Object.hasOwn(LAYOUT_FIX, p));
        const reflowProps = call.properties.filter((p) => REFLOW_PROPS.includes(p));
        const usesRoundProps = call.properties.includes("roundProps");
        // Only positional props are html-in-canvas-exempt: the canvas positions the draw
        // from sub-pixel computed left/top. Reflow props (glyph layout) and roundProps
        // (value rounding) snap upstream of the raster, so they always fire.
        if (layoutProps.length > 0 && allTargetsHtmlInCanvas(call.selector)) layoutProps = [];
        if (layoutProps.length === 0 && reflowProps.length === 0 && !usesRoundProps) continue;

        const flagged = [...layoutProps, ...reflowProps, ...(usesRoundProps ? ["roundProps"] : [])];
        const message =
          `GSAP tween on "${call.selector}" uses motion that snaps to integer device pixels: ` +
          `${flagged.join(", ")}. Layout and text-reflow properties snap during browser layout; ` +
          "roundProps rounds the tween value. Slow motion or an ease-out tail then stutters under " +
          "the seek-by-frame capture engine — animate transforms (x/y/scale/opacity) instead.";

        const fixes: string[] = [];
        if (layoutProps.length > 0) {
          const tokens = [...new Set(layoutProps.flatMap((p) => LAYOUT_FIX[p] ?? []))];
          fixes.push(
            `replace ${layoutProps.join("/")} with the transform equivalent (${tokens.join(", ")}) — ` +
              `e.g. tl.fromTo("${call.selector}", { x: -1300 }, { x: 0, ...yourAnimation })`,
          );
        }
        if (reflowProps.length > 0) {
          // Faithful fix differs by property: fontSize maps to scale (same visual), but
          // letterSpacing/wordSpacing do NOT — uniform scale resizes glyphs, it does not
          // change the gaps between them. The smooth equivalent of a spacing tween is a
          // per-glyph split with an x transform per character.
          const sizing = reflowProps.filter((p) => p === "fontSize");
          const spacing = reflowProps.filter((p) => p !== "fontSize");
          const parts: string[] = [];
          if (sizing.length > 0) {
            parts.push(`replace ${sizing.join("/")} with scale (same visual, no reflow)`);
          }
          if (spacing.length > 0) {
            parts.push(
              `for ${spacing.join("/")}, split the text into per-character elements and animate ` +
                "each glyph's x (the spread) — uniform scale is NOT equivalent — or hold the final value statically",
            );
          }
          fixes.push(
            `do not animate ${reflowProps.join("/")} (they reflow text and snap glyph positions): ` +
              parts.join("; "),
          );
        }
        if (usesRoundProps) fixes.push("remove roundProps");
        const fixHint = `${fixes.join("; ")}. Transforms interpolate sub-pixel and stay smooth at any speed.`;

        findings.push({
          code: "gsap_non_transform_motion",
          severity: "error",
          message,
          selector: call.selector,
          fixHint,
          snippet: truncateSnippet(call.raw),
        });
      }
    }
    return findings;
  },

  // gsap_relative_value_second_writer — a relative tween value ("+=..."/"-=...") on a
  // property that another writer is still ACTIVE on when the relative tween starts.
  // The relative tween captures its base at tween INIT, which happens on first render:
  // the sequential path inits it mid-flight of the other writer, a cold render worker
  // landing later inits it with the other writer's end state — the same frame then
  // renders at two different positions (a visible snap at chunk boundaries).
  // GSAP renders children in start-time order within a single seek pass, so a writer
  // that completes strictly BEFORE the relative tween's start yields identical bases
  // on every seek path and is never flagged. Single-writer relative values are
  // seek-stable. from()/fromTo() resolve their values at build (immediateRender), so
  // they are exempt. The position PARAMETER ("+=0.5") is not a tween value — the
  // parser keeps it out of properties — so it can never be flagged here.
  async ({ scripts, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const tagsByToken = indexTagsByToken(tags);
    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const windows = await cachedExtractGsapWindows(script.content);
      for (const win of windows) {
        if (win.method === "from" || win.method === "fromTo") continue;
        if (win.overwriteAuto) continue;
        if (targetHasNoStableIdentity(win.targetSelector, win.targetIdentity)) continue;
        const relativeProps = Object.entries(win.propertyValues)
          .filter(([, value]) => isRelativeTweenValue(value))
          .map(([prop]) => prop);
        if (relativeProps.length === 0) continue;
        const target = { selector: win.targetSelector, identity: win.targetIdentity };
        for (const other of windows) {
          if (other === win) continue;
          if (other.position > win.position || other.end <= win.position) continue;
          const sharedProps = relativeProps.filter((prop) => other.properties.includes(prop));
          if (sharedProps.length === 0) continue;
          if (
            !targetsShareElement(
              target,
              { selector: other.targetSelector, identity: other.targetIdentity },
              tagsByToken,
            )
          ) {
            continue;
          }
          const values = sharedProps
            .map((prop) => `${prop}: "${win.propertyValues[prop]}"`)
            .join(", ");
          const overlapEnd = Math.min(win.end, other.end);
          const formatTime = (t: number): string => (Number.isFinite(t) ? `${t.toFixed(2)}s` : "∞");
          findings.push({
            code: "gsap_relative_value_second_writer",
            severity: "error",
            message:
              `Relative value(s) ${values} on "${win.targetSelector}" start while another writer for the same ` +
              `propert${sharedProps.length > 1 ? "ies" : "y"} is active between ${formatTime(win.position)} and ${formatTime(overlapEnd)}. ` +
              "Relative tweens capture their base at tween init: the sequential path inits mid-flight of the other " +
              "writer, a cold render worker landing later inits with its end state — the same frame renders at two " +
              "different positions (snap at chunk boundaries).",
            selector: win.targetSelector,
            fixHint:
              `Use absolute values for ${sharedProps.join(", ")}, or a fromTo() with explicit endpoints, so every seek ` +
              "path resolves the same state. Single-writer relative values are safe; the conflict is the second writer.",
            snippet: truncateSnippet(`${win.raw}\n${other.raw}`),
          });
        }
      }
    }
    return findings;
  },

  // gsap_repeat_refresh_relative_value — repeatRefresh re-resolves the tween's values
  // on every repeat iteration, so a relative value ACCUMULATES per cycle. A cold render
  // worker seeking non-linearly into iteration N skips the accumulation a sequential
  // playhead performed, so workers disagree on where the element is.
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const source = stripJsComments(script.content);
      const pattern = /repeatRefresh\s*:\s*true\b/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const objectLiteral = enclosingObjectLiteral(source, match.index);
        if (!objectLiteral || !objectLiteralHasTopLevelRelativeValue(objectLiteral)) continue;
        findings.push({
          code: "gsap_repeat_refresh_relative_value",
          severity: "error",
          message:
            '`repeatRefresh: true` combined with a relative value ("+="/"-=") accumulates per repeat iteration. ' +
            "A cold render worker seeking non-linearly into iteration N never performed the earlier iterations' " +
            "accumulation, so its rendered position diverges from the sequential path.",
          fixHint:
            "Remove `repeatRefresh: true`, or replace the relative value with absolute endpoints (e.g. a fromTo()) " +
            "so each iteration resolves to the same state on every seek path.",
          snippet: truncateSnippet(objectLiteral),
        });
      }
    }
    return findings;
  },

  // gsap_function_value_hazard — function-valued tween vars re-run at tween INIT,
  // which is seek-order-dependent. A value reading transform-SENSITIVE geometry
  // (getBoundingClientRect/getComputedStyle/gsap.getProperty) captures whatever state
  // the worker's own seek order produced — error. Transform-INVARIANT layout reads
  // (offsetWidth, getTotalLength, ...) are deterministic across cold render workers
  // unless the measured layout itself animates — warning. GSAP function values receive
  // (index, target, targets) — index is a NUMBER, so a method call on the first
  // parameter (assuming it is the element) throws at init — error. Pure-index
  // arithmetic, gsap.utils.wrap/distribute, and closures over constants are statically
  // opaque or safe and are never flagged.
  //
  // Uses the raw parser output instead of the windows machinery: windows drop tweens
  // with string positions ("+=0.5", labels), and position is irrelevant to whether a
  // VALUE is hazardous.
  async ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    const parseGsapScript = await loadParseGsapScript();
    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const parsed = parseGsapScript(script.content);
      for (const anim of parsed.animations) {
        const raw = synthesizeWindowRaw(parsed.timelineVar, anim);
        const entries = [
          ...Object.entries(anim.properties),
          ...Object.entries(anim.fromProperties ?? {}),
        ];
        for (const [prop, value] of entries) {
          if (typeof value !== "string" || !value.startsWith("__raw:")) continue;
          const fn = parseFunctionValueSource(value.slice(6));
          // Non-function raw values (gsap.utils.wrap(...), identifiers, arithmetic)
          // are statically opaque — conservatively skipped.
          if (!fn) continue;
          const readsSensitive = TRANSFORM_SENSITIVE_READ.test(fn.body);
          const readsInvariant = TRANSFORM_INVARIANT_READ.test(fn.body);
          const badMember = firstParamMemberAccessHazard(fn);
          if (!readsSensitive && !readsInvariant && !badMember) continue;
          const reason = readsSensitive
            ? "reads transform-sensitive geometry, so its result depends on the worker's own seek order"
            : badMember
              ? `accesses .${badMember} on its first parameter — GSAP function values receive (index, target, targets), ` +
                "so the first parameter is a NUMBER and this throws at tween init"
              : "measures layout at tween init, which is deterministic across cold render workers only while the measured layout never animates";
          findings.push({
            code: "gsap_function_value_hazard",
            severity: readsSensitive || badMember ? "error" : "warning",
            message: `Function-valued tween var for ${prop} on "${anim.targetSelector}" ${reason}. Each render worker initializes tweens independently.`,
            selector: anim.targetSelector,
            fixHint: badMember
              ? "Use the SECOND parameter for the element: (index, target) => ... — or index arithmetic like (i) => i * 20."
              : "Compute the value once at build time (before the timeline is registered) and pass a constant, or derive it from fixed composition coordinates.",
            snippet: truncateSnippet(raw),
          });
        }
      }
    }
    return findings;
  },

  // gsap_callback_dom_measurement — DOM measurement reachable from timeline callbacks
  // (tl.add(fn) / tl.call(fn) / eventCallback / onStart-style vars). The capture path
  // seeks with suppressEvents=false (core/src/adapters/gsap.ts), so callbacks re-fire
  // on EVERY seek, including rewinds — and a cold render worker executes them against
  // whatever DOM state its own non-linear seek order produced. Geometry measured
  // inside a callback is therefore seek-order-dependent, and anything measured before
  // the callback ran (e.g. a build-time getTotalLength() on a path whose `d` the
  // callback assigns) is stale or zero. Warning, not error: gsap.getProperty-style
  // derived-output callbacks were excluded, but the remaining reads can still be
  // legitimate when the measured layout is static.
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const source = stripJsComments(script.content);
      if (!/gsap\.timeline/.test(source)) continue;
      const signatures = collectNamedFunctionSignatures(source);
      const measuring = collectMeasuringFunctionNames(signatures);

      // A callback argument is hazardous when it is an inline function whose body
      // reaches a measurement, or a bare reference to a measuring function. Call
      // expressions (`tl.add(build())`) execute at BUILD time, not as callbacks —
      // conservatively skipped.
      const callbackExpressionHazard = (expression: string): boolean => {
        const trimmed = expression.trim();
        const inline = parseFunctionValueSource(trimmed);
        if (inline) return expressionReachesMeasurement(inline.body, measuring, signatures);
        if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return measuring.has(trimmed);
        return false;
      };
      // The callback site goes into the structured `selector` field: the linter
      // dedupes on code+selector+message, and a constant message would collapse
      // distinct callback sites into a single finding.
      const report = (site: string, snippet: string): void => {
        findings.push({
          code: "gsap_callback_dom_measurement",
          severity: "warning",
          message:
            "Timeline callback reaches DOM measurement (getBoundingClientRect/getTotalLength/getComputedStyle/...). " +
            "The renderer seeks with suppressEvents=false, so callbacks re-fire on every seek — and a cold render " +
            "worker runs them against whatever DOM state its own non-linear seek order produced. Measured geometry is " +
            "seek-order-dependent, and values measured at build time (before the callback ran) are stale or zero.",
          selector: truncateSnippet(site, 120),
          fixHint:
            "Do all measurement and DOM setup synchronously at build time, before registering the timeline — " +
            "or derive geometry from fixed composition coordinates instead of measuring.",
          snippet: truncateSnippet(snippet),
        });
      };

      const timelineVars = collectTimelineVarNames(source);
      for (const timelineVar of timelineVars) {
        const callPattern = new RegExp(
          `\\b${escapeRegExp(timelineVar)}\\.(?:add|call)\\s*\\(`,
          "g",
        );
        let match: RegExpExecArray | null;
        while ((match = callPattern.exec(source)) !== null) {
          const parenIndex = match.index + match[0].length - 1;
          const argsWithParens = matchBalanced(source, parenIndex, "(", ")");
          if (!argsWithParens) continue;
          // Passes `source` + an absolute index, like every sibling call below —
          // never a fresh slice (`argsWithParens.slice(1, -1)`), which would mask
          // a brand-new string: an unnecessary `stripJsStringLiterals` scan of the
          // whole script on every call, and one more entry competing for space in
          // `maskLiterals`'s LRU alongside `source`'s own (already cached) mask.
          const firstArg = sliceExpression(source, parenIndex + 1);
          const site = match[0] + firstArg + ", ...)";
          if (callbackExpressionHazard(firstArg)) report(site, site);
        }

        const eventCallbackPattern = new RegExp(
          `\\b${escapeRegExp(timelineVar)}\\.eventCallback\\s*\\(\\s*["']on[A-Za-z]+["']\\s*,`,
          "g",
        );
        while ((match = eventCallbackPattern.exec(source)) !== null) {
          const expression = sliceExpression(source, eventCallbackPattern.lastIndex);
          const site = match[0] + expression + ")";
          if (callbackExpressionHazard(expression)) report(site, site);
        }
      }

      const varsCallbackPattern =
        /\bon(?:Start|Update|Complete|Repeat|ReverseComplete|Interrupt|Overwrite)\s*:\s*/g;
      let match: RegExpExecArray | null;
      while ((match = varsCallbackPattern.exec(source)) !== null) {
        if (!isInsideGsapTweenVars(source, match.index, timelineVars)) continue;
        const expression = sliceExpression(source, varsCallbackPattern.lastIndex);
        const site = match[0] + expression;
        if (callbackExpressionHazard(expression)) report(site, site);
      }
    }
    return findings;
  },

  // gsap_timeline_return_used_as_tween — `tl.to()` returns the TIMELINE, not the tween it just
  // created. `gsap.to()` returns a Tween, so the two read identically and behave nothing alike.
  // Capturing the timeline's return and later treating it as an individual animation aims a
  // tween-scoped call at the whole composition: `.kill()` on it interrupts the master timeline
  // and detaches it from its parent, which stops a parent-driven seek dead while leaving an
  // explicit `tl.progress()` still working -- so a render of the packaged defaults looks fine
  // and only live playback breaks. A rebuild that collected these to discard them also leaves
  // every previous keyframe in place and stacks the new ones on top.
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const source = stripJsComments(script.content);
      const timelineVars = collectTimelineVarNames(source);
      if (timelineVars.length === 0) continue;
      const receivers = timelineVars.map(escapeRegExp).join("|");
      // Two capture shapes: collecting into an array, or binding to a name. Keying on the
      // known timeline handles is what keeps `gsap.to()` -- and `Array.from()` -- out of it.
      const pattern = new RegExp(
        String.raw`(?:\.push\s*\(\s*|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)(?:${receivers})\s*\.\s*(to|from|fromTo|set|call|add)\s*\(`,
        "g",
      );
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const boundName = match[1];
        const method = match[2]!;
        // A bound name is only a problem once something tween-scoped is aimed at it; pushing
        // into an array is already the collect-to-discard shape this exists to stop.
        if (boundName) {
          const treatedAsTween = new RegExp(
            String.raw`\b${escapeRegExp(boundName)}\s*\.\s*(?:kill|revert|invalidate|pause|resume|restart|seek|progress|timeScale)\s*\(`,
          );
          if (!treatedAsTween.test(source)) continue;
        }
        const contextStart = Math.max(0, match.index - 40);
        findings.push({
          code: "gsap_timeline_return_used_as_tween",
          severity: "error",
          message:
            `\`${match[0].includes(".push") ? "push" : boundName}\` captures the return of \`.${method}()\` on timeline \`${timelineVars[0]}\`, ` +
            "but a timeline's `.to()`/`.from()`/`.set()` returns THE TIMELINE ITSELF, not the tween it created. " +
            "Every captured value is the same master timeline, so a tween-scoped call on it — `.kill()` above all — " +
            "hits the whole composition: it interrupts the timeline and detaches it from its parent, which freezes a " +
            "parent-driven seek while an explicit `tl.progress()` keeps working. Only `gsap.to()` returns a tween.",
          fixHint:
            "To build a group of keyframes you can later discard, put them in a nested timeline: " +
            "`const nested = gsap.timeline(); nested.to(...); tl.add(nested, 0);` — then `nested.kill()` " +
            "replaces exactly those keyframes and cannot reach `tl`. Children keep their absolute times when the " +
            "nest is added at 0. To hold a single real tween, create it with `gsap.to(...)` and place it with `tl.add(tween, at)`.",
          snippet: truncateSnippet(source.slice(contextStart, match.index + match[0].length + 60)),
        });
      }
    }
    return findings;
  },

  // gsap_group_selector_keyframes
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    const pattern = /\.(?:to|from|fromTo)\(\s*["']([^"']+,\s*[^"']+)["']\s*,\s*\{[^}]*keyframes/g;
    for (const { match, snippet } of scanScriptsForRegexMatches(scripts, pattern, {
      stripComments: true,
      contextBefore: 20,
      contextAfter: 40,
    })) {
      const selector = match[1]!;
      const count = selector.split(",").length;
      findings.push({
        code: "gsap_group_selector_keyframes",
        severity: "warning",
        message:
          `GSAP tween targets ${count} elements with shared keyframes ("${truncateSnippet(selector, 60)}"). ` +
          `Editing one element's keyframes in Studio will affect all ${count} elements. ` +
          `Split into individual tweens for per-element keyframe control.`,
        fixHint:
          `Replace the group selector with individual tl.to() calls per element, ` +
          `each with their own keyframes object.`,
        snippet: truncateSnippet(snippet),
      });
    }
    return findings;
  },

  // svg_drawon_css_dasharray_conflict — GSAP sets/tweens strokeDasharray on an element
  // whose CSS declares a MULTI-component stroke-dasharray (e.g. `10 10`). GSAP merges
  // dash lists per component, so `strokeDasharray: 641.4` over CSS `10 10` computes to
  // "641.4px, 10px" — the gap stays 10px and the hide-then-draw-on trick silently
  // fails: the line is visible the whole scene. A static two-component GSAP value is
  // the explicit fix form and is not flagged.
  // fallow-ignore-next-line complexity
  ({ scripts, styles, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const tagsByToken = indexTagsByToken(tags);

    const multiDashTokens = new Set<string>();
    for (const style of styles) {
      for (const [, selectorList, body] of style.content.matchAll(/([^{}]+)\{([^}]+)\}/g)) {
        if (!selectorList || !body) continue;
        const value = readStyleProperty(body, "stroke-dasharray");
        if (!value || !isMultiComponentDasharray(value)) continue;
        // Skip combinator groups — scope-dependent, unsafe to correlate by leaf token.
        for (const group of selectorList.split(",")) {
          const trimmed = group.trim();
          if (!trimmed || /[\s>+~]/.test(trimmed)) continue;
          for (const token of targetedSelectorTokens(trimmed)) multiDashTokens.add(token);
        }
      }
    }
    for (const tag of tags) {
      const inlineValue = readStyleProperty(readAttr(tag.raw, "style") ?? "", "stroke-dasharray");
      if (!inlineValue || !isMultiComponentDasharray(inlineValue)) continue;
      for (const token of tagSimpleSelectors(tag)) multiDashTokens.add(token);
    }
    if (multiDashTokens.size === 0) return findings;

    for (const script of scripts) {
      const source = stripJsComments(script.content);
      const varTokens = resolveScriptElementTokens(source, tags);
      const reported = new Set<string>();

      const writerPattern =
        /\b[\w$]+\.(set|to|fromTo)\s*\(\s*(?:(["'])([^"'`]+)\2|([A-Za-z_$][\w$]*))\s*,\s*\{/g;
      let match: RegExpExecArray | null;
      while ((match = writerPattern.exec(source)) !== null) {
        const method = match[1] ?? "";
        const braceIndex = match.index + match[0].length - 1;
        const firstVars = matchBalanced(source, braceIndex, "{", "}");
        if (!firstVars) continue;
        const varsObjects = [firstVars];
        if (method === "fromTo") {
          const afterFirst = source.slice(braceIndex + firstVars.length);
          const secondOpen = /^\s*,\s*\{/.exec(afterFirst);
          if (secondOpen) {
            const secondBrace = braceIndex + firstVars.length + secondOpen[0].length - 1;
            const secondVars = matchBalanced(source, secondBrace, "{", "}");
            if (secondVars) varsObjects.push(secondVars);
          }
        }

        const quotedSelector = match[3];
        const targetTokens = quotedSelector
          ? targetedSelectorTokens(quotedSelector)
          : (varTokens.get(match[4] ?? "") ?? new Set<string>());
        if (targetTokens.size === 0) continue;
        const expanded = elementLevelTokens(targetTokens, tagsByToken);

        for (const varsObject of varsObjects) {
          const propMatch =
            varsObject.match(/\bstrokeDasharray\s*:\s*/) ??
            varsObject.match(/["']stroke-dasharray["']\s*:\s*/);
          if (!propMatch || propMatch.index === undefined) continue;
          const valueSource = sliceExpression(varsObject, propMatch.index + propMatch[0].length);
          if (gsapDasharrayValueLooksMultiComponent(valueSource)) continue;
          const conflictToken = [...expanded].find((token) => multiDashTokens.has(token));
          if (!conflictToken) continue;
          const targetLabel = quotedSelector ?? match[4] ?? "";
          if (reported.has(targetLabel + conflictToken)) continue;
          reported.add(targetLabel + conflictToken);
          findings.push({
            code: "svg_drawon_css_dasharray_conflict",
            severity: "error",
            message:
              `GSAP writes strokeDasharray on "${targetLabel}", but its CSS ("${conflictToken}") declares a multi-component ` +
              'stroke-dasharray. GSAP merges dash lists per component, so the CSS gap survives (e.g. "641.4px, 10px") — ' +
              "the draw-on hide only hides one gap's worth and the line stays visible the whole scene.",
            selector: quotedSelector ?? undefined,
            fixHint:
              `Remove the CSS stroke-dasharray from "${conflictToken}" (decorative dashes belong on a separate element), ` +
              'or set the full two-component value in GSAP: strokeDasharray: "${len} ${len}".',
            snippet: truncateSnippet(match[0] + firstVars.slice(1)),
          });
        }
      }
    }
    return findings;
  },

  // gsap_timeline_set_initial_hide — a zero-duration tl.set(...) at position 0 inside
  // the paused timeline does NOT render while the playhead sits exactly at 0 (verified
  // against this repo's GSAP: tl.time(0) leaves the target untouched; only a seek past
  // 0 applies it). Frame 0 therefore shows the UN-hidden state, then the element pops
  // hidden on frame 1 — and only for the worker that renders frame 0. Targets already
  // hidden by authored CSS/inline styles or by a standalone gsap.set are exempt: the
  // tl.set is then a defensive re-assertion and frame 0 is hidden anyway.
  //
  // Only sets that precede every tween in source order qualify: the parser resolves a
  // mutated position variable (`var t = 0; ...; tl.set(sel, vars, t)`) to its INITIAL
  // binding, so late hard-kills can masquerade as position-0 sets. Genuine
  // initial-state hides are authored before the timeline's tweens.
  async ({ scripts, styles, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const cssHiddenSelectors = collectCssOpacityZeroSelectors(styles, tags);
    const tagsByToken = indexTagsByToken(tags);
    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const windows = await cachedExtractGsapWindows(script.content);
      const alreadyHidden = new Set([
        ...cssHiddenSelectors,
        ...extractStandaloneHiddenSelectors(script.content),
      ]);
      const isInstantHold = (win: GsapWindow): boolean =>
        win.method === "set" ||
        ((win.method === "to" || win.method === "fromTo") && win.end === win.position);
      const firstTweenIndex = windows.findIndex((win) => !isInstantHold(win));
      const initialHolds = firstTweenIndex < 0 ? windows : windows.slice(0, firstTweenIndex);
      for (const win of initialHolds) {
        if (!isInstantHold(win) || win.position !== 0) continue;
        if (win.global || win.immediateRender === true) continue;
        if (targetHasNoStableIdentity(win.targetSelector, win.targetIdentity)) continue;
        const targetTokens = [...targetedSelectorTokens(win.targetSelector)];
        const hiddenByToken =
          targetTokens.length > 0 && targetTokens.every((token) => alreadyHidden.has(token));
        const resolvedTags = targetTokens.flatMap((token) => tagsByToken.get(token) ?? []);
        const hiddenByElement =
          resolvedTags.length > 0 &&
          resolvedTags.every((tag) =>
            tagSimpleSelectors(tag).some((token) => alreadyHidden.has(token)),
          );
        if (hiddenByToken || hiddenByElement) continue;
        const offset = win.propertyValues["strokeDashoffset"];
        const hidesByOffset = numberValue(offset) !== null && !zeroValue(offset);
        const hides =
          isHiddenGsapState(win.propertyValues) ||
          zeroValue(win.propertyValues["scale"]) ||
          hidesByOffset;
        if (!hides) continue;
        findings.push({
          code: "gsap_timeline_set_initial_hide",
          severity: "warning",
          message:
            `Initial hidden state for "${win.targetSelector}" is set via tl.set(...) at position 0 inside the paused ` +
            "timeline. A zero-duration set at 0 does not render while the playhead sits exactly at 0, so frame 0 " +
            "shows the un-hidden state.",
          selector: win.targetSelector,
          fixHint:
            "Use gsap.set(...) (immediate, outside the timeline) for initial states, or author the hidden state " +
            "directly in CSS/attributes.",
          snippet: truncateSnippet(win.raw),
        });
      }
    }
    return findings;
  },

  // svg_measure_before_path_d — getTotalLength() on a <path> that has no static `d`
  // attribute in the HTML. In Chrome getTotalLength() on a d-less path returns 0,
  // silently killing dash animations (offset 0 == length 0 == nothing to draw). If a
  // d assignment exists but only inside a function body, execution order is statically
  // undecidable — WARNING; if NO d assignment exists anywhere — ERROR. Element
  // identity is resolved conservatively (literal / template getElementById,
  // querySelector); createElementNS-built paths and unresolved variables are skipped.
  // fallow-ignore-next-line complexity
  ({ scripts, styles, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const tagsByToken = indexTagsByToken(tags);
    // CSS `d: path(...)` supplies geometry statically — treat like a static attribute.
    const cssProvidesD = styles.some((style) => /\bd\s*:\s*path\(/.test(style.content));

    for (const script of scripts) {
      const source = stripJsComments(script.content);
      const varTokens = resolveScriptElementTokens(source, tags);
      const functionRanges = collectFunctionBodyRanges(source);
      const createdVars = new Set(
        [...source.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*document\.createElementNS\(/g)].map(
          (m) => m[1] ?? "",
        ),
      );
      // `d` assignments come in two forms: direct setAttribute('d', ...) and the
      // GSAP attr plugin (`gsap.set(wire, { attr: { d: "..." } })`). Both count,
      // with the same lexical-order semantics.
      const dAssignments = [
        ...[...source.matchAll(/\b([A-Za-z_$][\w$]*)\.setAttribute\(\s*["']d["']\s*,/g)].map(
          (m) => ({ varName: m[1] ?? "", index: m.index ?? 0 }),
        ),
        ...[
          ...source.matchAll(
            /\.(?:set|to|fromTo)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{[^{}]*\battr\s*:\s*\{[^{}]*\bd\s*:/g,
          ),
        ].map((m) => ({ varName: m[1] ?? "", index: m.index ?? 0 })),
      ];
      const reported = new Set<string>();

      const measurePattern = /\b([A-Za-z_$][\w$]*)\.getTotalLength\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = measurePattern.exec(source)) !== null) {
        const varName = match[1] ?? "";
        if (createdVars.has(varName)) continue;
        const tokens = varTokens.get(varName);
        if (!tokens || tokens.size === 0) continue;
        // Only <path> elements without a static d attribute qualify.
        const resolvedTags = [...tokens].flatMap((token) => tagsByToken.get(token) ?? []);
        const dLessPaths = resolvedTags.filter(
          (tag) => tag.name.toLowerCase() === "path" && readAttr(tag.raw, "d") === null,
        );
        if (dLessPaths.length === 0 || dLessPaths.length !== resolvedTags.length) continue;
        if (cssProvidesD) continue;

        // A same-variable d assignment lexically before the measure, in scope of the
        // measure (top-level, or a function body containing the measure), is the
        // legitimate synchronous assign-then-measure pattern.
        const measureIndex = match.index;
        const assignedBeforeInScope = dAssignments.some(
          (assign) =>
            assign.varName === varName &&
            assign.index < measureIndex &&
            (!indexInsideAnyRange(assign.index, functionRanges) ||
              functionRanges.some(
                (range) =>
                  assign.index > range.start &&
                  assign.index < range.end &&
                  measureIndex > range.start &&
                  measureIndex < range.end,
              )),
        );
        if (assignedBeforeInScope) continue;

        const sameVarAssignmentExists = dAssignments.some((a) => a.varName === varName);
        const tokenLabel = [...tokens].join(", ");
        if (reported.has(tokenLabel)) continue;
        reported.add(tokenLabel);
        findings.push({
          code: "svg_measure_before_path_d",
          severity: sameVarAssignmentExists ? "warning" : "error",
          message: sameVarAssignmentExists
            ? `getTotalLength() is called on "${tokenLabel}", whose \`d\` is only assigned inside a function body — ` +
              "if the measure runs before that function (e.g. the function is a timeline callback), the length is 0 " +
              "and the dash animation is dead."
            : `getTotalLength() is called on "${tokenLabel}", but the path has no static \`d\` attribute and no d ` +
              "assignment exists anywhere — getTotalLength() returns 0 in Chrome, silently killing dash animations.",
          selector: tokenLabel,
          fixHint:
            "Assign the path's `d` synchronously at build time (top level, before measuring), or author a static " +
            "d attribute in the HTML.",
          snippet: truncateSnippet(match[0] + ")"),
        });
      }
    }
    return findings;
  },
];
