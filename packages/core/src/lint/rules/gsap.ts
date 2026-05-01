import { parseGsapScript } from "../../parsers/gsapParser";
import type { LintContext, HyperframeLintFinding } from "../context";
import type { OpenTag } from "../utils";
import { readAttr, truncateSnippet, WINDOW_TIMELINE_ASSIGN_PATTERN } from "../utils";

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

const META_GSAP_KEYS = new Set(["duration", "ease", "repeat", "yoyo", "overwrite", "delay"]);
const SCENE_BOUNDARY_EPSILON_SECONDS = 0.05;

// ── GSAP parsing utilities ─────────────────────────────────────────────────

function stripJsComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length) {
        const blockCh = source[i] ?? "";
        const blockNext = source[i + 1] ?? "";
        if (blockCh === "*" && blockNext === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += blockCh === "\n" || blockCh === "\r" ? blockCh : " ";
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

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
  return match?.[1] || null;
}

function extractGsapWindows(script: string): GsapWindow[] {
  if (!/gsap\.timeline/.test(script)) return [];
  const parsed = parseGsapScript(script);
  if (parsed.animations.length === 0) return [];

  const windows: GsapWindow[] = [];
  const timelineVar = parsed.timelineVar;
  const methodPattern = new RegExp(
    `${timelineVar}\\.(set|to|from|fromTo)\\s*\\(([^)]+(?:\\{[^}]*\\}[^)]*)+)\\)`,
    "g",
  );

  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = methodPattern.exec(script)) !== null && index < parsed.animations.length) {
    const raw = match[0];
    const args = match[2] ?? "";
    // Skip calls whose first argument is not a quoted selector (e.g. object
    // targets like `tl.to({ _: 0 }, …)` used to anchor timeline duration).
    // `parseGsapScript` ignores those, so we must too — otherwise the regex
    // match index drifts ahead of `parsed.animations[index]` and every
    // subsequent window picks up the wrong animation's selector/position.
    if (!/^\s*["']/.test(args)) continue;
    const meta = parseGsapWindowMeta(match[1] ?? "", args);
    const animation = parsed.animations[index];
    index += 1;
    if (!animation) continue;
    windows.push({
      targetSelector: animation.targetSelector,
      position: animation.position,
      end: animation.position + meta.effectiveDuration,
      properties: meta.properties.length > 0 ? meta.properties : Object.keys(animation.properties),
      propertyValues: meta.propertyValues,
      overwriteAuto: meta.overwriteAuto,
      method: match[1] ?? "to",
      raw,
    });
  }
  return windows;
}

function parseGsapWindowMeta(
  method: string,
  argsStr: string,
): {
  effectiveDuration: number;
  properties: string[];
  propertyValues: Record<string, string | number>;
  overwriteAuto: boolean;
} {
  const emptyMeta = {
    effectiveDuration: 0,
    properties: [],
    propertyValues: {},
    overwriteAuto: false,
  };
  const selectorMatch = argsStr.match(/^\s*["']([^"']+)["']\s*,/);
  if (!selectorMatch) return emptyMeta;

  const afterSelector = argsStr.slice(selectorMatch[0].length);
  let properties: Record<string, string | number> = {};
  let fromProperties: Record<string, string | number> = {};

  if (method === "fromTo") {
    const firstBrace = afterSelector.indexOf("{");
    const firstEnd = findMatchingBrace(afterSelector, firstBrace);
    if (firstBrace !== -1 && firstEnd !== -1) {
      fromProperties = parseLooseObjectLiteral(afterSelector.slice(firstBrace, firstEnd + 1));
      const secondPart = afterSelector.slice(firstEnd + 1);
      const secondBrace = secondPart.indexOf("{");
      const secondEnd = findMatchingBrace(secondPart, secondBrace);
      if (secondBrace !== -1 && secondEnd !== -1) {
        properties = parseLooseObjectLiteral(secondPart.slice(secondBrace, secondEnd + 1));
      }
    }
  } else {
    const braceStart = afterSelector.indexOf("{");
    const braceEnd = findMatchingBrace(afterSelector, braceStart);
    if (braceStart !== -1 && braceEnd !== -1) {
      properties = parseLooseObjectLiteral(afterSelector.slice(braceStart, braceEnd + 1));
    }
  }

  const duration = numberValue(properties.duration) || 0;
  const repeat = numberValue(properties.repeat) || 0;
  const cycleCount = repeat > 0 ? repeat + 1 : 1;
  const effectiveDuration = duration * cycleCount;
  const overwriteAuto = stringValue(properties.overwrite) === "auto";

  const propertyNames = new Set<string>();
  for (const key of Object.keys(fromProperties)) {
    if (!META_GSAP_KEYS.has(key)) propertyNames.add(key);
  }
  for (const key of Object.keys(properties)) {
    if (!META_GSAP_KEYS.has(key)) propertyNames.add(key);
  }

  return {
    effectiveDuration: method === "set" ? 0 : effectiveDuration,
    properties: [...propertyNames],
    propertyValues: properties,
    overwriteAuto,
  };
}

function parseLooseObjectLiteral(source: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const cleaned = source.replace(/^\{|\}$/g, "").trim();
  if (!cleaned) return result;
  const propertyPattern = /(\w+)\s*:\s*("[^"]*"|'[^']*'|true|false|-?[\d.]+|[a-zA-Z_][\w.]*)/g;
  let match: RegExpExecArray | null;
  while ((match = propertyPattern.exec(cleaned)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue == null) continue;
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      result[key] = rawValue.slice(1, -1);
      continue;
    }
    const numeric = Number(rawValue);
    result[key] = Number.isFinite(numeric) ? numeric : rawValue;
  }
  return result;
}

function findMatchingBrace(source: string, startIndex: number): number {
  if (startIndex < 0) return -1;
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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

// ── GSAP rules ─────────────────────────────────────────────────────────────

export const gsapRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // overlapping_gsap_tweens + gsap_animates_clip_element + unscoped_gsap_selector
  ({ source, tags, scripts, rootCompositionId }) => {
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

    for (const script of scripts) {
      const localTimelineCompId = readRegisteredTimelineCompositionId(script.content);
      const gsapWindows = extractGsapWindows(script.content);
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
            severity: "warning",
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
          severity: "warning",
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
  ({ styles, scripts, tags }) => {
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
      const windows = extractGsapWindows(script.content);

      type Conflict = { cssTransform: string; props: Set<string>; raw: string };
      const conflicts = new Map<string, Conflict>();

      for (const win of windows) {
        if (win.method === "fromTo") continue;
        const sel = win.targetSelector;
        const cssKey = sel.startsWith("#") || sel.startsWith(".") ? sel : `#${sel}`;
        const translateProps = win.properties.filter((p) =>
          ["x", "y", "xPercent", "yPercent"].includes(p),
        );
        const scaleProps = win.properties.filter((p) => p === "scale");
        const cssFromTranslate =
          translateProps.length > 0 ? cssTranslateSelectors.get(cssKey) : undefined;
        const cssFromScale = scaleProps.length > 0 ? cssScaleSelectors.get(cssKey) : undefined;
        if (!cssFromTranslate && !cssFromScale) continue;
        const existing = conflicts.get(sel) ?? {
          cssTransform: [cssFromTranslate, cssFromScale].filter(Boolean).join(" "),
          props: new Set<string>(),
          raw: win.raw,
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
          severity: "warning",
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
      const content = script.content;
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
            severity: "warning",
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
];
