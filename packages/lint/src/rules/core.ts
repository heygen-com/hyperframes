import type { LintContext, HyperframeLintFinding } from "../context";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import {
  readAttr,
  readDecodedAttr,
  truncateSnippet,
  stripJsComments,
  stripStringLiterals,
  extractCompositionIdsFromCss,
  extractTimelineRegistryKeys,
  getInlineScriptSyntaxError,
  TIMELINE_REGISTRY_INIT_PATTERN,
  TIMELINE_REGISTRY_ASSIGN_PATTERN,
  TIMELINE_REGISTRY_OBJECT_LITERAL_PATTERN,
  INVALID_SCRIPT_CLOSE_PATTERN,
} from "../utils";

function repeatedDescendantId(selector: string): string | null {
  let repeated: string | null = null;

  const requiredPseudoIds = (pseudo: selectorParser.Pseudo): Set<string> => {
    if (![":is", ":where"].includes(pseudo.value.toLowerCase()) || pseudo.nodes.length === 0) {
      return new Set<string>();
    }

    const optionIdSets: Set<string>[] = [];
    for (const option of pseudo.nodes) {
      // Only promote ids from a single compound. For selector-list branches with
      // combinators, determining which compound is the subject requires fuller
      // selector semantics; skipping them avoids false positives.
      if (option.nodes.some((node) => node.type === "combinator")) return new Set<string>();
      const optionIds = new Set<string>(
        option.nodes.filter((node) => node.type === "id").map((node) => node.value),
      );
      optionIdSets.push(optionIds);
    }
    const [firstOptionIds, ...remainingOptionIds] = optionIdSets;
    return new Set<string>(
      [...(firstOptionIds ?? [])].filter((id) =>
        remainingOptionIds.every((optionIds) => optionIds.has(id)),
      ),
    );
  };

  try {
    selectorParser((root) => {
      root.each((selectorNode) => {
        const firstCompoundById = new Map<string, number>();
        let compound = 0;
        selectorNode.each((node) => {
          if (repeated) return;
          if (node.type === "combinator") {
            compound += 1;
            return;
          }
          const requiredIds =
            node.type === "id"
              ? [node.value]
              : node.type === "pseudo"
                ? [...requiredPseudoIds(node)]
                : [];
          for (const id of requiredIds) {
            const firstCompound = firstCompoundById.get(id);
            if (firstCompound !== undefined && firstCompound !== compound) {
              repeated = id;
              return;
            }
            firstCompoundById.set(id, compound);
          }
        });
      });
    }).processSync(selector);
  } catch {
    return null;
  }
  return repeated;
}

function resolvedRuleSelectors(rule: postcss.Rule): string[] {
  let ancestor: postcss.AnyNode | undefined = rule.parent;
  while (ancestor && ancestor.type !== "rule") ancestor = ancestor.parent;
  if (!ancestor || ancestor.type !== "rule") return rule.selectors;

  const parentSelectors = resolvedRuleSelectors(ancestor);
  return parentSelectors.flatMap((parentSelector) =>
    rule.selectors.map((childSelector) => {
      const nestingToken = /(^|[\s>+~,(])&/g;
      if (nestingToken.test(childSelector)) {
        return childSelector.replace(
          nestingToken,
          (_, separator: string) => separator + parentSelector,
        );
      }
      return `${parentSelector} ${childSelector}`;
    }),
  );
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
  const compositionId = readDecodedAttr(tag.raw, "data-composition-id");
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

const VISIBLE_MARKUP_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const VISIBLE_MARKUP_COMMENT_PROTECTED_BLOCK_PATTERN =
  /<(style|script|template|title|noscript|pre|code|textarea|text)\b[^>]*>[\s\S]*?<\/\1(?:\s[^>]*)?>/gi;

interface SourceRange {
  start: number;
  end: number;
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
  // id_requires_css_escape
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      const id = readAttr(tag.raw, "id");
      if (!id || !/^\d/.test(id)) continue;
      findings.push({
        code: "id_requires_css_escape",
        severity: "warning",
        message: `id="${id}" starts with a digit, so the common selector \`#${id}\` throws a SyntaxError in querySelector().`,
        elementId: id,
        fixHint:
          "Rename the id to start with a letter (recommended), or build selectors with `#${CSS.escape(id)}` at runtime.",
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // root_missing_composition_id + root_missing_dimensions
  // fallow-ignore-next-line complexity
  ({ rootTag }) => {
    const findings: HyperframeLintFinding[] = [];
    if (!rootTag || !readDecodedAttr(rootTag.raw, "data-composition-id")) {
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

  // missing_timeline_registry
  // fallow-ignore-next-line complexity
  ({ source, rawSource, rootTag, options }) => {
    // Sub-compositions inherit window.__timelines from the host composition
    if (options.isSubComposition || rawSource.trimStart().toLowerCase().startsWith("<template")) {
      return [];
    }
    if (/(?:^|\s)data-no-timeline(?=[\s=/]|$)/i.test(rootTag?.attrs || "")) return [];
    const findings: HyperframeLintFinding[] = [];
    if (
      !TIMELINE_REGISTRY_INIT_PATTERN.test(source) &&
      !TIMELINE_REGISTRY_ASSIGN_PATTERN.test(source) &&
      !TIMELINE_REGISTRY_OBJECT_LITERAL_PATTERN.test(source)
    ) {
      findings.push({
        code: "missing_timeline_registry",
        severity: "error",
        message: "Missing `window.__timelines` registration.",
        fixHint: "Register each composition timeline on `window.__timelines[compositionId]`.",
      });
    }
    // `timeline_registry_missing_init` used to fire here, demanding
    // `window.__timelines = window.__timelines || {}` before any assignment.
    // The runtime already owns that invariant: runtime/entry.ts creates the
    // registry at script-evaluation time, before any inline composition script
    // runs, and both injection paths put the runtime bundle in <head> ahead of
    // the body scripts that build timelines. Verified by rendering a
    // composition whose only registration is a bare
    // `window.__timelines["main"] = gsap.timeline(...)`: it renders and
    // animates correctly. The rule made a working file fail lint, and a lint
    // ERROR also suppresses the layout and contrast audits in `check`, so it
    // cost far more than the line it was protecting.
    return findings;
  },

  // timeline_id_mismatch
  ({ source, compositionIds }) => {
    const findings: HyperframeLintFinding[] = [];
    const htmlCompIds = new Set(compositionIds);
    const timelineRegKeys = new Set<string>();
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

  // repeated_id_descendant_selector
  ({ styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const reported = new Set<string>();
    for (const style of styles) {
      let root: postcss.Root;
      try {
        root = postcss.parse(style.content);
      } catch {
        continue;
      }
      root.walkRules((rule) => {
        for (const selector of resolvedRuleSelectors(rule)) {
          const repeatedId = repeatedDescendantId(selector);
          if (!repeatedId || reported.has(repeatedId)) continue;
          reported.add(repeatedId);
          findings.push({
            code: "repeated_id_descendant_selector",
            severity: "error",
            message: `Selector "${selector}" requires #${repeatedId} to be nested inside another #${repeatedId}. IDs must be unique, so this selector cannot match a valid composition.`,
            selector,
            fixHint: `Remove the duplicate ancestor: change \`#${repeatedId} #${repeatedId}\` to \`#${repeatedId}\`.`,
          });
        }
      });
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
      if (readDecodedAttr(tag.raw, "data-composition-id")) continue;
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
        selector: readDecodedAttr(tag.raw, "data-composition-id")
          ? `[data-composition-id="${readDecodedAttr(tag.raw, "data-composition-id")}"]`
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
    const patterns: Array<{
      pattern: RegExp;
      label: string;
      hint: string;
      /** Match against raw source, because the value being matched is a string GSAP parses. */
      scansStrings?: boolean;
    }> = [
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
        // Zero-arg only. `new Date(<fixed timestamp>)` is fully deterministic and is how
        // a composition labels a fixed date on an axis or card; the hint ("remove
        // time-dependent code") cannot be applied to it without deleting the label.
        pattern: /new\s+Date\s*\(\s*\)/,
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
      {
        pattern: /gsap\.utils\.random\s*\(/,
        label: "gsap.utils.random()",
        hint: "Each render worker initializes independently, so random values diverge across chunks. Use a seeded PRNG or fixed values.",
      },
      {
        // GSAP string form: "random(...)" / "+=random(...)" — re-rolls at tween init.
        // `scansStrings` because here the string IS the executed value: GSAP parses it.
        // Every other pattern above matches executable code, so a match inside a string
        // literal is inert text and must not be reported.
        pattern: /["'`](?:[+-]=)?random\(\s*[-\d[]/,
        scansStrings: true,
        label: '"random(...)" tween value',
        hint: "GSAP random string values re-roll at tween init and each render worker initializes independently. Use fixed values or precompute with a seeded PRNG.",
      },
    ];

    for (const script of scripts) {
      const withoutComments = stripJsComments(script.content);
      // Strings are content, not code. A composition that DISPLAYS source (the
      // code-snippet blocks, /pr-to-video) carries `Math.random()` inside a string
      // literal it never executes, and reported itself non-deterministic with no
      // way to clear the error while still rendering the snippet.
      const executable = stripStringLiterals(withoutComments);
      for (const { pattern, label, hint, scansStrings } of patterns) {
        if (pattern.test(scansStrings ? withoutComments : executable)) {
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
];
