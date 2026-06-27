interface LintParsedGsap {
  animations: Array<{
    targetSelector: string;
    method: string;
    position: number | string;
    properties: Record<string, number | string>;
    duration?: number;
    ease?: string;
    extras?: Record<string, unknown>;
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
import type { LintContext } from "../context";
import type { HyperframeLintFinding, LintRule } from "../types";
import type { OpenTag } from "../utils";
import {
  readAttr,
  truncateSnippet,
  stripJsComments,
  WINDOW_TIMELINE_ASSIGN_PATTERN,
} from "../utils";

// ── GSAP-specific types ────────────────────────────────────────────────────

type GsapWindow = {
  targetSelector: string;
  position: number;
  end: number;
  properties: string[];
  propertyValues: Record<string, string | number>;
  overwriteAuto: boolean;
  method: string;
  raw: string;
};

type CompositionRange = {
  id: string;
  start: number;
  end: number;
};

const SCENE_BOUNDARY_EPSILON_SECONDS = 0.05;

// ── GSAP parsing utilities ─────────────────────────────────────────────────

function countClassUsage(tags: OpenTag[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    const classAttr = readAttr(tag.raw, "class");
    if (!classAttr) continue;
    for (const className of classAttr.split(/\s+/).filter(Boolean)) {
      counts.set(className, (counts.get(className) || 0) + 1);
    }
  }
  return counts;
}

function readRegisteredTimelineCompositionId(script: string): string | null {
  const match = script.match(WINDOW_TIMELINE_ASSIGN_PATTERN);
  return match?.[1] || match?.[2] || null;
}

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
    // Skip animations with string positions (e.g. "+=1", "<") — their absolute
    // timing depends on runtime evaluation and can't be statically linted.
    if (typeof animation.position !== "number") continue;
    const repeat = extrasNumber(animation.extras?.repeat);
    const cycleCount = repeat > 0 ? repeat + 1 : 1;
    const effectiveDuration =
      animation.method === "set" ? 0 : (animation.duration ?? 0) * cycleCount;
    windows.push({
      targetSelector: animation.targetSelector,
      position: animation.position,
      end: animation.position + effectiveDuration,
      properties: Object.keys(animation.properties),
      propertyValues: animation.properties,
      overwriteAuto: unwrapRaw(animation.extras?.overwrite) === "auto",
      method: animation.method,
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

function isSceneBoundaryExit(win: GsapWindow): boolean {
  if (win.end <= win.position) return false;
  if (win.method !== "to" && win.method !== "fromTo") return false;
  return isHiddenGsapState(win.propertyValues);
}

function isHardKillSet(win: GsapWindow, selector: string, boundary: number): boolean {
  return (
    win.method === "set" &&
    win.targetSelector === selector &&
    Math.abs(win.position - boundary) <= SCENE_BOUNDARY_EPSILON_SECONDS &&
    isHiddenGsapState(win.propertyValues)
  );
}

function hiddenStateLiteral(values: Record<string, string | number>): string {
  if (zeroValue(values.autoAlpha)) return "{ autoAlpha: 0 }";
  if (zeroValue(values.opacity)) return "{ opacity: 0 }";
  if (stringValue(values.visibility)?.toLowerCase() === "hidden") return '{ visibility: "hidden" }';
  if (stringValue(values.display)?.toLowerCase() === "none") return '{ display: "none" }';
  return "{ opacity: 0 }";
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

function collectCompositionRanges(source: string, tags: OpenTag[]): CompositionRange[] {
  return tags
    .map((tag) => {
      const id = readAttr(tag.raw, "data-composition-id");
      if (!id) return null;
      return {
        id,
        start: tag.index,
        end: findTagEnd(source, tag),
      };
    })
    .filter((range) => range !== null);
}

function findContainingCompositionId(tag: OpenTag, ranges: CompositionRange[]): string | null {
  let match: CompositionRange | null = null;
  for (const range of ranges) {
    if (tag.index < range.start || tag.index >= range.end) continue;
    if (!match || range.start >= match.start) match = range;
  }
  return match?.id || null;
}

function collectClipStartBoundariesByComposition(
  source: string,
  tags: OpenTag[],
): Map<string, number[]> {
  const ranges = collectCompositionRanges(source, tags);
  const boundaries = new Map<string, Set<number>>();

  for (const tag of tags) {
    const classAttr = readAttr(tag.raw, "class") || "";
    const classes = classAttr.split(/\s+/).filter(Boolean);
    if (!classes.includes("clip")) continue;
    const compositionId = findContainingCompositionId(tag, ranges);
    if (!compositionId) continue;
    const start = numberValue(readAttr(tag.raw, "data-start") ?? undefined);
    if (start == null || start <= 0) continue;
    const compositionBoundaries = boundaries.get(compositionId) ?? new Set<number>();
    compositionBoundaries.add(start);
    boundaries.set(compositionId, compositionBoundaries);
  }

  return new Map(
    [...boundaries.entries()].map(([compositionId, values]) => [
      compositionId,
      [...values].sort((a, b) => a - b),
    ]),
  );
}

function findMatchingSceneBoundary(time: number, boundaries: number[]): number | null {
  for (const boundary of boundaries) {
    if (Math.abs(time - boundary) <= SCENE_BOUNDARY_EPSILON_SECONDS) return boundary;
  }
  return null;
}

function isSuspiciousGlobalSelector(selector: string): boolean {
  if (!selector) return false;
  if (selector.includes("[data-composition-id=")) return false;
  if (selector.startsWith("#")) return false;
  return selector.startsWith(".") || /^[a-z]/i.test(selector);
}

function getSingleClassSelector(selector: string): string | null {
  const match = selector.trim().match(/^\.(?<name>[A-Za-z0-9_-]+)$/);
  return match?.groups?.name || null;
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

// ── GSAP rules ─────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export const gsapRules: LintRule<LintContext>[] = [
  // overlapping_gsap_tweens + gsap_animates_clip_element + unscoped_gsap_selector
  // fallow-ignore-next-line complexity
  async ({ source, tags, scripts, styles, rootCompositionId }) => {
    const findings: HyperframeLintFinding[] = [];

    // Build clip element selector map
    type ClipInfo = { tag: string; id: string; classes: string };
    const clipIds = new Map<string, ClipInfo>();
    const clipClasses = new Map<string, ClipInfo>();
    for (const tag of tags) {
      const classAttr = readAttr(tag.raw, "class") || "";
      const classes = classAttr.split(/\s+/).filter(Boolean);
      if (!classes.includes("clip")) continue;
      const id = readAttr(tag.raw, "id");
      const info: ClipInfo = {
        tag: tag.name,
        id: id || "",
        classes: classAttr,
      };
      if (id) clipIds.set(`#${id}`, info);
      for (const cls of classes) {
        if (cls !== "clip") clipClasses.set(`.${cls}`, info);
      }
    }

    const classUsage = countClassUsage(tags);
    const clipStartBoundariesByComposition = collectClipStartBoundariesByComposition(source, tags);
    const styleRules = collectSimpleStyleRules(styles);
    const reportedVisibleOverlayKeys = new Set<string>();

    for (const script of scripts) {
      const localTimelineCompId = readRegisteredTimelineCompositionId(script.content);
      const gsapWindows = await cachedExtractGsapWindows(script.content);
      const clipStartBoundaries =
        clipStartBoundariesByComposition.get(localTimelineCompId || rootCompositionId || "") ?? [];

      // overlapping_gsap_tweens
      for (let i = 0; i < gsapWindows.length; i++) {
        const left = gsapWindows[i];
        if (!left) continue;
        if (left.end <= left.position) continue;
        for (let j = i + 1; j < gsapWindows.length; j++) {
          const right = gsapWindows[j];
          if (!right) continue;
          if (right.end <= right.position) continue;
          if (left.targetSelector !== right.targetSelector) continue;
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

      // gsap_exit_missing_hard_kill
      if (clipStartBoundaries.length > 0) {
        for (const win of gsapWindows) {
          if (!isSceneBoundaryExit(win)) continue;
          const boundary = findMatchingSceneBoundary(win.end, clipStartBoundaries);
          if (boundary == null) continue;
          const hasHardKill = gsapWindows.some((candidate) =>
            isHardKillSet(candidate, win.targetSelector, boundary),
          );
          if (hasHardKill) continue;

          findings.push({
            code: "gsap_exit_missing_hard_kill",
            severity: "error",
            message:
              `GSAP exit on "${win.targetSelector}" ends at the ${boundary.toFixed(2)}s clip start boundary ` +
              "without a matching tl.set hard kill. Non-linear seeking can land after the fade and leave stale visibility state.",
            selector: win.targetSelector,
            fixHint:
              `Add \`tl.set("${win.targetSelector}", ${hiddenStateLiteral(win.propertyValues)}, ${boundary.toFixed(2)})\` ` +
              "after the exit tween.",
            snippet: truncateSnippet(win.raw),
          });
        }
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
            win.position <= SCENE_BOUNDARY_EPSILON_SECONDS && isHiddenGsapState(win.propertyValues),
        );
        if (startsHiddenAtZero) continue;
        const firstVisible = visibilityWindows.find((win) => makesOverlayVisible(win));
        if (!firstVisible) continue;
        const selector =
          selectors.find((candidate) =>
            targetedSelectorTokens(firstVisible.targetSelector).has(candidate),
          ) ||
          selectors[0] ||
          tag.name;
        const laterHidden = visibilityWindows.some(
          (win) => win.position >= firstVisible.position && isHiddenGsapState(win.propertyValues),
        );
        if (firstVisible.method !== "from" && !laterHidden) continue;

        reportedVisibleOverlayKeys.add(overlayKey);
        findings.push({
          code: "gsap_fullscreen_overlay_starts_visible",
          severity: "error",
          message:
            `Full-frame overlay "${selector}" starts visible before its first GSAP opacity tween at ` +
            `${firstVisible.position.toFixed(2)}s. It will cover earlier render frames, often as a blank/white video.`,
          selector,
          elementId: readAttr(tag.raw, "id") || undefined,
          fixHint:
            `Add \`opacity: 0\` to "${selector}" in CSS/inline styles, or add ` +
            `\`tl.set("${selector}", { opacity: 0 }, 0)\` before the reveal tween.`,
          snippet: truncateSnippet(firstVisible.raw),
        });
      }

      // gsap_animates_clip_element — only error when GSAP animates visibility/display
      for (const win of gsapWindows) {
        const sel = win.targetSelector;
        const clipInfo = clipIds.get(sel) || clipClasses.get(sel);
        if (!clipInfo) continue;
        const conflictingProps = win.properties.filter(
          (p) => p === "visibility" || p === "display",
        );
        if (conflictingProps.length === 0) continue;
        const elDesc = `<${clipInfo.tag}${clipInfo.id ? ` id="${clipInfo.id}"` : ""} class="${clipInfo.classes}">`;
        findings.push({
          code: "gsap_animates_clip_element",
          severity: "error",
          message: `GSAP animation sets ${conflictingProps.join(", ")} on a clip element. Selector "${sel}" resolves to element ${elDesc}. The framework manages clip visibility via ${conflictingProps.join("/")} — do not animate these properties on clip elements.`,
          selector: sel,
          elementId: clipInfo.id || undefined,
          fixHint:
            "Remove the visibility/display tween, or move the content into a child <div> and target that instead.",
          snippet: truncateSnippet(win.raw),
        });
      }

      // unscoped_gsap_selector
      if (!localTimelineCompId || localTimelineCompId === rootCompositionId) continue;
      for (const win of gsapWindows) {
        if (!isSuspiciousGlobalSelector(win.targetSelector)) continue;
        const className = getSingleClassSelector(win.targetSelector);
        if (className && (classUsage.get(className) || 0) < 2) continue;
        findings.push({
          code: "unscoped_gsap_selector",
          severity: "error",
          message: `Timeline "${localTimelineCompId}" uses unscoped selector "${win.targetSelector}" that will target elements in ALL compositions when bundled, causing data loss (opacity, transforms, etc.).`,
          selector: win.targetSelector,
          fixHint: `Scope the selector: \`[data-composition-id="${localTimelineCompId}"] ${win.targetSelector}\` or use a unique id.`,
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

  // audio_reactive_single_tween_per_group
  // fallow-ignore-next-line complexity
  ({ scripts, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const isCaptionFile = styles.some((s) => /\.caption[-_]?(?:group|word)/i.test(s.content));
    if (!isCaptionFile) return findings;

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
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = stripJsComments(script.content);
      // Match repeat: -1 in GSAP tweens or timeline configs
      const pattern = /repeat\s*:\s*-1(?!\d)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const contextStart = Math.max(0, match.index - 60);
        const contextEnd = Math.min(content.length, match.index + match[0].length + 60);
        const snippet = content.slice(contextStart, contextEnd).trim();
        findings.push({
          code: "gsap_infinite_repeat",
          severity: "error",
          message:
            "GSAP tween uses `repeat: -1` (infinite). Infinite repeats break the deterministic " +
            "capture engine which seeks to exact frame times. Use a finite repeat count calculated " +
            "from the composition duration: `repeat: Math.floor(duration / cycleDuration) - 1`.",
          fixHint:
            "Replace `repeat: -1` with a finite count, e.g. `repeat: Math.floor(totalDuration / singleCycleDuration) - 1`. " +
            "Use Math.floor (not Math.ceil) to ensure the animation fits within the total duration.",
          snippet: truncateSnippet(snippet),
        });
      }
    }
    return findings;
  },

  // gsap_repeat_ceil_overshoot
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = script.content;
      // Match patterns like: repeat: Math.ceil(duration / X) - 1
      // or repeat: Math.ceil(totalDuration / cycleDuration) - 1
      const pattern = /repeat\s*:\s*Math\.ceil\s*\([^)]+\)\s*-\s*1/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const contextStart = Math.max(0, match.index - 40);
        const contextEnd = Math.min(content.length, match.index + match[0].length + 40);
        const snippet = content.slice(contextStart, contextEnd).trim();
        findings.push({
          code: "gsap_repeat_ceil_overshoot",
          severity: "warning",
          message:
            "GSAP repeat calculation uses `Math.ceil` which can overshoot the composition duration. " +
            "For example, Math.ceil(10.5 / 2) - 1 = 5 repeats → 6 cycles × 2s = 12s, exceeding 10.5s.",
          fixHint:
            "Use `Math.floor` instead of `Math.ceil` to ensure the animation fits within the duration: " +
            "`repeat: Math.floor(totalDuration / cycleDuration) - 1`. " +
            "Math.floor(10.5 / 2) - 1 = 4 repeats → 5 cycles × 2s = 10s ✓",
          snippet: truncateSnippet(snippet),
        });
      }
    }
    return findings;
  },

  // scene_layer_missing_visibility_kill
  ({ scripts, tags }) => {
    const findings: HyperframeLintFinding[] = [];

    // Detect multi-scene compositions: multiple elements with "scene" in their id
    const sceneElements = tags.filter((t) => {
      const id = readAttr(t.raw, "id") || "";
      return /^scene\d+$/i.test(id);
    });
    if (sceneElements.length < 2) return findings;

    for (const script of scripts) {
      const content = stripJsComments(script.content);
      // For each scene, check if there's a visibility:hidden set after exit tweens
      for (const tag of sceneElements) {
        const id = readAttr(tag.raw, "id") || "";
        // Check if this scene has exit tweens (opacity: 0)
        const exitPattern = new RegExp(`["']#${id}["'][^)]*opacity\\s*:\\s*0`);
        const hasExit = exitPattern.test(content);
        if (!hasExit) continue;

        // Check if there's a hard visibility kill
        const killPattern = new RegExp(`["']#${id}["'][^)]*visibility\\s*:\\s*["']hidden["']`);
        const hasKill = killPattern.test(content);
        if (!hasKill) {
          findings.push({
            code: "scene_layer_missing_visibility_kill",
            severity: "error",
            elementId: id,
            message:
              `Scene layer "#${id}" exits via opacity tween but has no visibility: hidden hard kill. ` +
              "When scrubbing or when tweens conflict, the scene may remain partially visible and overlap the next scene.",
            fixHint: `Add \`tl.set("#${id}", { visibility: "hidden" }, <exit-end-time>)\` after the scene's exit tweens.`,
          });
        }
      }
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
      const hasRegistration = WINDOW_TIMELINE_ASSIGN_PATTERN.test(content);
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

  // gsap_from_opacity_noop — CSS opacity:0 + gsap.from({opacity:0}) = invisible forever
  // fallow-ignore-next-line complexity
  async ({ styles, scripts, tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const cssOpacityZeroSelectors = new Set<string>();

    for (const style of styles) {
      for (const [, selector, body] of style.content.matchAll(
        /([#.][a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g,
      )) {
        if (body && /opacity\s*:\s*0\s*[;}]/.test(body)) {
          cssOpacityZeroSelectors.add((selector ?? "").trim());
        }
      }
    }

    for (const tag of tags) {
      const inlineStyle = readAttr(tag.raw, "style");
      if (!inlineStyle || !/opacity\s*:\s*0/.test(inlineStyle)) continue;
      const id = readAttr(tag.raw, "id");
      const classes = readAttr(tag.raw, "class")?.split(/\s+/).filter(Boolean) ?? [];
      if (id) cssOpacityZeroSelectors.add(`#${id}`);
      for (const cls of classes) cssOpacityZeroSelectors.add(`.${cls}`);
    }

    if (cssOpacityZeroSelectors.size === 0) return findings;

    for (const script of scripts) {
      if (!/gsap\.timeline/.test(script.content)) continue;
      const windows = await cachedExtractGsapWindows(script.content);

      for (const win of windows) {
        if (win.method !== "from") continue;
        if (!win.properties.includes("opacity")) continue;
        // Only a noop when the tween animates FROM 0 (same as the CSS value)
        if (win.propertyValues["opacity"] !== 0) continue;
        const sel = win.targetSelector;
        const cssKey = sel.startsWith("#") || sel.startsWith(".") ? sel : `#${sel}`;
        if (!cssOpacityZeroSelectors.has(cssKey)) continue;

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

  // gsap_group_selector_keyframes
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = stripJsComments(script.content);
      const pattern = /\.(?:to|from|fromTo)\(\s*["']([^"']+,\s*[^"']+)["']\s*,\s*\{[^}]*keyframes/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const selector = match[1]!;
        const count = selector.split(",").length;
        const contextStart = Math.max(0, match.index - 20);
        const contextEnd = Math.min(content.length, match.index + match[0].length + 40);
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
          snippet: truncateSnippet(content.slice(contextStart, contextEnd)),
        });
      }
    }
    return findings;
  },
];
