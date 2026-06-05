import type { LintContext, HyperframeLintFinding } from "../context";
import { findHtmlTag, readAttr, readJsonAttr, truncateSnippet } from "../utils";
import { COMPOSITION_VARIABLE_TYPES } from "../../core.types";

// Agent guidance thresholds: warning-only nudges for files/tracks that become hard
// to inspect and revise reliably in a single composition.
const MAX_COMPOSITION_LINES = 300;
const MAX_TIMED_ELEMENTS_PER_TRACK = 3;
const TRACK_DENSITY_EXEMPT_TAGS = new Set(["audio", "script", "style", "video"]);

function countPhysicalLines(source: string): number {
  if (source.length === 0) return 0;

  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.split("\n").length;
}

function countStructuralLines(source: string): number {
  return countPhysicalLines(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>"));
}

function isRegistrySourceFile(filePath?: string): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)registry\/blocks\/([^/]+)\/\1\.html$/i.test(normalized);
}

function isRegistryInstalledFile(rawSource: string): boolean {
  return /^\s*<!--\s*hyperframes-registry-item:[^>]*-->/i.test(rawSource.slice(0, 512));
}

function isCompositionRootOrMount(rawTag: string): boolean {
  return Boolean(
    readAttr(rawTag, "data-composition-id") || readAttr(rawTag, "data-composition-src"),
  );
}

/**
 * A composition file whose top-level wrapper is `<template id="...-template">`
 * is, by HyperFrames convention, a sub-composition source — even when the
 * caller forgot to pass `isSubComposition: true`. Used to suppress root-level
 * rules (`root_composition_missing_data_start`,
 * `standalone_composition_wrapped_in_template`) that would otherwise false-fire
 * on every `compositions/beat-*.html` file.
 *
 * Match shape: first non-whitespace tag is `<template ... id="<name>-template" ...>`.
 * The `-template` id suffix is the deliberate signal — a bare `<template>` (no
 * id, or an id that doesn't end in `-template`) still warns, because it's
 * indistinguishable from a misuse of `<template>` at the document root.
 */
function isSubCompositionTemplateWrapper(rawSource: string): boolean {
  const trimmed = rawSource.trimStart();
  if (!/^<template\b/i.test(trimmed)) return false;
  const openTagMatch = trimmed.match(/^<template\b[^>]*>/i);
  if (!openTagMatch) return false;
  const id = readAttr(openTagMatch[0], "id");
  if (!id) return false;
  return /-template$/.test(id);
}

export const compositionRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // invalid_capture_path — catches ../capture/ in src/href attributes and scripts.
  // Sub-compositions live in compositions/ but are served relative to the project
  // root, so all asset paths must be root-relative ("capture/...").
  // Using "../capture/..." works on disk but breaks in Studio and renders.
  ({ rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    // Only flag in sub-compositions and root compositions — not in registry blocks
    const matches = rawSource.match(/\.\.\/capture\//g);
    if (!matches || matches.length === 0) return [];
    return [
      {
        code: "invalid_capture_path",
        severity: "error",
        message: `Found ${matches.length} asset path(s) using ../capture/ — will 404 in Studio and renders.`,
        fixHint:
          'Replace all "../capture/" with "capture/" throughout this file. Compositions are served with the project root as their base URL, so paths must be root-relative, not relative to the compositions/ directory.',
      },
    ];
  },

  // composition_file_too_large
  ({ rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];

    const lineCount = countStructuralLines(rawSource);
    if (lineCount <= MAX_COMPOSITION_LINES) return [];

    const splitTarget = options.isSubComposition
      ? "Split this sub-composition further into smaller .html files"
      : "Split coherent scenes or layers into separate .html files under compositions/";

    return [
      {
        code: "composition_file_too_large",
        severity: "warning",
        message: `This HTML composition file has ${lineCount} lines. Smaller sub-compositions are easier to read, iterate on, and diff.`,
        fixHint: `${splitTarget}, then mount them from the parent with data-composition-src so each file stays small enough to inspect, revise, and validate independently.`,
      },
    ];
  },

  // timeline_track_too_dense
  ({ tags, options }) => {
    const trackCounts = new Map<string, number>();
    for (const tag of tags) {
      if (TRACK_DENSITY_EXEMPT_TAGS.has(tag.name)) continue;
      if (isCompositionRootOrMount(tag.raw)) continue;
      if (!readAttr(tag.raw, "data-start")) continue;

      const track = readAttr(tag.raw, "data-track-index");
      if (!track) continue;
      trackCounts.set(track, (trackCounts.get(track) ?? 0) + 1);
    }

    const findings: HyperframeLintFinding[] = [];
    for (const [track, count] of trackCounts) {
      if (count <= MAX_TIMED_ELEMENTS_PER_TRACK) continue;
      const splitTarget = options.isSubComposition
        ? "Move coherent scene groups into smaller .html files"
        : "Move coherent scene groups into separate .html files under compositions/";
      findings.push({
        code: "timeline_track_too_dense",
        severity: "warning",
        message: `Track ${track} has ${count} timed elements in this HTML file. Smaller sub-compositions keep timelines easier to read, iterate on, and diff.`,
        fixHint: `${splitTarget} and mount them from the parent with data-composition-src so the timeline stays easier to inspect, revise, and validate.`,
      });
    }

    return findings;
  },

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

  // split_data_attribute_selector
  ({ scripts, styles }) => {
    const findings: HyperframeLintFinding[] = [];
    const splitDataAttrSelectorPattern =
      /\[data-composition-id=(["'])([^"'\]]+)\1\s+(data-[\w:-]+)=(["'])([^"'\]]*)\4\]/g;
    const scan = (content: string) => {
      splitDataAttrSelectorPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = splitDataAttrSelectorPattern.exec(content)) !== null) {
        const compId = match[2] ?? "";
        const attrName = match[3] ?? "";
        const attrValue = match[5] ?? "";
        findings.push({
          code: "split_data_attribute_selector",
          severity: "error",
          message:
            `Selector "${match[0]}" combines two attributes inside one CSS attribute selector. ` +
            "Browsers reject it, so GSAP timelines or querySelector calls will fail before registering.",
          selector: match[0],
          fixHint: `Use separate attribute selectors: [data-composition-id="${compId}"][${attrName}="${attrValue}"].`,
          snippet: truncateSnippet(match[0]),
        });
      }
    };
    for (const style of styles) scan(style.content);
    for (const script of scripts) scan(script.content);
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

  // timed_element_missing_clip_class
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    const skipTags = new Set(["audio", "video", "script", "style", "template"]);
    for (const tag of tags) {
      if (skipTags.has(tag.name)) continue;
      // Skip composition hosts
      if (readAttr(tag.raw, "data-composition-id")) continue;
      if (readAttr(tag.raw, "data-composition-src")) continue;

      const hasStart = readAttr(tag.raw, "data-start") !== null;
      const hasDuration = readAttr(tag.raw, "data-duration") !== null;
      const hasTrackIndex = readAttr(tag.raw, "data-track-index") !== null;
      if (!hasStart && !hasDuration && !hasTrackIndex) continue;

      const classAttr = readAttr(tag.raw, "class") || "";
      const hasClip = classAttr.split(/\s+/).includes("clip");
      if (hasClip) continue;

      const elementId = readAttr(tag.raw, "id") || undefined;
      findings.push({
        code: "timed_element_missing_clip_class",
        severity: "warning",
        message: `<${tag.name}${elementId ? ` id="${elementId}"` : ""}> has timing attributes but no class="clip". The element will be visible for the entire composition instead of only during its scheduled time range.`,
        elementId,
        fixHint:
          'Add class="clip" to the element. The HyperFrames runtime uses .clip to control visibility based on data-start/data-duration.',
        snippet: truncateSnippet(tag.raw),
      });
    }
    return findings;
  },

  // overlapping_clips_same_track
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];

    type ClipInfo = { start: number; end: number; elementId?: string; snippet: string };
    const trackMap = new Map<string, ClipInfo[]>();

    for (const tag of tags) {
      const startStr = readAttr(tag.raw, "data-start");
      const durationStr = readAttr(tag.raw, "data-duration");
      const trackStr = readAttr(tag.raw, "data-track-index");
      if (!startStr || !durationStr || !trackStr) continue;

      const start = Number(startStr);
      const duration = Number(durationStr);
      const track = trackStr;

      // Skip non-numeric (relative timing references like "intro-comp")
      if (Number.isNaN(start) || Number.isNaN(duration)) continue;

      const clips = trackMap.get(track) || [];
      clips.push({
        start,
        end: start + duration,
        elementId: readAttr(tag.raw, "id") || undefined,
        snippet: truncateSnippet(tag.raw) || "",
      });
      trackMap.set(track, clips);
    }

    for (const [track, clips] of trackMap) {
      clips.sort((a, b) => a.start - b.start);
      for (let i = 0; i < clips.length - 1; i++) {
        const current = clips[i];
        const next = clips[i + 1];
        if (!current || !next) continue;
        if (current.end > next.start) {
          findings.push({
            code: "overlapping_clips_same_track",
            severity: "error",
            message: `Track ${track}: clip ending at ${current.end}s overlaps with clip starting at ${next.start}s. Overlapping clips on the same track cause rendering conflicts.`,
            fixHint:
              "Adjust data-start or data-duration so clips on the same track do not overlap, or move one clip to a different data-track-index.",
          });
        }
      }
    }

    return findings;
  },

  // FP-fix helper: a composition file whose top-level wrapper is
  // `<template id="...-template">` is, by HyperFrames convention, a
  // sub-composition source. The caller can't always pass
  // `isSubComposition: true` (e.g. `hyperframes lint <file>` on a raw
  // `compositions/beat-1.html`), so we sniff the file shape and treat the
  // wrapper as an explicit sub-composition signal.
  // root_composition_missing_data_start
  ({ rawSource, rootTag, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    if (isSubCompositionTemplateWrapper(rawSource)) return findings;
    if (!rootTag) return findings;
    const compId = readAttr(rootTag.raw, "data-composition-id");
    if (!compId) return findings;
    const hasStart = readAttr(rootTag.raw, "data-start") !== null;
    if (!hasStart) {
      findings.push({
        code: "root_composition_missing_data_start",
        severity: "warning",
        message: `Root composition "${compId}" is missing data-start. The runtime needs data-start="0" on the root element to begin playback.`,
        fixHint: 'Add data-start="0" to the root composition element.',
        snippet: truncateSnippet(rootTag.raw),
      });
    }
    return findings;
  },

  // standalone_composition_wrapped_in_template
  ({ rawSource, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    if (isSubCompositionTemplateWrapper(rawSource)) return findings;
    const trimmed = rawSource.trimStart().toLowerCase();
    if (trimmed.startsWith("<template")) {
      findings.push({
        code: "standalone_composition_wrapped_in_template",
        severity: "warning",
        message:
          "Root index.html is wrapped in a <template> tag. " +
          "Only sub-compositions loaded via data-composition-src should use <template> wrappers. " +
          "The runtime cannot play a standalone composition inside a template.",
        fixHint:
          "Remove the <template> wrapper. Use <!DOCTYPE html><html>...<div data-composition-id>...</div>...</html> instead.",
      });
    }
    return findings;
  },

  // root_composition_missing_html_wrapper
  ({ rawSource, rootTag, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    const trimmed = rawSource.trimStart().toLowerCase();
    // Compositions inside <template> are caught by standalone_composition_wrapped_in_template
    if (trimmed.startsWith("<template")) return findings;
    const hasDoctype = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
    const hasComposition = rawSource.includes("data-composition-id");
    if (hasComposition && !hasDoctype) {
      findings.push({
        code: "root_composition_missing_html_wrapper",
        severity: "error",
        message:
          "Composition starts with a bare element instead of a proper HTML document. " +
          "An index.html that contains data-composition-id but no <!DOCTYPE html>, <html>, or <body> " +
          "is a fragment — browsers quirks-mode it, the preview server cannot load it, and " +
          "the bundler will fail to inject runtime scripts.",
        fixHint:
          'Wrap the composition in <!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>...</body></html>.',
        snippet: rootTag ? truncateSnippet(rootTag.raw) : undefined,
      });
    }
    return findings;
  },

  // requestanimationframe_in_composition
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      // Strip comments to avoid false positives
      const stripped = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/requestAnimationFrame\s*\(/.test(stripped)) {
        findings.push({
          code: "requestanimationframe_in_composition",
          severity: "warning",
          message:
            "`requestAnimationFrame` runs on wall-clock time, not the GSAP timeline. It will not sync with frame capture and may cause flickering or missed frames during rendering.",
          fixHint:
            "Use GSAP tweens or onUpdate callbacks instead of requestAnimationFrame for animation logic.",
          snippet: truncateSnippet(script.content),
        });
      }
    }
    return findings;
  },

  // set_timeout_in_composition
  // setTimeout / setInterval fire on wall-clock time and break seekable
  // determinism — the engine seeks to arbitrary frames and the delayed
  // callback either never fires or fires at the wrong frame. Drive every
  // time-based behavior off the GSAP timeline via `tl.call` / `tl.add`.
  ({ scripts }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      // Strip comments AND string contents so quoted matches don't false-positive.
      let stripped = script.content
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, "``");
      const seen = new Set<string>();
      const re = /\b(setTimeout|setInterval)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(stripped)) !== null) {
        const fnName = match[1] ?? "";
        if (seen.has(fnName)) continue;
        seen.add(fnName);
        findings.push({
          code: "set_timeout_in_composition",
          severity: "warning",
          message:
            `Composition script uses \`${fnName}\` — wall-clock timers break seekable determinism. ` +
            "The renderer seeks to arbitrary frames and the delayed callback either never fires or " +
            "fires at the wrong frame.",
          fixHint:
            "Drive every time-based behavior off the GSAP timeline: " +
            "`tl.call(fn, [], absoluteTime)` or `tl.add(fn, absoluteTime)`.",
          snippet: truncateSnippet(script.content),
        });
      }
    }
    return findings;
  },

  // invalid_variable_values_json
  // Host elements (`[data-composition-src]`) carry per-instance values via
  // `data-variable-values`. The runtime swallows JSON errors silently and
  // falls back to declared defaults, which masks typos. This rule surfaces
  // the parse failure so authors notice before render time.
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      const raw = readJsonAttr(tag.raw, "data-variable-values");
      if (!raw) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown";
        findings.push({
          code: "invalid_variable_values_json",
          severity: "warning",
          message: `data-variable-values is not valid JSON (${reason}).`,
          fixHint:
            'Wrap the attribute value in single quotes and the JSON keys/values in double quotes, e.g. data-variable-values=\'{"title":"Hello"}\'.',
          elementId: readAttr(tag.raw, "id") || undefined,
          snippet: truncateSnippet(tag.raw),
        });
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        findings.push({
          code: "invalid_variable_values_json",
          severity: "warning",
          message:
            'data-variable-values must be a JSON object keyed by variable id (e.g. {"title":"Hello"}).',
          fixHint:
            "Replace the value with a JSON object whose keys are variable ids declared in the sub-composition's data-composition-variables.",
          elementId: readAttr(tag.raw, "id") || undefined,
          snippet: truncateSnippet(tag.raw),
        });
      }
    }
    return findings;
  },

  // invalid_composition_variables_declaration
  // The runtime parses `data-composition-variables` and silently returns []
  // on any structural problem. Surface JSON / shape failures so authors
  // catch them at lint time rather than wondering why their `getVariables()`
  // defaults aren't applied.
  ({ source }) => {
    const htmlTag = findHtmlTag(source);
    if (!htmlTag) return [];
    const raw = readJsonAttr(htmlTag.raw, "data-composition-variables");
    if (!raw) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      return [
        {
          code: "invalid_composition_variables_declaration",
          severity: "warning",
          message: `data-composition-variables is not valid JSON (${reason}).`,
          fixHint:
            'Provide a JSON array of variable declarations: data-composition-variables=\'[{"id":"title","type":"string","label":"Title","default":"Hello"}]\'.',
          snippet: truncateSnippet(htmlTag.raw),
        },
      ];
    }

    if (!Array.isArray(parsed)) {
      return [
        {
          code: "invalid_composition_variables_declaration",
          severity: "warning",
          message: "data-composition-variables must be a JSON array of variable declarations.",
          fixHint:
            'Wrap declarations in [] and give each an id, type, label, and default: \'[{"id":"title","type":"string","label":"Title","default":"Hello"}]\'.',
          snippet: truncateSnippet(htmlTag.raw),
        },
      ];
    }

    const findings: HyperframeLintFinding[] = [];
    const knownTypes = new Set<string>(COMPOSITION_VARIABLE_TYPES);
    for (let i = 0; i < parsed.length; i += 1) {
      const entry = parsed[i];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        findings.push({
          code: "invalid_composition_variables_declaration",
          severity: "warning",
          message: `data-composition-variables entry [${i}] must be an object with id, type, label, and default.`,
          snippet: truncateSnippet(htmlTag.raw),
        });
        continue;
      }
      const e = entry as Record<string, unknown>;
      const missing: string[] = [];
      if (typeof e.id !== "string") missing.push("id");
      if (typeof e.type !== "string" || !knownTypes.has(e.type as string)) missing.push("type");
      if (typeof e.label !== "string") missing.push("label");
      if (!("default" in e)) missing.push("default");
      if (missing.length > 0) {
        findings.push({
          code: "invalid_composition_variables_declaration",
          severity: "warning",
          message: `data-composition-variables entry [${i}] is missing or has invalid: ${missing.join(", ")}. Type must be one of string, number, color, boolean, enum.`,
          snippet: truncateSnippet(htmlTag.raw),
        });
      }
    }
    return findings;
  },

  // sfx_data_start_must_be_master_time
  // Root index.html `<audio data-track-name="sfx-X" data-start="N">` carries
  // master-timeline time in `data-start`. A common foot-gun: an author
  // copies a `tl.call(playSfx, ['sfx-click'], M)` from a beat sub-composition
  // (whose timeline starts at master `beatStart`) and uses `M` directly as
  // data-start instead of `beatStart + M`. The SFX then fires at the wrong
  // wall-clock time.
  //
  // Heuristic: find each <audio data-track-name="sfx-X" data-start="N"> in
  // the root. Scan scripts for a `tl.call`/`tl.add`/`tl.set` referencing
  // that sfx track-name with position M. If a beat host (a tag carrying
  // `data-composition-src` or `data-composition-id` with its own data-start
  // = beatStart > 0) exists such that `beatStart + M ≈ N` AND `M !== N`,
  // emit. Conservative: only fire when the desync is provable via a
  // matching beat host — pure script-side speculation never warns.
  ({ tags, scripts, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;

    // Collect SFX audio tags in root.
    type SfxAudio = {
      trackName: string;
      dataStart: number;
      raw: string;
      elementId?: string;
    };
    const sfxAudios: SfxAudio[] = [];
    for (const tag of tags) {
      if (tag.name !== "audio") continue;
      const trackName = readAttr(tag.raw, "data-track-name");
      const startStr = readAttr(tag.raw, "data-start");
      if (!trackName || !startStr) continue;
      if (!/^sfx[-_]/i.test(trackName)) continue;
      const n = Number(startStr);
      if (!Number.isFinite(n)) continue;
      sfxAudios.push({
        trackName,
        dataStart: n,
        raw: tag.raw,
        elementId: readAttr(tag.raw, "id") || undefined,
      });
    }
    if (sfxAudios.length === 0) return findings;

    // Collect beat hosts: sub-composition mount points with data-start > 0.
    // We do NOT treat the root composition itself as a beat host (its
    // start is always 0).
    type BeatHost = { start: number };
    const beatHosts: BeatHost[] = [];
    for (const tag of tags) {
      const src = readAttr(tag.raw, "data-composition-src");
      const id = readAttr(tag.raw, "data-composition-id");
      const startStr = readAttr(tag.raw, "data-start");
      if (!startStr) continue;
      const n = Number(startStr);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!src && !id) continue;
      beatHosts.push({ start: n });
    }
    if (beatHosts.length === 0) return findings;

    // Scan scripts for tl.call / tl.add / tl.set referencing each sfx
    // track-name. Position is the LAST numeric arg at top-level. Accepts:
    //   tl.call(playSfx, ['sfx-click'], 2)
    //   tl.call(() => playSfx('sfx-click'), [], 2)
    //   tl.add(playSfx.bind(null, 'sfx-click'), 2)
    type ScriptHit = { trackName: string; position: number; raw: string };
    const hits: ScriptHit[] = [];
    const callRe = /\b(?:tl|timeline)\.(?:call|add|set)\s*\(([\s\S]*?)\)\s*;?/g;
    const trackNameRe = /['"]([a-z][a-z0-9_-]*)['"]/gi;
    for (const script of scripts) {
      const cleaned = script.content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      callRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(cleaned)) !== null) {
        const argsBlob = m[1] || "";
        trackNameRe.lastIndex = 0;
        const referencedNames: string[] = [];
        let tnMatch: RegExpExecArray | null;
        while ((tnMatch = trackNameRe.exec(argsBlob)) !== null) {
          const candidate = tnMatch[1] || "";
          if (/^sfx[-_]/i.test(candidate)) referencedNames.push(candidate);
        }
        if (referencedNames.length === 0) continue;
        // Position arg: trailing top-level numeric literal.
        const trailing = argsBlob.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
        if (!trailing) continue;
        const pos = Number(trailing[1]);
        if (!Number.isFinite(pos)) continue;
        for (const name of referencedNames) {
          hits.push({ trackName: name, position: pos, raw: m[0] });
        }
      }
    }
    if (hits.length === 0) return findings;

    const EPSILON = 0.05;
    const reported = new Set<string>();
    for (const audio of sfxAudios) {
      const matchingHits = hits.filter((h) => h.trackName === audio.trackName);
      if (matchingHits.length === 0) continue;
      for (const hit of matchingHits) {
        // The smoking-gun pattern is: data-start === a script call
        // position AND that position is SMALLER than at least one beat
        // host's start (so it can plausibly be a beat-relative offset
        // copy-pasted into a root data-start that should have been
        // master time). If data-start > all beat starts, the author
        // already accounted for beat offset and we leave it alone.
        if (Math.abs(hit.position - audio.dataStart) >= EPSILON) continue;
        const beat = beatHosts.find((b) => b.start > audio.dataStart + EPSILON);
        if (!beat) continue;
        const dedupeKey = `${audio.trackName}|${audio.dataStart}|${hit.position}`;
        if (reported.has(dedupeKey)) continue;
        reported.add(dedupeKey);
        findings.push({
          code: "sfx_data_start_must_be_master_time",
          severity: "warning",
          message:
            `SFX \`<audio data-track-name="${audio.trackName}" data-start="${audio.dataStart}">\` ` +
            `appears to be in beat-relative time, but data-start must be in master timeline time. ` +
            `The script calls this track at position ${hit.position}s inside a beat that starts at ` +
            `master t=${beat.start}s — the expected master data-start is ${(beat.start + hit.position).toFixed(2)}, ` +
            `NOT ${audio.dataStart}.`,
          elementId: audio.elementId,
          fixHint:
            `Set \`data-start="${(beat.start + hit.position).toFixed(2)}"\` (beatStart + beatRelativeOffset). ` +
            "If beat-2 starts at master t=6.5 and the click should fire at master t=8.5, set " +
            "data-start='8.5' (NOT '2.0', the beat-relative offset).",
          snippet: truncateSnippet(audio.raw),
        });
      }
    }
    return findings;
  },

  // master_timeline_orchestrates_sub_compositions
  // Root index.html has multiple `<div data-composition-id="X"
  // data-composition-src="..." data-start="..." data-duration="...">`
  // sub-comp hosts. Each sub-comp file registers its OWN paused timeline in
  // `window.__timelines["X"]`. If the master timeline in index.html does NOT
  // orchestrate them — either by nesting (`tl.add(window.__timelines['X'])`)
  // or by issuing visibility tweens (`tl.fromTo('#X', {autoAlpha:0}, ...)`)
  // — then `tl.totalTime(t)` propagates only to GSAP children of the master
  // and the sub-comp siblings stay paused at local-0 (gsap.set initial
  // state). Every beat renders blank.
  //
  // Observed: openclaw.ai session 01d59512, beats 2 and 4 entirely invisible.
  ({ rawSource, tags, scripts, options }) => {
    const findings: HyperframeLintFinding[] = [];
    // Root-only — sub-compositions register a single timeline of their own
    // and are not expected to orchestrate siblings.
    if (options.isSubComposition) return findings;
    if (isSubCompositionTemplateWrapper(rawSource)) return findings;

    // Collect sub-comp hosts in the root: <... data-composition-id="X"
    // data-composition-src="..." data-start=N data-duration=M>. Both src AND
    // start AND duration must be present for it to count as a beat host
    // (mirrors the "real" beat shape — a bare <div data-composition-id> with
    // no src/start is the root composition wrapper, not a beat).
    type SubCompHost = { id: string; hostIdAttr?: string };
    const subCompHosts: SubCompHost[] = [];
    for (const tag of tags) {
      const id = readAttr(tag.raw, "data-composition-id");
      const src = readAttr(tag.raw, "data-composition-src");
      const start = readAttr(tag.raw, "data-start");
      const duration = readAttr(tag.raw, "data-duration");
      if (!id || !src || !start || !duration) continue;
      // The wrapper may ALSO carry an `id=` attribute distinct from
      // `data-composition-id` (e.g. `<div id="beat-1-host" data-composition-id="beat-1" ...>`).
      // Capture it so we can recognize orchestration through that selector too.
      const hostIdAttr = readAttr(tag.raw, "id") || undefined;
      subCompHosts.push({ id, hostIdAttr });
    }
    if (subCompHosts.length < 2) return findings;

    // Scan scripts for any orchestration of each sub-comp host id "X":
    //   (a) tl.fromTo('#X' or '[data-composition-id="X"]', { ... opacity|autoAlpha ... }, ...)
    //   (b) tl.set('#X' or '[data-composition-id="X"]', { className: ... })
    //   (c) tl.add(window.__timelines['X'], <position>)
    //   (d) tl.add(subTl, ...) where subTl = window.__timelines['X'] earlier
    //
    // The combined script blob is sufficient — orchestration normally lives
    // in the single master <script> in root index.html, but if an author
    // splits it across multiple <script> blocks (assigning subTl in one,
    // adding it in another) the union still captures the intent.
    const scriptBlob = scripts.map((s) => s.content).join("\n");

    // Discover sub-tl variable aliases assigned from window.__timelines['X'].
    // E.g. `const beat1Tl = window.__timelines['beat-1']` → alias 'beat1Tl'
    // tracks orchestration of 'beat-1'.
    const aliasToId = new Map<string, string>();
    const aliasAssignRe =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*window\.__timelines\s*\[\s*["']([^"']+)["']\s*\]/g;
    let am: RegExpExecArray | null;
    while ((am = aliasAssignRe.exec(scriptBlob)) !== null) {
      const aliasName = am[1] || "";
      const id = am[2] || "";
      if (aliasName && id) aliasToId.set(aliasName, id);
    }

    const orchestratedIds = new Set<string>();

    // Pattern (c): tl.add(window.__timelines['X'], ...) — explicit nesting.
    const addRegistryRe =
      /\b(?:tl|timeline)\.add\s*\(\s*window\.__timelines\s*\[\s*["']([^"']+)["']\s*\]/g;
    let m: RegExpExecArray | null;
    while ((m = addRegistryRe.exec(scriptBlob)) !== null) {
      const id = m[1];
      if (id) orchestratedIds.add(id);
    }

    // Pattern (d): tl.add(aliasName, ...) — alias resolves to a sub-tl id.
    const addAliasRe = /\b(?:tl|timeline)\.add\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
    while ((m = addAliasRe.exec(scriptBlob)) !== null) {
      const aliasName = m[1] || "";
      const id = aliasToId.get(aliasName);
      if (id) orchestratedIds.add(id);
    }

    // Patterns (a) and (b): tl.fromTo / tl.to / tl.from / tl.set on a
    // selector that targets a sub-comp host. We accept both `#X` and
    // `[data-composition-id="X"]` forms. Any of these tweens count as
    // orchestration — they at minimum drive visibility / class state on
    // the host, which is enough to make the beat appear (and is the
    // documented escape hatch in the fixHint).
    //
    // The selector arg may be single- or double-quoted, and the OPPOSITE
    // quote can appear inside (e.g. `'[data-composition-id="beat-1"]'`).
    // Match each quote style with its own quote-aware character class.
    const tweenRe = /\b(?:tl|timeline)\.(?:fromTo|to|from|set)\s*\(\s*(?:"([^"]+)"|'([^']+)')/g;
    while ((m = tweenRe.exec(scriptBlob)) !== null) {
      const selector = m[1] ?? m[2] ?? "";
      if (!selector) continue;
      // `#X` selector form — match a sub-comp host id.
      const idMatch = selector.match(/^#([\w-]+)$/);
      if (idMatch?.[1]) {
        orchestratedIds.add(idMatch[1]);
        continue;
      }
      // `[data-composition-id="X"]` selector form.
      const attrMatch = selector.match(/\[data-composition-id=["']([^"']+)["']\]/);
      if (attrMatch?.[1]) orchestratedIds.add(attrMatch[1]);
    }

    // FP guard: helper-function pattern. Authors sometimes wrap tl.to in a
    // helper (e.g. `function xfade(outSel, inSel, t) { tl.to(outSel, ...); }`
    // then `xfade("#beat-1-host", "#beat-2-host", 4.15)`). The tl.to args are
    // variables, so the regex above misses them — but the `#beat-N-host`
    // string literals DO appear in the script as helper-call arguments.
    // For each sub-comp not yet marked orchestrated, check if its
    // `data-composition-id` OR its wrapper `id=` attribute is mentioned as
    // a string literal `#<id>` ANYWHERE in the script (helper args, gsap.set
    // selector arrays, etc.). If yes, consider it orchestrated.
    for (const host of subCompHosts) {
      if (orchestratedIds.has(host.id)) continue;
      const candidateIds = [host.id, host.hostIdAttr].filter(Boolean) as string[];
      for (const idVal of candidateIds) {
        const escapedId = idVal.replace(/[-]/g, "\\$&");
        // Match `#<id>` followed by a non-id-character (so we don't match
        // `#beat-1` inside `#beat-12`).
        const refRe = new RegExp(`["'\\s,(\\[]#${escapedId}(?:[^A-Za-z0-9_-]|$)`);
        if (refRe.test(scriptBlob)) {
          orchestratedIds.add(host.id);
          break;
        }
      }
    }

    // Tally: any sub-comp host whose id is NOT in orchestratedIds is
    // unorchestrated. If ALL sub-comp host ids are unorchestrated, fire.
    const unorchestratedIds = subCompHosts
      .map((h) => h.id)
      .filter((id) => !orchestratedIds.has(id));
    if (unorchestratedIds.length !== subCompHosts.length) return findings;

    const idList = subCompHosts.map((h) => h.id).join(", #");
    findings.push({
      code: "master_timeline_orchestrates_sub_compositions",
      severity: "error",
      message:
        `Root master timeline orchestrates ZERO of the ${subCompHosts.length} sub-composition hosts ` +
        `(#${idList}). Each sub-comp registers \`window.__timelines["X"]\` as a SIBLING of master — ` +
        "GSAP seek (`tl.totalTime(t)`) only propagates to children, so sub-comp timelines stay paused " +
        "at local-0 (gsap.set initial state) and every beat renders blank.",
      fixHint:
        "Either (a) `tl.add(window.__timelines['X'], data-start)` for each sub-comp, " +
        "OR (b) author per-beat `tl.fromTo('#X', {autoAlpha:0}, {autoAlpha:1})` visibility " +
        "tweens on the master.",
    });
    return findings;
  },
];
