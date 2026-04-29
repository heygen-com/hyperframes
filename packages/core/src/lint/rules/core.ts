import type { LintContext, HyperframeLintFinding } from "../context";
import postcss from "postcss";
import {
  readAttr,
  truncateSnippet,
  extractCompositionIdsFromCss,
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

  // missing_timeline_registry + timeline_registry_missing_init
  ({ source }) => {
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
    const tlKeyRe = /window\.__timelines\[\s*["']([^"']+)["']\s*\]/g;
    let m: RegExpExecArray | null;
    while ((m = compIdRe.exec(source)) !== null) {
      if (m[1]) htmlCompIds.add(m[1]);
    }
    while ((m = tlKeyRe.exec(source)) !== null) {
      if (m[1]) timelineRegKeys.add(m[1]);
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
      if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["']application\/json["']/.test(attrs)) continue;
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
      // Strip comments to avoid false positives
      const stripped = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
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
];
