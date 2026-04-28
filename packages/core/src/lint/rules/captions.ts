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
        /forEach|\.forEach\s*\(/.test(content) &&
        /karaoke|caption[-_]?(?:group|word|line|block)|cg-/.test(content);
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

  // caption_transcript_not_inline
  ({ scripts, styles, options }) => {
    const findings: HyperframeLintFinding[] = [];
    // Only check files that look like caption compositions
    const isCaptionFile =
      (options.filePath && /caption/i.test(options.filePath)) ||
      styles.some((s) => /\.caption[-_]?(?:group|word)/i.test(s.content));
    if (!isCaptionFile) return findings;

    const allScript = scripts.map((s) => s.content).join("\n");
    const hasInlineTranscript = /(?:const|let|var)\s+(?:TRANSCRIPT|script)\s*=\s*\[/.test(
      allScript,
    );
    const hasFetchTranscript = /fetch\s*\(\s*["'][^"']*transcript/i.test(allScript);

    if (!hasInlineTranscript && hasFetchTranscript) {
      findings.push({
        code: "caption_transcript_not_inline",
        severity: "warning",
        message:
          "Captions composition loads transcript via fetch(). The studio caption editor " +
          "requires an inline `var TRANSCRIPT = [...]` array to detect and edit captions.",
        fixHint:
          'Embed the transcript as `var TRANSCRIPT = [{ "text": "...", "start": 0, "end": 1 }, ...]` ' +
          "with JSON-quoted property keys. See the captions skill for details.",
      });
    }

    if (hasInlineTranscript) {
      // Verify the inline transcript can be parsed
      const varPattern = /(?:const|let|var)\s+(?:TRANSCRIPT|script)\s*=\s*(\[[\s\S]*?\]);/;
      const match = allScript.match(varPattern);
      if (match?.[1]) {
        try {
          JSON.parse(match[1]);
        } catch {
          findings.push({
            code: "caption_transcript_parse_error",
            severity: "warning",
            message:
              "Inline TRANSCRIPT array is not valid JSON. The studio caption editor may fail " +
              "to parse it. Common cause: unquoted property keys with apostrophes in text.",
            fixHint:
              'Use JSON-quoted keys: { "text": "don\'t", "start": 0, "end": 1 } instead of ' +
              '{ text: "don\'t", start: 0, end: 1 }.',
          });
        }
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

  // caption_overflow_clips_scaled_words
  ({ styles, scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    const hasScaledWords = scripts.some(
      (s) => /scale\s*:\s*1\.[2-9]/.test(s.content) && /caption|word|cg-/.test(s.content),
    );
    if (!hasScaledWords) return findings;

    for (const style of styles) {
      const captionBlocks = style.content.matchAll(
        /(\.caption[-_]?(?:group|container)|#caption[-_]?(?:layer|container))\s*\{([^}]+)\}/gi,
      );
      for (const [, selector, body] of captionBlocks) {
        if (!body) continue;
        if (/overflow\s*:\s*hidden/i.test(body)) {
          findings.push({
            code: "caption_overflow_clips_scaled_words",
            severity: "warning",
            selector: (selector ?? "").trim(),
            message: `"${(selector ?? "").trim()}" has overflow: hidden but GSAP scales caption words above 1.0x. Scaled emphasis words and their glow effects will be clipped.`,
            fixHint:
              "Use overflow: visible on caption containers. Rely on fitTextFontSize with reduced maxWidth to prevent overflow instead.",
          });
        }
      }
    }
    return findings;
  },

  // caption_textshadow_on_group_container
  ({ scripts, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const isCaptionFile = styles.some((s) => /\.caption[-_]?(?:group|word)/i.test(s.content));
    if (!isCaptionFile) return findings;

    for (const script of scripts) {
      // Detect textShadow tweened on a group container (div with child word spans)
      const groupShadowPattern =
        /\.to\s*\(\s*(?:div|groupEl|el|captionEl|document\.getElementById\s*\(\s*["']cg-)\s*[^,]*,\s*\{[^}]*textShadow/g;
      // Also catch selector-based targeting of group containers
      const selectorShadowPattern =
        /\.to\s*\(\s*["'](?:#cg-\d+|\.caption[-_]?group)["']\s*,\s*\{[^}]*textShadow/g;
      if (groupShadowPattern.test(script.content) || selectorShadowPattern.test(script.content)) {
        findings.push({
          code: "caption_textshadow_on_group_container",
          severity: "warning",
          message:
            "textShadow is tweened on a caption group container. When children have semi-transparent " +
            "color (e.g., inactive karaoke words at rgba opacity), the glow renders as a visible " +
            "rectangle behind the entire group.",
          fixHint:
            "Apply textShadow to individual active word elements instead of the group container. " +
            "Use scale on the group for bass-reactive pulsing.",
        });
      }
    }
    return findings;
  },

  // caption_fittext_scale_mismatch
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const content = script.content;
      const fitTextMatch = content.match(/fitTextFontSize\s*\([^)]*maxWidth\s*:\s*(\d+)/);
      if (!fitTextMatch) continue;
      const maxWidth = parseInt(fitTextMatch[1] ?? "0", 10);
      if (!maxWidth) continue;

      // Find max scale on caption words
      const scaleMatches = [...content.matchAll(/scale\s*:\s*(1\.\d+)/g)];
      const captionContext = /caption|word|cg-|karaoke/i.test(content);
      if (!captionContext || scaleMatches.length === 0) continue;

      let maxScale = 1;
      for (const m of scaleMatches) {
        const val = parseFloat(m[1] ?? "1");
        if (val > maxScale) maxScale = val;
      }

      // Check if maxWidth * maxScale exceeds safe bounds (1920 - reasonable margins)
      const effectiveWidth = maxWidth * maxScale;
      if (effectiveWidth > 1760) {
        findings.push({
          code: "caption_fittext_scale_mismatch",
          severity: "warning",
          message:
            `fitTextFontSize uses maxWidth: ${maxWidth}px but emphasis words scale up to ${maxScale}x. ` +
            `Effective width ${Math.round(effectiveWidth)}px may overflow the composition (1920px minus margins).`,
          fixHint: `Reduce maxWidth to ${Math.floor(1700 / maxScale)}px to leave headroom for scaled emphasis words.`,
        });
      }
    }
    return findings;
  },
];
