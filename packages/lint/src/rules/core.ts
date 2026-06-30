import type { LintContext, HyperframeLintFinding } from "../context";
import postcss from "postcss";
import {
  readAttr,
  truncateSnippet,
  stripJsComments,
  extractCompositionIdsFromCss,
  extractTimelineRegistryKeys,
  getInlineScriptSyntaxError,
  TIMELINE_REGISTRY_INIT_PATTERN,
  TIMELINE_REGISTRY_ASSIGN_PATTERN,
  INVALID_SCRIPT_CLOSE_PATTERN,
} from "../utils";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectorTargetsCompositionId(selector: string, compositionId: string): boolean {
  const escaped = escapeRegExp(compositionId);
  return new RegExp(
    String.raw`\[\s*data-composition-id\s*=\s*(?:"${escaped}"|'${escaped}')\s*\]`,
  ).test(selector);
}

function isStudioTimelineElement(tag: { raw: string; name: string }): boolean {
  if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) {
    return false;
  }
  return Boolean(
    readAttr(tag.raw, "data-start") ||
    readAttr(tag.raw, "data-track-index") ||
    readAttr(tag.raw, "data-track") ||
    readAttr(tag.raw, "data-composition-src") ||
    readAttr(tag.raw, "data-composition-file"),
  );
}

function describeStudioElement(tag: { raw: string; name: string }): string {
  const parts = [`<${tag.name}`];
  const className = readAttr(tag.raw, "class");
  const compositionId = readAttr(tag.raw, "data-composition-id");
  const dataStart = readAttr(tag.raw, "data-start");
  const dataTrack = readAttr(tag.raw, "data-track-index") ?? readAttr(tag.raw, "data-track");

  if (className) {
    const primaryClass = className
      .split(/\s+/)
      .map((value) => value.trim())
      .find((value) => value && value !== "clip");
    if (primaryClass) parts.push(` class="${primaryClass}"`);
  }
  if (compositionId) parts.push(` data-composition-id="${compositionId}"`);
  if (dataStart) parts.push(` data-start="${dataStart}"`);
  if (dataTrack) parts.push(` data-track-index="${dataTrack}"`);
  parts.push(">");
  return parts.join("");
}

const HEAD_BLOCKS_TO_IGNORE_PATTERN =
  /<(?:style|script|template|title|noscript)\b[^>]*>[\s\S]*?<\/(?:style|script|template|title|noscript)(?:\s[^>]*)?>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const HEAD_CONTENT_PATTERN = /<head\b[^>]*>([\s\S]*?)(?:<\/head>|<body\b|$)/gi;
const AFTER_HEAD_BEFORE_BODY_PATTERN = /<\/head(?:\s[^>]*)?>([\s\S]*?)(?=<body\b|$)/gi;
const STRAY_HEAD_CLOSE_PATTERN = /<\/(?:style|script)(?:\s[^>]*)?>/i;
const MARKDOWN_CODE_FENCE_PATTERN = /```[^\r\n`]*(?:\r?\n|$)[\s\S]*?```/i;
const ORPHAN_CSS_AT_RULE_PATTERN =
  /(?:^|\s)@(?:container|font-face|keyframes|layer|media|page|property|scope|supports)[^{<]*\{[\s\S]*?:[\s\S]*?\}/i;
const ORPHAN_CSS_RULE_PATTERN =
  /(?:^|\s)(?:\/\*[\s\S]*?\*\/\s*)?(?:@[a-z-]+[^{}<]*|[.#][\w-]+[^{}<]*|[a-z][\w-]*(?:\s+[.#:[\w-][^{}<]*)?)\s*\{[^{}]*:[^{}]*\}/i;
const VISIBLE_MARKUP_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const VISIBLE_MARKUP_COMMENT_PROTECTED_BLOCK_PATTERN =
  /<(style|script|template|title|noscript|pre|code|textarea|text)\b[^>]*>[\s\S]*?<\/\1(?:\s[^>]*)?>/gi;

interface SourceRange {
  start: number;
  end: number;
}

function findCodeFenceLeak(headWithoutValidBlocks: string): string | null {
  return MARKDOWN_CODE_FENCE_PATTERN.exec(headWithoutValidBlocks)?.[0] ?? null;
}

function findOrphanCssLeak(headContent: string): string | null {
  const residualText = headContent
    .replace(HEAD_BLOCKS_TO_IGNORE_PATTERN, " ")
    .replace(HTML_TAG_PATTERN, " ");
  return (
    ORPHAN_CSS_AT_RULE_PATTERN.exec(residualText)?.[0] ??
    ORPHAN_CSS_RULE_PATTERN.exec(residualText)?.[0] ??
    null
  );
}

function findStrayCloseLeak(headWithoutValidBlocks: string): string | null {
  return STRAY_HEAD_CLOSE_PATTERN.exec(headWithoutValidBlocks)?.[0] ?? null;
}

function findLeakedTextInHeadContent(headContent: string): string | null {
  const withoutValidBlocks = headContent.replace(HEAD_BLOCKS_TO_IGNORE_PATTERN, " ");
  return (
    findCodeFenceLeak(withoutValidBlocks) ??
    findOrphanCssLeak(headContent) ??
    findStrayCloseLeak(withoutValidBlocks)
  );
}

function findLeakedTextInHead(rawSource: string): string | null {
  const headMatches = [...rawSource.matchAll(HEAD_CONTENT_PATTERN)];
  for (const match of headMatches) {
    const leakedText = findLeakedTextInHeadContent(match[1] ?? "");
    if (leakedText) return leakedText;
  }
  return null;
}

function findLeakedTextBetweenHeadAndBody(rawSource: string): string | null {
  const boundaryMatches = [...rawSource.matchAll(AFTER_HEAD_BEFORE_BODY_PATTERN)];
  for (const match of boundaryMatches) {
    const leakedText = findLeakedTextInHeadContent(match[1] ?? "");
    if (leakedText) return leakedText;
  }
  return null;
}

function findLeakedTextBeforeCompositionRoot(
  source: string,
  rootTag: LintContext["rootTag"],
): string | null {
  if (!rootTag || rootTag.name === "body") return null;
  const bodyOpenMatch = /<body\b[^>]*>/i.exec(source);
  const prefixStart = bodyOpenMatch ? bodyOpenMatch.index + bodyOpenMatch[0].length : 0;
  const prefixEnd = rootTag.index;
  if (prefixEnd <= prefixStart) return null;
  return findLeakedTextInHeadContent(source.slice(prefixStart, prefixEnd));
}

function findProtectedVisibleMarkupRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const match of source.matchAll(VISIBLE_MARKUP_COMMENT_PROTECTED_BLOCK_PATTERN)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function isInsideSourceRange(index: number, ranges: SourceRange[]): boolean {
  return ranges.some((range) => range.start <= index && index < range.end);
}

function isInsideHtmlTag(source: string, index: number): boolean {
  let inTag = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < index; i++) {
    const char = source[i];
    if (!inTag) {
      if (char === "<") inTag = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      inTag = false;
    }
  }
  return inTag;
}

function findVisibleMarkupCommentLeak(source: string): string | null {
  const protectedRanges = findProtectedVisibleMarkupRanges(source);
  for (const match of source.matchAll(VISIBLE_MARKUP_COMMENT_PATTERN)) {
    if (isInsideHtmlTag(source, match.index)) continue;
    if (isInsideSourceRange(match.index, protectedRanges)) continue;
    return match[0];
  }
  return null;
}

export const coreRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // root_missing_composition_id + root_missing_dimensions
  ({ rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!rootTag || !readAttr(rootTag.raw, "data-composition-id")) {
      findings.push({
        code: "root_missing_composition_id",
        severity: "error",
        message: "Root composition is missing `data-composition-id`.",
        elementId: rootTag ? readAttr(rootTag.raw, "id") || undefined : undefined,
        fixHint: "Add a stable `data-composition-id` to the entry composition wrapper.",
        snippet: truncateSnippet(rootTag?.raw || ""),
      });
    }
    if (!rootTag || !readAttr(rootTag.raw, "data-width") || !readAttr(rootTag.raw, "data-height")) {
      findings.push({
        code: "root_missing_dimensions",
        severity: "error",
        message: "Root composition is missing `data-width` or `data-height`.",
        elementId: rootTag ? readAttr(rootTag.raw, "id") || undefined : undefined,
        fixHint: "Set numeric `data-width` and `data-height` on the entry composition root.",
        snippet: truncateSnippet(rootTag?.raw || ""),
      });
    }
    return findings;
  },

  // head_leaked_text
  ({ source, rootTag }) => {
    const snippet =
      findLeakedTextInHead(source) ??
      findLeakedTextBetweenHeadAndBody(source) ??
      findLeakedTextBeforeCompositionRoot(source, rootTag);
    if (!snippet) return [];
    return [
      {
        code: "head_leaked_text",
        severity: "error",
        message:
          "Detected leaked code or CSS text around the document `<head>` or before the composition root. Browsers render this as visible text in the video.",
        fixHint:
          "Move CSS into a single `<style>...</style>` block and remove stray close tags, markdown fences, or code text from `<head>`, the `</head>`/`<body>` boundary, or the pre-root body prefix.",
        snippet: truncateSnippet(snippet),
      },
    ];
  },

  // visible_markup_comment
  ({ source }) => {
    const snippet = findVisibleMarkupCommentLeak(source);
    if (!snippet) return [];
    return [
      {
        code: "visible_markup_comment",
        severity: "error",
        message:
          "CSS/JS block comment syntax (`/* ... */`) appears in visible HTML markup. HTML only treats `<!-- ... -->` as comments, so this renders as on-screen text.",
        fixHint:
          "Remove the text or convert it to a real HTML comment (`<!-- ... -->`). Keep CSS comments inside `<style>` and JS comments inside `<script>`.",
        snippet: truncateSnippet(snippet),
      },
    ];
  },

  // missing_timeline_registry + timeline_registry_missing_init
  ({ source, rawSource, options }) => {
    // Sub-compositions inherit window.__timelines from the host composition
    if (options.isSubComposition || rawSource.trimStart().toLowerCase().startsWith("<template")) {
      return [];
    }
    const findings: HyperframeLintFinding[] = [];
    if (
      !TIMELINE_REGISTRY_INIT_PATTERN.test(source) &&
      !TIMELINE_REGISTRY_ASSIGN_PATTERN.test(source)
    ) {
      findings.push({
        code: "missing_timeline_registry",
        severity: "error",
        message: "Missing `window.__timelines` registration.",
        fixHint: "Register each composition timeline on `window.__timelines[compositionId]`.",
      });
    }
    if (
      TIMELINE_REGISTRY_ASSIGN_PATTERN.test(source) &&
      !TIMELINE_REGISTRY_INIT_PATTERN.test(source)
    ) {
      findings.push({
        code: "timeline_registry_missing_init",
        severity: "error",
        message:
          "`window.__timelines[…] = …` is used without initializing `window.__timelines` first.",
        fixHint:
          "Add `window.__timelines = window.__timelines || {};` before any timeline assignment.",
      });
    }
    return findings;
  },

  // timeline_id_mismatch
  ({ source }) => {
    const findings: HyperframeLintFinding[] = [];
    const htmlCompIds = new Set<string>();
    const timelineRegKeys = new Set<string>();
    const compIdRe = /data-composition-id\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = compIdRe.exec(source)) !== null) {
      if (m[1]) htmlCompIds.add(m[1]);
    }
    for (const key of extractTimelineRegistryKeys(source)) {
      timelineRegKeys.add(key);
    }
    for (const key of timelineRegKeys) {
      if (!htmlCompIds.has(key)) {
        findings.push({
          code: "timeline_id_mismatch",
          severity: "error",
          message: `Timeline registered as "${key}" but no element has data-composition-id="${key}". The runtime cannot auto-nest this timeline.`,
          fixHint: `Change window.__timelines["${key}"] to match the data-composition-id attribute, or vice versa.`,
        });
      }
    }
    return findings;
  },

  // invalid_inline_script_syntax (malformed close tag)
  ({ source }) => {
    if (!INVALID_SCRIPT_CLOSE_PATTERN.test(source)) return [];
    return [
      {
        code: "invalid_inline_script_syntax",
        severity: "error",
        message: "Detected malformed inline `<script>` closing syntax.",
        fixHint: "Close inline scripts with a valid `</script>` tag.",
      },
    ];
  },

  // invalid_inline_script_syntax (JS parse error)
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const attrs = script.attrs || "";
      if (
        /\bsrc\s*=/.test(attrs) ||
        /\btype\s*=\s*["'](?:application\/json|application\/hyperframes-slideshow\+json|importmap|module)["']/.test(
          attrs,
        )
      )
        continue;
      const syntaxError = getInlineScriptSyntaxError(script.content);
      if (!syntaxError) continue;
      findings.push({
        code: "invalid_inline_script_syntax",
        severity: "error",
        message: `Inline script has invalid syntax: ${syntaxError}`,
        fixHint: "Fix the inline script syntax before render verification.",
        snippet: truncateSnippet(script.content),
      });
    }
    return findings;
  },

  // host_missing_composition_id
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      const src = readAttr(tag.raw, "data-composition-src");
      if (!src) continue;
      if (readAttr(tag.raw, "data-composition-id")) continue;
      findings.push({
        code: "host_missing_composition_id",
        severity: "error",
        message: `Composition host for "${src}" is missing \`data-composition-id\`.`,
        elementId: readAttr(tag.raw, "id") || undefined,
        fixHint: "Set `data-composition-id` on every `data-composition-src` host element.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // scoped_css_missing_wrapper
  ({ styles, compositionIds }) => {
    const findings: HyperframeLintFinding[] = [];
    const scopedCssCompositionIds = new Set<string>();
    for (const style of styles) {
      for (const compId of extractCompositionIdsFromCss(style.content)) {
        scopedCssCompositionIds.add(compId);
      }
    }
    for (const compId of scopedCssCompositionIds) {
      if (compositionIds.has(compId)) continue;
      findings.push({
        code: "scoped_css_missing_wrapper",
        severity: "warning",
        message: `Scoped CSS targets composition "${compId}" but no matching wrapper exists in this HTML.`,
        selector: `[data-composition-id="${compId}"]`,
        fixHint:
          "Preserve the matching composition wrapper or align the CSS scope to an existing wrapper.",
      });
    }
    return findings;
  },

  // composition_self_attribute_selector
  ({ styles, rootCompositionId, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!rootCompositionId) return findings;
    const seenSelectors = new Set<string>();
    const rootId = readAttr(rootTag?.raw || "", "id");
    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkRules((rule) => {
        for (const selector of rule.selectors) {
          if (!selectorTargetsCompositionId(selector, rootCompositionId)) continue;
          if (seenSelectors.has(selector)) continue;
          seenSelectors.add(selector);
          findings.push({
            code: "composition_self_attribute_selector",
            severity: "warning",
            message:
              "Selector matches the block's own id; will leak to sibling instances when the block is embedded twice.",
            selector,
            fixHint: rootId
              ? `Use #${rootId} for clearer authoring intent and instance-isolated styling.`
              : "Add a stable id to the composition root and use that id selector for clearer authoring intent and instance-isolated styling.",
          });
        }
      });
    }
    return findings;
  },

  // studio_missing_editable_id
  ({ tags, rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (rootTag && tag.index === rootTag.index) continue;
      if (!isStudioTimelineElement(tag)) continue;
      if (readAttr(tag.raw, "id")) continue;

      const descriptor = describeStudioElement(tag);
      findings.push({
        code: "studio_missing_editable_id",
        severity: "warning",
        message: `${descriptor} has no id, so Studio cannot use a stable edit target for its timeline and canvas controls.`,
        selector: readAttr(tag.raw, "data-composition-id")
          ? `[data-composition-id="${readAttr(tag.raw, "data-composition-id")}"]`
          : undefined,
        fixHint:
          'Add a stable, human-readable id such as id="hero-title" or id="scene-1-card" to every timeline-visible element you want agents or Studio to edit.',
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // non_deterministic_code
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    const patterns: Array<{ pattern: RegExp; label: string; hint: string }> = [
      {
        pattern: /Math\.random\s*\(/,
        label: "Math.random()",
        hint: "Use a seeded PRNG (e.g. a simple mulberry32) so renders are deterministic across frames.",
      },
      {
        pattern: /Date\.now\s*\(/,
        label: "Date.now()",
        hint: "Remove time-dependent code. Use GSAP timeline position instead of wall-clock time.",
      },
      {
        pattern: /new\s+Date\s*\(/,
        label: "new Date()",
        hint: "Remove time-dependent code. Use GSAP timeline position instead of wall-clock time.",
      },
      {
        pattern: /performance\.now\s*\(/,
        label: "performance.now()",
        hint: "Remove time-dependent code. Use GSAP timeline position instead of wall-clock time.",
      },
      {
        pattern: /crypto\.getRandomValues\s*\(/,
        label: "crypto.getRandomValues()",
        hint: "Remove time-dependent code. Use a seeded PRNG for deterministic renders.",
      },
    ];

    for (const script of scripts) {
      const stripped = stripJsComments(script.content);
      for (const { pattern, label, hint } of patterns) {
        if (pattern.test(stripped)) {
          findings.push({
            code: "non_deterministic_code",
            severity: "error",
            message: `Script contains \`${label}\` which produces non-deterministic output. Renders may differ between frames or runs.`,
            fixHint: hint,
            snippet: truncateSnippet(script.content),
          });
        }
      }
    }
    return findings;
  },

  // pointer_events_none
  // fallow-ignore-next-line complexity
  ({ tags, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const reported = new Set<string>();

    for (const tag of tags) {
      if (["script", "style", "link", "meta", "template", "noscript"].includes(tag.name)) continue;
      const inlineStyle = readAttr(tag.raw, "style") ?? "";
      if (!/pointer-events\s*:\s*none/i.test(inlineStyle)) continue;
      const id = readAttr(tag.raw, "id");
      const key = id ?? tag.raw;
      if (reported.has(key)) continue;
      reported.add(key);
      findings.push({
        code: "pointer_events_none",
        severity: "info",
        message: `<${tag.name}${id ? ` id="${id}"` : ""}> has \`pointer-events: none\` in its inline style. Elements with this property are harder to select in the Studio preview.`,
        elementId: id || undefined,
        fixHint:
          "If this element should be selectable in the Studio, remove `pointer-events: none` or move it to a wrapper that doesn't contain editable content.",
        snippet: truncateSnippet(tag.raw),
      });
    }

    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkDecls("pointer-events", (decl) => {
        if (decl.value.trim().toLowerCase() !== "none") return;
        const rule = decl.parent;
        if (!rule || rule.type !== "rule") return;
        const selector = (rule as postcss.Rule).selector;
        if (reported.has(selector)) return;
        reported.add(selector);
        findings.push({
          code: "pointer_events_none",
          severity: "info",
          message: `\`${selector}\` sets \`pointer-events: none\`. Elements matching this selector are harder to select in the Studio preview.`,
          selector,
          fixHint:
            "If these elements should be selectable in the Studio, remove `pointer-events: none` or move it to a wrapper that doesn't contain editable content.",
        });
      });
    }

    return findings;
  },
];
