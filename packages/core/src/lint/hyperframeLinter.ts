import { parseGsapScript } from "../parsers/gsapParser";
import type { HyperframeLintFinding, HyperframeLinterOptions, HyperframeLintResult } from "./types";

type OpenTag = {
  raw: string;
  name: string;
  attrs: string;
  index: number;
};

type ExtractedBlock = {
  attrs: string;
  content: string;
  raw: string;
  index: number;
};

type GsapWindow = {
  targetSelector: string;
  position: number;
  end: number;
  properties: string[];
  overwriteAuto: boolean;
  raw: string;
};

const TAG_PATTERN = /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi;
const STYLE_BLOCK_PATTERN = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const COMPOSITION_ID_IN_CSS_PATTERN = /\[data-composition-id=["']([^"']+)["']\]/g;
const TIMELINE_REGISTRY_INIT_PATTERN =
  /window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}|window\.__timelines\s*=\s*\{\}|window\.__timelines\s*\?\?=\s*\{\}/i;
const TIMELINE_REGISTRY_ASSIGN_PATTERN = /window\.__timelines\[[^\]]+\]\s*=/i;
const INVALID_SCRIPT_CLOSE_PATTERN = /<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i;
const WINDOW_TIMELINE_ASSIGN_PATTERN =
  /window\.__timelines\[\s*["']([^"']+)["']\s*\]\s*=\s*([A-Za-z_$][\w$]*)/i;

const META_GSAP_KEYS = new Set(["duration", "ease", "repeat", "yoyo", "overwrite", "delay"]);

export function lintHyperframeHtml(
  html: string,
  options: HyperframeLinterOptions = {},
): HyperframeLintResult {
  const source = html || "";
  const filePath = options.filePath;
  const findings: HyperframeLintFinding[] = [];
  const seen = new Set<string>();

  const pushFinding = (finding: HyperframeLintFinding) => {
    const dedupeKey = [
      finding.code,
      finding.severity,
      finding.selector || "",
      finding.elementId || "",
      finding.message,
    ].join("|");
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    findings.push(filePath ? { ...finding, file: filePath } : finding);
  };

  const tags = extractOpenTags(source);
  const styles = extractBlocks(source, STYLE_BLOCK_PATTERN);
  const scripts = extractBlocks(source, SCRIPT_BLOCK_PATTERN);
  const compositionIds = collectCompositionIds(tags);
  const rootTag = findRootTag(source);
  const rootCompositionId = readAttr(rootTag?.raw || "", "data-composition-id");

  if (!rootTag || !readAttr(rootTag.raw, "data-composition-id")) {
    pushFinding({
      code: "root_missing_composition_id",
      severity: "error",
      message: "Root composition is missing `data-composition-id`.",
      elementId: rootTag ? readAttr(rootTag.raw, "id") || undefined : undefined,
      fixHint: "Add a stable `data-composition-id` to the entry composition wrapper.",
      snippet: truncateSnippet(rootTag?.raw || ""),
    });
  }

  if (!rootTag || !readAttr(rootTag.raw, "data-width") || !readAttr(rootTag.raw, "data-height")) {
    pushFinding({
      code: "root_missing_dimensions",
      severity: "error",
      message: "Root composition is missing `data-width` or `data-height`.",
      elementId: rootTag ? readAttr(rootTag.raw, "id") || undefined : undefined,
      fixHint: "Set numeric `data-width` and `data-height` on the entry composition root.",
      snippet: truncateSnippet(rootTag?.raw || ""),
    });
  }

  if (
    !TIMELINE_REGISTRY_INIT_PATTERN.test(source) &&
    !TIMELINE_REGISTRY_ASSIGN_PATTERN.test(source)
  ) {
    pushFinding({
      code: "missing_timeline_registry",
      severity: "error",
      message: "Missing `window.__timelines` registration.",
      fixHint: "Register each composition timeline on `window.__timelines[compositionId]`.",
    });
  }

  if (INVALID_SCRIPT_CLOSE_PATTERN.test(source)) {
    pushFinding({
      code: "invalid_inline_script_syntax",
      severity: "error",
      message: "Detected malformed inline `<script>` closing syntax.",
      fixHint: "Close inline scripts with a valid `</script>` tag.",
    });
  }

  for (const script of scripts) {
    const attrs = script.attrs || "";
    if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["']application\/json["']/.test(attrs)) {
      continue;
    }
    const syntaxError = getInlineScriptSyntaxError(script.content);
    if (!syntaxError) {
      continue;
    }
    pushFinding({
      code: "invalid_inline_script_syntax",
      severity: "error",
      message: `Inline script has invalid syntax: ${syntaxError}`,
      fixHint: "Fix the inline script syntax before render verification.",
      snippet: truncateSnippet(script.content),
    });
  }

  for (const tag of tags) {
    const src = readAttr(tag.raw, "data-composition-src");
    if (!src) {
      continue;
    }
    const compId = readAttr(tag.raw, "data-composition-id");
    if (compId) {
      continue;
    }
    pushFinding({
      code: "host_missing_composition_id",
      severity: "error",
      message: `Composition host for "${src}" is missing \`data-composition-id\`.`,
      elementId: readAttr(tag.raw, "id") || undefined,
      fixHint: "Set `data-composition-id` on every `data-composition-src` host element.",
      snippet: truncateSnippet(tag.raw),
    });
  }

  const scopedCssCompositionIds = new Set<string>();
  for (const style of styles) {
    for (const compId of extractCompositionIdsFromCss(style.content)) {
      scopedCssCompositionIds.add(compId);
    }
  }

  for (const compId of scopedCssCompositionIds) {
    if (compositionIds.has(compId)) {
      continue;
    }
    pushFinding({
      code: "scoped_css_missing_wrapper",
      severity: "warning",
      message: `Scoped CSS targets composition "${compId}" but no matching wrapper exists in this HTML.`,
      selector: `[data-composition-id="${compId}"]`,
      fixHint:
        "Preserve the matching composition wrapper or align the CSS scope to an existing wrapper.",
    });
  }

  const mediaById = new Map<string, OpenTag[]>();
  const mediaFingerprintCounts = new Map<string, number>();
  for (const tag of tags) {
    if (!isMediaTag(tag.name)) {
      continue;
    }
    const elementId = readAttr(tag.raw, "id");
    if (elementId) {
      const existing = mediaById.get(elementId) || [];
      existing.push(tag);
      mediaById.set(elementId, existing);
    }
    const fingerprint = [
      tag.name,
      readAttr(tag.raw, "src") || "",
      readAttr(tag.raw, "data-start") || "",
      readAttr(tag.raw, "data-duration") || "",
    ].join("|");
    mediaFingerprintCounts.set(fingerprint, (mediaFingerprintCounts.get(fingerprint) || 0) + 1);
  }

  for (const [elementId, mediaTags] of mediaById) {
    if (mediaTags.length < 2) {
      continue;
    }
    pushFinding({
      code: "duplicate_media_id",
      severity: "error",
      message: `Media id "${elementId}" is defined multiple times.`,
      elementId,
      fixHint:
        "Give each media element a unique id so preview and producer discover the same media graph.",
      snippet: truncateSnippet(mediaTags[0]?.raw || ""),
    });
  }

  for (const [fingerprint, count] of mediaFingerprintCounts) {
    if (count < 2) {
      continue;
    }
    const [tagName, src, dataStart, dataDuration] = fingerprint.split("|");
    pushFinding({
      code: "duplicate_media_discovery_risk",
      severity: "warning",
      message: `Detected ${count} matching ${tagName} entries with the same source/start/duration.`,
      fixHint: "Avoid duplicated media nodes that can be discovered twice during compilation.",
      snippet: truncateSnippet(
        `${tagName} src=${src} data-start=${dataStart} data-duration=${dataDuration}`,
      ),
    });
  }

  const classUsage = countClassUsage(tags);
  for (const script of scripts) {
    const localTimelineCompId = readRegisteredTimelineCompositionId(script.content);
    const gsapWindows = extractGsapWindows(script.content);

    for (let i = 0; i < gsapWindows.length; i++) {
      const left = gsapWindows[i];
      if (!left) continue;
      if (left.end <= left.position) {
        continue;
      }
      for (let j = i + 1; j < gsapWindows.length; j++) {
        const right = gsapWindows[j];
        if (!right) continue;
        if (right.end <= right.position) {
          continue;
        }
        if (left.targetSelector !== right.targetSelector) {
          continue;
        }
        const overlapStart = Math.max(left.position, right.position);
        const overlapEnd = Math.min(left.end, right.end);
        if (overlapEnd <= overlapStart) {
          continue;
        }
        if (left.overwriteAuto || right.overwriteAuto) {
          continue;
        }
        const sharedProperties = left.properties.filter((prop) => right.properties.includes(prop));
        if (sharedProperties.length === 0) {
          continue;
        }
        pushFinding({
          code: "overlapping_gsap_tweens",
          severity: "warning",
          message: `GSAP tweens overlap on "${left.targetSelector}" for ${sharedProperties.join(", ")} between ${overlapStart.toFixed(2)}s and ${overlapEnd.toFixed(2)}s.`,
          selector: left.targetSelector,
          fixHint: 'Shorten the earlier tween, move the later tween, or add `overwrite: "auto"`.',
          snippet: truncateSnippet(`${left.raw}\n${right.raw}`),
        });
      }
    }

    if (!localTimelineCompId || localTimelineCompId === rootCompositionId) {
      continue;
    }
    for (const window of gsapWindows) {
      if (!isSuspiciousGlobalSelector(window.targetSelector)) {
        continue;
      }
      const className = getSingleClassSelector(window.targetSelector);
      if (className && (classUsage.get(className) || 0) < 2) {
        continue;
      }
      pushFinding({
        code: "suspicious_global_gsap_selector",
        severity: "warning",
        message: `Timeline "${localTimelineCompId}" uses a global selector "${window.targetSelector}" that may escape composition scope.`,
        selector: window.targetSelector,
        fixHint: `Scope the selector like \`[data-composition-id="${localTimelineCompId}"] ${window.targetSelector}\` or use a unique id.`,
        snippet: truncateSnippet(window.raw),
      });
    }
  }

  // ── Composition pitfall checks ──────────────────────────────────────────

  // #2: Video without muted attribute (audio should come from separate <audio>)
  for (const tag of tags) {
    if (tag.name !== "video") continue;
    const hasMuted = /\bmuted\b/i.test(tag.raw);
    if (!hasMuted && readAttr(tag.raw, "data-start")) {
      const elementId = readAttr(tag.raw, "id") || undefined;
      pushFinding({
        code: "video_missing_muted",
        severity: "error",
        message: `<video${elementId ? ` id="${elementId}"` : ""}> has data-start but is not muted. The framework expects video to be muted with a separate <audio> element for sound.`,
        elementId,
        fixHint:
          "Add the `muted` attribute to the <video> tag and use a separate <audio> element with the same src for audio playback.",
        snippet: truncateSnippet(tag.raw),
      });
    }
  }

  // #3: Video nested inside a timed element (data-start on ancestor)
  // Approximation: check if a <video data-start> appears inside another element with data-start
  // by scanning for video tags whose raw position is between another timed element's open/close
  const timedTagPositions: Array<{ name: string; start: number; id?: string }> = [];
  for (const tag of tags) {
    if (tag.name === "video" || tag.name === "audio") continue;
    if (readAttr(tag.raw, "data-start")) {
      timedTagPositions.push({
        name: tag.name,
        start: tag.index,
        id: readAttr(tag.raw, "id") || undefined,
      });
    }
  }
  for (const tag of tags) {
    if (tag.name !== "video") continue;
    if (!readAttr(tag.raw, "data-start")) continue;
    // Check if any timed non-media element appears before this video in the source
    // and could be an ancestor (heuristic — not a full DOM parse)
    for (const parent of timedTagPositions) {
      if (parent.start < tag.index) {
        // Check if there's a closing tag for the parent between parent.start and tag.index
        const parentClosePattern = new RegExp(`</${parent.name}>`, "gi");
        const between = source.substring(parent.start, tag.index);
        if (!parentClosePattern.test(between)) {
          pushFinding({
            code: "video_nested_in_timed_element",
            severity: "warning",
            message: `<video> with data-start appears to be nested inside <${parent.name}${parent.id ? ` id="${parent.id}"` : ""}> which also has data-start. This can break media sync.`,
            elementId: readAttr(tag.raw, "id") || undefined,
            fixHint:
              "Move the <video> to be a direct child of the stage, or remove data-start from the wrapper div (use it as a non-timed visual container).",
            snippet: truncateSnippet(tag.raw),
          });
          break; // Only report once per video
        }
      }
    }
  }

  // #4: Timed element missing visibility:hidden (no class="clip" or equivalent)
  for (const tag of tags) {
    if (tag.name === "audio" || tag.name === "script" || tag.name === "style") continue;
    if (!readAttr(tag.raw, "data-start")) continue;
    const classAttr = readAttr(tag.raw, "class") || "";
    const styleAttr = readAttr(tag.raw, "style") || "";
    const hasClip = classAttr.split(/\s+/).includes("clip");
    const hasHiddenStyle = /visibility\s*:\s*hidden/i.test(styleAttr);
    if (!hasClip && !hasHiddenStyle) {
      const elementId = readAttr(tag.raw, "id") || undefined;
      pushFinding({
        code: "timed_element_missing_visibility_hidden",
        severity: "warning",
        message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> has data-start but no class="clip" or visibility:hidden. The framework needs elements to start hidden so it can manage their lifecycle.`,
        elementId,
        fixHint: 'Add class="clip" to the element (with CSS: .clip { visibility: hidden; }).',
        snippet: truncateSnippet(tag.raw),
      });
    }
  }

  // #5: Deprecated attribute names
  for (const tag of tags) {
    if (readAttr(tag.raw, "data-layer") && !readAttr(tag.raw, "data-track-index")) {
      const elementId = readAttr(tag.raw, "id") || undefined;
      pushFinding({
        code: "deprecated_data_layer",
        severity: "warning",
        message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> uses data-layer instead of data-track-index.`,
        elementId,
        fixHint: "Replace data-layer with data-track-index. The runtime reads data-track-index.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    if (readAttr(tag.raw, "data-end") && !readAttr(tag.raw, "data-duration")) {
      const elementId = readAttr(tag.raw, "id") || undefined;
      pushFinding({
        code: "deprecated_data_end",
        severity: "warning",
        message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> uses data-end without data-duration. Use data-duration in source HTML.`,
        elementId,
        fixHint:
          "Replace data-end with data-duration. The compiler generates data-end from data-duration automatically.",
        snippet: truncateSnippet(tag.raw),
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.length - errorCount;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    findings,
  };
}

function extractOpenTags(source: string): OpenTag[] {
  const tags: OpenTag[] = [];
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    const raw = match[0];
    if (raw.startsWith("</") || raw.startsWith("<!")) {
      continue;
    }
    tags.push({
      raw,
      name: (match[1] || "").toLowerCase(),
      attrs: match[2] || "",
      index: match.index,
    });
  }
  return tags;
}

function extractBlocks(source: string, pattern: RegExp): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push({
      attrs: match[1] || "",
      content: match[2] || "",
      raw: match[0],
      index: match.index,
    });
  }
  return blocks;
}

function findRootTag(source: string): OpenTag | null {
  const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? (bodyMatch[1] ?? source) : source;
  const bodyTags = extractOpenTags(bodyContent);
  for (const tag of bodyTags) {
    if (["script", "style", "meta", "link", "title"].includes(tag.name)) {
      continue;
    }
    return tag;
  }
  return null;
}

function readAttr(tagSource: string, attr: string): string | null {
  if (!tagSource) {
    return null;
  }
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tagSource.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || null;
}

function collectCompositionIds(tags: OpenTag[]): Set<string> {
  const ids = new Set<string>();
  for (const tag of tags) {
    const compId = readAttr(tag.raw, "data-composition-id");
    if (compId) {
      ids.add(compId);
    }
  }
  return ids;
}

function extractCompositionIdsFromCss(css: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = COMPOSITION_ID_IN_CSS_PATTERN.exec(css)) !== null) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

function getInlineScriptSyntaxError(source: string): string | null {
  if (!source.trim()) {
    return null;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(source);
    return null;
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

function isMediaTag(tagName: string): boolean {
  return tagName === "video" || tagName === "audio" || tagName === "img";
}

function countClassUsage(tags: OpenTag[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    const classAttr = readAttr(tag.raw, "class");
    if (!classAttr) {
      continue;
    }
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
  if (!/gsap\.timeline/.test(script)) {
    return [];
  }

  const parsed = parseGsapScript(script);
  if (parsed.animations.length === 0) {
    return [];
  }

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
    const meta = parseGsapWindowMeta(match[1] ?? "", match[2] ?? "");
    const animation = parsed.animations[index];
    index += 1;
    if (!animation) {
      continue;
    }
    windows.push({
      targetSelector: animation.targetSelector,
      position: animation.position,
      end: animation.position + meta.effectiveDuration,
      properties: meta.properties.length > 0 ? meta.properties : Object.keys(animation.properties),
      overwriteAuto: meta.overwriteAuto,
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
  overwriteAuto: boolean;
} {
  const selectorMatch = argsStr.match(/^\s*["']([^"']+)["']\s*,/);
  if (!selectorMatch) {
    return { effectiveDuration: 0, properties: [], overwriteAuto: false };
  }

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
  const yoyo = stringValue(properties.yoyo) === "true";
  const cycleCount = repeat > 0 ? repeat + 1 : 1;
  const effectiveDuration = duration * cycleCount * (yoyo ? 1 : 1);
  const overwriteAuto = stringValue(properties.overwrite) === "auto";

  const propertyNames = new Set<string>();
  for (const key of Object.keys(fromProperties)) {
    if (!META_GSAP_KEYS.has(key)) {
      propertyNames.add(key);
    }
  }
  for (const key of Object.keys(properties)) {
    if (!META_GSAP_KEYS.has(key)) {
      propertyNames.add(key);
    }
  }

  return {
    effectiveDuration: method === "set" ? 0 : effectiveDuration,
    properties: [...propertyNames],
    overwriteAuto,
  };
}

function parseLooseObjectLiteral(source: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const cleaned = source.replace(/^\{|\}$/g, "").trim();
  if (!cleaned) {
    return result;
  }

  const propertyPattern = /(\w+)\s*:\s*("[^"]*"|'[^']*'|true|false|-?[\d.]+|[a-zA-Z_][\w.]*)/g;
  let match: RegExpExecArray | null;
  while ((match = propertyPattern.exec(cleaned)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue == null) {
      continue;
    }
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
  if (startIndex < 0) {
    return -1;
  }
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function numberValue(value: string | number | undefined): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function stringValue(value: string | number | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function isSuspiciousGlobalSelector(selector: string): boolean {
  if (!selector) {
    return false;
  }
  if (selector.includes("[data-composition-id=")) {
    return false;
  }
  if (selector.startsWith("#")) {
    return false;
  }
  return selector.startsWith(".") || /^[a-z]/i.test(selector);
}

function getSingleClassSelector(selector: string): string | null {
  const match = selector.trim().match(/^\.(?<name>[A-Za-z0-9_-]+)$/);
  return match?.groups?.name || null;
}

function truncateSnippet(value: string, maxLength = 220): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}
