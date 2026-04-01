import type { LintContext, HyperframeLintFinding } from "../context";

export const captionRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // caption_exit_missing_hard_kill
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = script.content;
      const hasExitTween = /\.to\s*\([^,]+,\s*\{[^}]*opacity\s*:\s*0/.test(content);
      const hasHardKill =
        /\.set\s*\([^,]+,\s*\{[^}]*(?:visibility\s*:\s*["']hidden["']|opacity\s*:\s*0)/.test(
          content,
        );
      const hasCaptionLoop =
        /forEach|\.forEach\s*\(/.test(content) && /createElement|caption|group|cg-/.test(content);
      if (hasCaptionLoop && hasExitTween && !hasHardKill) {
        findings.push({
          code: "caption_exit_missing_hard_kill",
          severity: "warning",
          message:
            "Caption exit animations (tl.to with opacity: 0) detected without a hard tl.set kill. " +
            "Exit tweens can fail when karaoke word-level tweens conflict, leaving captions stuck on screen.",
          fixHint:
            'Add `tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end)` after every ' +
            "exit tl.to animation as a deterministic kill.",
        });
      }
    }
    return findings;
  },

  // caption_text_overflow_risk
  ({ styles }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const style of styles) {
      const captionBlocks = style.content.matchAll(
        /(\.caption[-_]?(?:group|container|text|line|word)|#caption[-_]?container)\s*\{([^}]+)\}/gi,
      );
      for (const [, selector, body] of captionBlocks) {
        if (!body) continue;
        const hasNowrap = /white-space\s*:\s*nowrap/i.test(body);
        const hasMaxWidth = /max-width/i.test(body);
        if (hasNowrap && !hasMaxWidth) {
          findings.push({
            code: "caption_text_overflow_risk",
            severity: "warning",
            selector: (selector ?? "").trim(),
            message: `Caption selector "${(selector ?? "").trim()}" has white-space: nowrap but no max-width. Long phrases will clip off-screen.`,
            fixHint:
              "Add max-width: 1600px (landscape) or max-width: 900px (portrait) and overflow: hidden.",
          });
        }
      }
    }
    return findings;
  },

  // caption_word_structure — enforces .caption-group > span convention for caption override compatibility
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = script.content;
      // Only check scripts that look like caption compositions
      const isCaptionScript =
        /TRANSCRIPT|caption.group|caption-group/i.test(content) &&
        /createElement|appendChild/.test(content);
      if (!isCaptionScript) continue;

      // Check that word elements use <span> inside .caption-group
      const createsSpans = /createElement\s*\(\s*["']span["']\s*\)/.test(content);
      const usesGroupClass = /className\s*=\s*["'][^"']*caption.group|class.*caption.group/i.test(content);

      if (!createsSpans) {
        findings.push({
          code: "caption_word_structure",
          severity: "warning",
          message:
            "Caption word elements should be <span> tags for compatibility with the caption " +
            "override system. Use document.createElement(\"span\") for each word.",
          fixHint:
            "Change word element creation to use <span> tags: " +
            'document.createElement("span").',
        });
      }
      if (!usesGroupClass) {
        findings.push({
          code: "caption_word_structure",
          severity: "warning",
          message:
            'Caption groups should use className "caption-group" for compatibility with the ' +
            "caption override system and the Studio caption editor.",
          fixHint:
            'Set className = "caption-group" on each group container element.',
        });
      }
    }
    return findings;
  },

  // caption_container_relative_position
  ({ styles }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const style of styles) {
      const captionBlocks = style.content.matchAll(
        /(\.caption[-_]?(?:group|container|text|line)|#caption[-_]?container)\s*\{([^}]+)\}/gi,
      );
      for (const [, selector, body] of captionBlocks) {
        if (!body) continue;
        if (/position\s*:\s*relative/i.test(body)) {
          findings.push({
            code: "caption_container_relative_position",
            severity: "warning",
            selector: (selector ?? "").trim(),
            message: `Caption selector "${(selector ?? "").trim()}" uses position: relative which causes overflow and breaks caption stacking.`,
            fixHint: "Use position: absolute for all caption elements.",
          });
        }
      }
    }
    return findings;
  },
];
