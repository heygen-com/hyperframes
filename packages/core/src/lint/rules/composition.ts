import type { LintContext, HyperframeLintFinding } from "../context";
import { readAttr, truncateSnippet } from "../utils";

export const compositionRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // timed_element_missing_visibility_hidden
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (tag.name === "audio" || tag.name === "script" || tag.name === "style") continue;
      if (!readAttr(tag.raw, "data-start")) continue;
      if (readAttr(tag.raw, "data-composition-id")) continue;
      if (readAttr(tag.raw, "data-composition-src")) continue;
      const classAttr = readAttr(tag.raw, "class") || "";
      const styleAttr = readAttr(tag.raw, "style") || "";
      const hasClip = classAttr.split(/\s+/).includes("clip");
      const hasHiddenStyle =
        /visibility\s*:\s*hidden/i.test(styleAttr) || /opacity\s*:\s*0/i.test(styleAttr);
      if (!hasClip && !hasHiddenStyle) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "timed_element_missing_visibility_hidden",
          severity: "info",
          message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> has data-start but no class="clip", visibility:hidden, or opacity:0. Consider adding initial hidden state if the element should not be visible before its start time.`,
          elementId,
          fixHint:
            'Add class="clip" (with CSS: .clip { visibility: hidden; }) or style="opacity:0" if the element should start hidden.',
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },

  // deprecated_data_layer + deprecated_data_end
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (readAttr(tag.raw, "data-layer") && !readAttr(tag.raw, "data-track-index")) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
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
        findings.push({
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
    return findings;
  },

  // template_literal_selector
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const templateLiteralSelectorPattern =
        /(?:querySelector|querySelectorAll)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/g;
      let tlMatch: RegExpExecArray | null;
      while ((tlMatch = templateLiteralSelectorPattern.exec(script.content)) !== null) {
        findings.push({
          code: "template_literal_selector",
          severity: "error",
          message:
            "querySelector uses a template literal variable (e.g. `${compId}`). " +
            "The HTML bundler's CSS parser crashes on these. Use a hardcoded string instead.",
          fixHint:
            "Replace the template literal variable with a hardcoded string. The bundler's CSS parser cannot handle interpolated variables in script content.",
          snippet: truncateSnippet(tlMatch[0]),
        });
      }
    }
    return findings;
  },

  // external_script_dependency
  ({ source }) => {
    const findings: HyperframeLintFinding[] = [];
    const externalScriptRe = /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((match = externalScriptRe.exec(source)) !== null) {
      const src = match[1] ?? "";
      if (seen.has(src)) continue;
      seen.add(src);
      findings.push({
        code: "external_script_dependency",
        severity: "info",
        message: `This composition loads an external script from \`${src}\`. The HyperFrames bundler automatically hoists CDN scripts from sub-compositions into the parent document. In unbundled runtime mode, \`loadExternalCompositions\` re-injects them. If you're using a custom pipeline that bypasses both, you'll need to include this script manually.`,
        fixHint:
          "No action needed when using `hyperframes preview` or `hyperframes render`. If using a custom pipeline, add this script tag to your root composition or HTML page.",
        snippet: truncateSnippet(match[0] ?? ""),
      });
    }
    return findings;
  },
];
