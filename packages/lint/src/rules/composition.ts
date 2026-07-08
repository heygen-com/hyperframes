import type { LintContext, HyperframeLintFinding, ExtractedBlock } from "../context";
import {
  findHtmlTag,
  readAttr,
  readJsonAttr,
  stripJsComments,
  truncateSnippet,
  WINDOW_TIMELINE_ASSIGN_PATTERN,
} from "../utils";
import { COMPOSITION_VARIABLE_TYPES } from "@hyperframes/parsers/composition";

// Agent guidance thresholds: warning-only nudges for files/tracks that become hard
// to inspect and revise reliably in a single composition.
const MAX_COMPOSITION_LINES = 300;
const MAX_TIMED_ELEMENTS_PER_TRACK = 3;
const TRACK_DENSITY_EXEMPT_TAGS = new Set(["audio", "script", "style", "video"]);

// `parseFloat("0.1") + parseFloat("0.2") = 0.30000000000000004`. Sub-second
// authored adjacencies survive parse + add as a value a few ulps above the
// next clip's start; a strict `>` fires the overlap rule on adjacencies that
// are exact in the source HTML. 1μs sits ~11 orders of magnitude above the
// observed drift (worst ~2e-16s across every realistic decimal pair) and 4
// below one 60fps frame (~16.67ms), so this only ever swallows float slop.
const OVERLAP_EPSILON_SECONDS = 1e-6;

function countPhysicalLines(source: string): number {
  if (source.length === 0) return 0;

  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutFinalNewline.split("\n").length;
}

function countStructuralLines(source: string): number {
  return countPhysicalLines(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>"));
}

export function isRegistrySourceFile(filePath?: string): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, "/");
  return /(?:^|\/)registry\/blocks\/([^/]+)\/\1\.html$/i.test(normalized);
}

export function isRegistryInstalledFile(rawSource: string): boolean {
  return /^\s*<!--\s*hyperframes-registry-item:[^>]*-->/i.test(rawSource.slice(0, 512));
}

function isCompositionRootOrMount(rawTag: string): boolean {
  return Boolean(
    readAttr(rawTag, "data-composition-id") || readAttr(rawTag, "data-composition-src"),
  );
}

// Asset references inside CSS `url(...)`/`url("...")`/`url('...')` functions.
// Returns the inner path without quotes; comments are stripped first so
// `/* url(foo) */` is ignored. Bare `url()` and `data:` are excluded by the
// rules that consume this — the helper just yields raw URL values.
function extractCssUrlReferences(css: string): string[] {
  const out: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const urlPattern = /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = urlPattern.exec(noComments)) !== null) {
    const raw = (m[2] ?? "").trim();
    if (raw) out.push(raw);
  }
  return out;
}

// Top-level CSS selectors (comma-split) in a stylesheet, skipping at-rule headers
// (@media/@keyframes/...) and keyframe stops. Heuristic — the lint layer has no
// full CSS parser, and rules elsewhere in this file scan CSS the same way.
function extractCssSelectors(css: string): string[] {
  const out: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleHeader = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = ruleHeader.exec(noComments)) !== null) {
    const header = (m[1] ?? "").trim();
    if (!header || header.startsWith("@")) continue;
    for (const sel of header.split(",")) {
      const s = sel.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

// Class tokens in a selector's leftmost compound (before the first descendant /
// child / sibling combinator). `.frame .title` → ["frame"]; `.a.b > .c` → ["a","b"].
function leftmostCompoundClasses(selector: string): string[] {
  const leftmost = selector.trim().split(/[\s>+~]+/)[0] ?? "";
  return (leftmost.match(/\.([\w-]+)/g) ?? []).map((c) => c.slice(1));
}

// Distinct selectors across all <style> blocks whose leftmost compound keys off one
// of the root element's own classes — the ones that break under id-scoping.
function rootClassStyledSelectors(styles: ExtractedBlock[], rootClasses: string[]): string[] {
  const offenders: string[] = [];
  for (const style of styles) {
    for (const selector of extractCssSelectors(style.content)) {
      const hitsRoot = leftmostCompoundClasses(selector).some((c) => rootClasses.includes(c));
      if (hitsRoot && !offenders.includes(selector)) offenders.push(selector);
    }
  }
  return offenders;
}

/** Declared variable ids from an <html> tag's raw text; null when the JSON is unparseable. */
function collectDeclaredVariableIds(htmlTagRaw: string): Set<string> | null {
  const declared = new Set<string>();
  const raw = readJsonAttr(htmlTagRaw, "data-composition-variables");
  if (!raw) return declared;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return declared;
  for (const entry of parsed) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string") declared.add(id);
  }
  return declared;
}

export const compositionRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // invalid_parent_traversal_in_asset_path — catches `../` traversal in src,
  // href, inline-style url(), and <style> url() asset references on
  // compositions. Sub-compositions live under compositions/ but are served
  // with the project root as their base URL, so any `../`-traversing path
  // climbs above the project root and 404s in Studio preview. Renders
  // tolerate it because the server-side bundler rewrites `../foo` against
  // each sub-composition's source path; the runtime now mirrors that fallback
  // (see rewriteSubCompositionAssetPaths in runtime/compositionLoader.ts), but
  // the authoring-time signal is still wrong — flag it at lint time so the
  // baked path is plain root-relative and matches what the bundler emits.
  //
  // Mirrors the runtime fallback's surface: `[src]` / `[href]` attribute
  // values, `[style]` inline url(), and `<style>` block url() references.
  // Skips absolute URLs (http(s)://, //, data:, /-prefixed root-relative),
  // hash anchors, and plain relative paths (`assets/x.mp4`) — only `../`
  // traversal is flagged. Subsumes the older `../capture/`-specific rule.
  // fallow-ignore-next-line complexity
  ({ tags, styles, rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];

    const offenders: string[] = [];
    const collect = (value: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed.startsWith("../") && trimmed !== "..") return;
      offenders.push(trimmed);
    };

    for (const tag of tags) {
      collect(readAttr(tag.raw, "src"));
      collect(readAttr(tag.raw, "href"));
      // Use readJsonAttr for `style` — inline url('...') values contain the
      // opposite quote, which readAttr's [^"']+ class would truncate.
      const styleAttr = readJsonAttr(tag.raw, "style");
      if (styleAttr) {
        for (const url of extractCssUrlReferences(styleAttr)) collect(url);
      }
    }
    for (const style of styles) {
      for (const url of extractCssUrlReferences(style.content)) collect(url);
    }

    if (offenders.length === 0) return [];

    // Group counts by leading path token (e.g. ../capture/, ../assets/, ../../assets/)
    // so the message names the offending prefixes instead of a bare count.
    const prefixCounts = new Map<string, number>();
    for (const path of offenders) {
      const prefix = path.match(/^(?:\.\.\/)+[^/]+\//)?.[0] ?? path;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
    const prefixSummary = Array.from(prefixCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([prefix, count]) => (count > 1 ? `${prefix} (${count})` : prefix))
      .join(", ");

    return [
      {
        code: "invalid_parent_traversal_in_asset_path",
        severity: "error",
        message:
          `Found ${offenders.length} asset path(s) traversing above the project root with "../" ` +
          `(${prefixSummary}). Renders rewrite this against each sub-composition's source path, but Studio preview and other live consumers resolve against the project root and 404.`,
        fixHint:
          'Use plain root-relative paths (e.g. "assets/...", "capture/...", "fonts/...") — compositions are served with the project root as their base URL, so paths must be root-relative, not relative to the compositions/ directory.',
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
  // fallow-ignore-next-line complexity
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
  // fallow-ignore-next-line complexity
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
  // fallow-ignore-next-line complexity
  ({ tags }) => {
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      if (readAttr(tag.raw, "data-layer") && !readAttr(tag.raw, "data-track-index")) {
        const elementId = readAttr(tag.raw, "id") || undefined;
        findings.push({
          code: "deprecated_data_layer",
          severity: "error",
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
          severity: "error",
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

  // timed_element_missing_clip_class
  // fallow-ignore-next-line complexity
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
      // data-track-index alone marks a layer container, not a time-bounded clip
      if (!hasStart && !hasDuration) continue;

      const classAttr = readAttr(tag.raw, "class") || "";
      const hasClip = classAttr.split(/\s+/).includes("clip");
      if (hasClip) continue;

      const elementId = readAttr(tag.raw, "id") || undefined;
      findings.push({
        code: "timed_element_missing_clip_class",
        severity: "error",
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
  // fallow-ignore-next-line complexity
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
        if (current.end - next.start > OVERLAP_EPSILON_SECONDS) {
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

  // root_composition_missing_data_start
  ({ rootTag, options }) => {
    const findings: HyperframeLintFinding[] = [];
    if (options.isSubComposition) return findings;
    if (!rootTag) return findings;
    const compId = readAttr(rootTag.raw, "data-composition-id");
    if (!compId) return findings;
    const hasStart = readAttr(rootTag.raw, "data-start") !== null;
    if (!hasStart) {
      findings.push({
        code: "root_composition_missing_data_start",
        severity: "error",
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
    const trimmed = rawSource.trimStart().toLowerCase();
    if (trimmed.startsWith("<template")) {
      findings.push({
        code: "standalone_composition_wrapped_in_template",
        severity: "error",
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

  // missing_data_no_timeline
  // The producer polls window.__timelines[id] with a 45-second timeout waiting
  // for GSAP timeline registration. Compositions that never call
  // window.__timelines[id] = tl stall for 45 s every render. Adding
  // data-no-timeline to the root element tells the producer to skip the poll.
  ({ rootTag, rootCompositionId, scripts, rawSource, options }) => {
    if (options.isSubComposition) return [];
    if (!rootCompositionId || !rootTag) return [];
    // readAttr only matches valued attrs (attr="..."); data-no-timeline is
    // typically boolean (no value). Strip quoted attribute values first to
    // avoid matching attr names that appear inside other values
    // (e.g. title="add data-no-timeline here"), then check with a boundary
    // that rejects hyphenated variants (data-no-timeline-start has '-' next,
    // not a word-break char).
    const tagNoValues = rootTag.raw.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/(?:^|\s)data-no-timeline(?=[\s>=/]|$)/i.test(tagNoValues)) return [];
    // Can't scan external script files for timeline registration; skip to avoid
    // false positives on compositions that register via a bundled JS file.
    if (/<script\b[^>]*\bsrc\s*=/i.test(rawSource)) return [];
    const registersTimeline = scripts.some((s) => s.content.includes("window.__timelines["));
    if (registersTimeline) return [];
    return [
      {
        code: "missing_data_no_timeline",
        severity: "warning",
        message:
          "This composition has no `window.__timelines` registration but is missing `data-no-timeline`. " +
          "The producer polls for timeline registration for up to 45 seconds before timing out, " +
          "adding 45 s to every render.",
        fixHint:
          'Add `data-no-timeline` to the root element to skip the poll: `<div data-composition-id="..." data-no-timeline ...>`.',
        snippet: truncateSnippet(rootTag.raw),
      },
    ];
  },

  // requestanimationframe_in_composition
  ({ scripts, rawSource, options }) => {
    if (isRegistrySourceFile(options.filePath) || isRegistryInstalledFile(rawSource)) return [];
    const findings: HyperframeLintFinding[] = [];
    for (const script of scripts) {
      const stripped = stripJsComments(script.content);
      if (/requestAnimationFrame\s*\(/.test(stripped)) {
        findings.push({
          code: "requestanimationframe_in_composition",
          severity: "error",
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

  // invalid_variable_values_json
  // Host elements (`[data-composition-src]`) carry per-instance values via
  // `data-variable-values`. The runtime swallows JSON errors silently and
  // falls back to declared defaults, which masks typos. This rule surfaces
  // the parse failure so authors notice before render time.
  // fallow-ignore-next-line complexity
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
          severity: "error",
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
          severity: "error",
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

  // unknown_variable_binding
  // data-var-src / data-var-text bind an element to a declared variable id;
  // the runtime silently keeps the authored fallback when the id resolves to
  // nothing, so a typo'd binding is invisible until a customer's override
  // does nothing. Skipped for fragment files (no <html>): their values come
  // from a host's data-variable-values, which this file can't see.
  ({ source, tags }) => {
    const htmlTag = findHtmlTag(source);
    if (!htmlTag) return [];
    const declared = collectDeclaredVariableIds(htmlTag.raw);
    // null = unparseable declarations; invalid_composition_variables_declaration
    // reports that failure, so this rule stays quiet.
    if (declared === null) return [];
    const findings: HyperframeLintFinding[] = [];
    for (const tag of tags) {
      for (const attr of ["data-var-src", "data-var-text"]) {
        const id = readAttr(tag.raw, attr)?.trim();
        if (!id || declared.has(id)) continue;
        findings.push({
          code: "unknown_variable_binding",
          severity: "warning",
          message: `<${tag.name}> binds ${attr}="${id}" but no variable "${id}" is declared in data-composition-variables — the binding will silently keep the authored fallback.`,
          fixHint: `Declare the variable on <html>: data-composition-variables='[{"id":"${id}","type":"${attr === "data-var-src" ? "image" : "string"}","label":"${id}","default":"..."}]', or fix the binding id.`,
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
  // fallow-ignore-next-line complexity
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
          severity: "error",
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
          severity: "error",
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
          severity: "error",
          message: `data-composition-variables entry [${i}] must be an object with id, type, label, and default.`,
          snippet: truncateSnippet(htmlTag.raw),
        });
        continue;
      }
      const e = entry as Record<string, unknown>;
      const missing: string[] = [];
      if (typeof e.id !== "string") missing.push("id");
      if (typeof e.type !== "string" || !knownTypes.has(e.type)) missing.push("type");
      if (typeof e.label !== "string") missing.push("label");
      if (!("default" in e)) missing.push("default");
      if (missing.length > 0) {
        findings.push({
          code: "invalid_composition_variables_declaration",
          severity: "error",
          message: `data-composition-variables entry [${i}] is missing or has invalid: ${missing.join(", ")}. Type must be one of string, number, color, boolean, enum, font, image.`,
          snippet: truncateSnippet(htmlTag.raw),
        });
      }
    }
    return findings;
  },

  // html_dir_attribute_breaks_render — valid non-LTR dir values on
  // <html> renders correctly in preview/snapshot but produces a fully
  // blank/black video from render, with no other lint/validate/inspect
  // check catching it (output file size, far smaller than expected, is the
  // only tell). Confirmed independently by two separate reports, both
  // diagnosing the same exact trigger and the same fix: drop dir from
  // <html>, keep lang, and scope `direction: rtl` to individual
  // text-containing elements via CSS instead (text still bidi-shapes
  // correctly). Advisory-only — this does not attempt to fix the render
  // pipeline's own root cause (suspected to be a capture step that clips a
  // fixed top-left-origin screenshot region, which RTL layout can shift the
  // actual content away from), only surfaces the already-confirmed footgun
  // before someone hits it blind.
  ({ source }) => {
    const htmlTag = findHtmlTag(source);
    if (!htmlTag) return [];
    const dir = readAttr(htmlTag.raw, "dir");
    if (!dir) return [];
    const normalizedDir = dir.toLowerCase();
    if (normalizedDir !== "rtl" && normalizedDir !== "auto") return [];
    const scopedDirection = normalizedDir === "auto" ? 'dir="auto"' : `direction: ${normalizedDir}`;
    return [
      {
        code: "html_dir_attribute_breaks_render",
        severity: "error",
        message: `<html dir="${dir}"> renders correctly in preview/snapshot but produces a fully blank/black video from render — a confirmed, silent failure.`,
        fixHint: `Remove dir="${dir}" from <html>. Keep lang, and scope ${scopedDirection} to individual text-containing elements instead — text still shapes correctly via the browser's own bidi algorithm.`,
        snippet: truncateSnippet(htmlTag.raw),
      },
    ];
  },

  // subcomposition_blanks_before_host
  // Warns when a full-bleed sub-composition slot ends before the host composition
  // does, leaving the slot blank for the remainder (issue #1540). Scoped narrowly to
  // the high-signal shape — a sole/dominant external mount starting at ~0 — so it
  // stays silent on intentional short clips (an intro followed by other clips that
  // carry the timeline forward).
  // fallow-ignore-next-line complexity
  ({ tags, rootTag }) => {
    if (!rootTag) return [];
    const rootDuration = Number(readAttr(rootTag.raw, "data-duration"));
    if (!Number.isFinite(rootDuration) || rootDuration <= 0) return [];

    // Two independent knobs that happen to share a 0.5s magnitude. Tuned for
    // real hosts (tens to hundreds of seconds); on a very short host (~6s) the
    // EPSILON slack would let a ~10% blank tail pass unflagged — acceptable
    // because the silent-blank trap this rule targets only matters at scale.
    const EPSILON = 0.5; // seconds; tolerance for "ends/covers near the host end"
    const START_TOLERANCE = 0.5; // seconds; "starts at the composition start"
    const round3 = (n: number) => Math.round(n * 1000) / 1000;

    // Timed children of the root. An element with data-start but no usable
    // data-duration is treated as covering the tail (end = Infinity), so an
    // unknown-length sibling suppresses the warning rather than triggering it.
    const timed = tags
      .filter((tag) => tag.index !== rootTag.index && readAttr(tag.raw, "data-start") !== null)
      .map((tag) => {
        const start = Number(readAttr(tag.raw, "data-start")) || 0;
        const dur = Number(readAttr(tag.raw, "data-duration"));
        const end = Number.isFinite(dur) && dur > 0 ? start + dur : Infinity;
        return { tag, start, end };
      });

    // `tags` is a flat list (no nesting depth), so a timed element nested
    // *inside* a candidate slot is treated as a tail-covering sibling rather
    // than a descendant. Acceptable: external src mounts are empty by
    // convention (content is loaded from the linked file), so the only
    // false-negative path is rare and matches the flat-tag scope of the
    // sibling rules in this file.
    const tailCovered = (exceptIndex: number) =>
      timed.some((t) => t.tag.index !== exceptIndex && t.end >= rootDuration - EPSILON);

    const findings: HyperframeLintFinding[] = [];
    for (const t of timed) {
      if (readAttr(t.tag.raw, "data-composition-src") === null) continue; // external slot only
      if (t.start > START_TOLERANCE) continue; // must start at the composition start
      if (!Number.isFinite(t.end)) continue; // known, finite slot length
      if (t.end >= rootDuration - EPSILON) continue; // already fills the host window
      if (tailCovered(t.tag.index)) continue; // another clip covers the tail — not full-bleed
      const elementId = readAttr(t.tag.raw, "id") || undefined;
      const gap = round3(rootDuration - t.end);
      findings.push({
        code: "subcomposition_blanks_before_host",
        severity: "warning",
        message: `<${t.tag.name}${elementId ? ` id="${elementId}"` : ""}> sub-composition ends at ${round3(t.end)}s but the composition runs to ${round3(rootDuration)}s — its slot will be blank for ~${gap}s.`,
        elementId,
        fixHint: `data-duration is the slot's visible window. Set this sub-composition's data-duration to ${round3(rootDuration - t.start)} to fill the host window, or add another clip to cover the remaining ~${gap}s.`,
        snippet: truncateSnippet(t.tag.raw),
      });
    }
    return findings;
  },

  // subcomposition_root_styled_by_class
  // A sub-composition's <style> is scoped at render time to
  // `[data-composition-id="<id>"] <selector>` so scenes inlined into one document
  // can't leak styles into each other. A rule whose LEFTMOST selector is the ROOT
  // element's own class (e.g. `.frame { ... }` on the same element that carries
  // data-composition-id) therefore becomes a DESCENDANT selector that can never
  // match the root — the whole scene renders unstyled (tiny text top-left, images
  // at natural size). lint/validate/inspect evaluate the file in isolation (no
  // scoping) and Studio previews each scene in its own iframe (no scoping), so the
  // break is invisible until the composited MP4 render. Style the root via `#root`
  // (the scoper special-cases the root id) and descendants via plain selectors,
  // like the registry blocks — the runtime already scopes each scene by id, so a
  // class namespace on the root is redundant.
  ({ rootTag, rootCompositionId, styles, options }) => {
    if (!options.isSubComposition) return [];
    if (isRegistrySourceFile(options.filePath)) return [];
    if (!rootTag || !rootCompositionId) return [];

    const rootClasses = (readAttr(rootTag.raw, "class") || "").split(/\s+/).filter(Boolean);
    if (rootClasses.length === 0) return [];

    const offenders = rootClassStyledSelectors(styles, rootClasses);
    if (offenders.length === 0) return [];

    const example = offenders.slice(0, 3).join(", ");
    return [
      {
        code: "subcomposition_root_styled_by_class",
        severity: "error",
        message:
          `Root element has class="${rootClasses.join(" ")}" and is styled by ${offenders.length} rule(s) keyed off that class (e.g. ${example}). ` +
          `At render, every sub-composition rule is scoped to [data-composition-id="${rootCompositionId}"] <selector>, so a selector whose leftmost part is the ROOT's own class becomes a descendant selector that cannot match the root — the scene renders unstyled (tiny text top-left, full-size images). ` +
          `lint/validate/inspect and Studio's per-frame iframe preview do not scope, so this passes every static check and looks correct in preview.`,
        selector: example,
        fixHint: `Give the root id="root" and style it with \`#root { ... }\` plus plain descendant selectors (\`.kicker\`, \`#hero\`) — the runtime already scopes each sub-composition by data-composition-id, so a class namespace on the root is redundant and breaks under scoping.`,
        snippet: truncateSnippet(rootTag.raw),
      },
    ];
  },

  // root_composition_missing_duration_source
  //
  // The render engine (packages/engine/src/services/frameCapture.ts) needs a
  // positive window.__hf.duration to know how many frames to capture. GSAP
  // timelines set this automatically. Non-GSAP runtimes (CSS, WAAPI, Lottie)
  // are now auto-inferred by the runtime too (see
  // packages/core/src/runtime/init.ts resolveAdapterDurationFloorSeconds and
  // the adapters' getInferredDurationSeconds) — so data-duration is optional
  // wherever the runtime can work it out on its own.
  //
  // This rule fires for cases where the total render length is not reliably
  // determinable without an explicit data-duration:
  //   - No GSAP timeline AND no data-duration AND no non-GSAP animation
  //     signal at all (nothing for any adapter to discover — render fails).
  //   - Three.js used with no data-duration (no discoverable AnimationClip
  //     duration in this codebase's adapter — see adapters/three.ts).
  //   - Any infinite CSS animation-iteration-count with no data-duration,
  //     EVEN when a finite CSS animation is present alongside it. An unbounded
  //     animation makes the intended total length ambiguous — the runtime will
  //     infer a finite sibling's length if one exists, but that's a fallback,
  //     not a declaration of intent, so we still require data-duration here.
  //     (This is intentionally stricter than the runtime's own inference.)
  // Purely finite CSS/WAAPI animations and Lottie are excluded — the runtime
  // infers those unambiguously, so requiring data-duration there would be a
  // false positive against the runtime's own auto-inference. Note lint is
  // advisory by default (see shouldBlockRender) — it only blocks render under
  // --strict/--strict-all — so a strict flag here nudges toward an explicit,
  // guaranteed-correct value without failing renders that would succeed.
  // fallow-ignore-next-line complexity
  ({ rootTag, scripts, styles, tags, options }) => {
    if (options.isSubComposition) return [];
    if (!rootTag) return [];
    // Not every file linted as a "root" HTML document is a video composition
    // — e.g. a slideshow demo.html mounts <hyperframes-player src="index.html">
    // with no data-composition-id of its own. Nothing to capture there, so
    // there's no duration contract to enforce.
    if (readAttr(rootTag.raw, "data-composition-id") === null) return [];
    if (readAttr(rootTag.raw, "data-duration") !== null) return [];

    // Strip comments before scanning for signals — a commented-out
    // `.animate(...)` call or `/* animation: spin 2s infinite; */` must not
    // satisfy the "has a duration source" check, or the composition still
    // fails at render with zero duration despite lint passing.
    const allScriptTexts = scripts.map((s) => stripJsComments(s.content));
    const hasGsapTimeline = allScriptTexts.some((t) => /gsap\.timeline\s*\(/.test(t));
    const hasRegisteredTimeline = allScriptTexts.some((t) =>
      WINDOW_TIMELINE_ASSIGN_PATTERN.test(t),
    );
    // A GSAP timeline drives duration via window.__timelines regardless of
    // data-duration — nothing to flag once one is registered.
    if (hasGsapTimeline && hasRegisteredTimeline) return [];

    const allCss = styles.map((s) => s.content).join("\n");
    const allInlineStyles = tags.map((t) => readAttr(t.raw, "style") || "").join("\n");
    const combinedCss = `${allCss}\n${allInlineStyles}`.replace(/\/\*[\s\S]*?\*\//g, "");

    const usesLottie =
      tags.some((t) => readAttr(t.raw, "data-lottie-src") !== null) ||
      allScriptTexts.some((t) => /lottie\.(loadAnimation)\b|__hfLottie\b/.test(t));
    const usesThree = allScriptTexts.some((t) => /\bTHREE\./.test(t));
    // `.animate([...], ...)` catches the array-literal keyframes form;
    // `.animate({...}, ...)` catches the object-literal (PropertyIndexedKeyframes)
    // form; `.animate(someVar, ...)` catches keyframes built up in a variable
    // first.
    const usesWaapi = allScriptTexts.some((t) => /\.animate\s*\(\s*[[{$A-Za-z_]/.test(t));
    const hasCssAnimationName = /\banimation(?:-name)?\s*:/.test(combinedCss);
    const hasInfiniteCssAnimation =
      /\banimation(?:-iteration-count)?\s*:[^;{}]*(?<![\w-])infinite(?![\w-])/.test(combinedCss);

    const hasAnyNonGsapSignal = usesLottie || usesThree || usesWaapi || hasCssAnimationName;

    if (!hasAnyNonGsapSignal) {
      // No GSAP timeline, no data-duration, and nothing for any adapter to
      // discover — the composition has no source of truth for duration at
      // all. This is the exact shape of the 27K "zero duration" render
      // failures this rule exists to catch before render time.
      return [
        {
          code: "root_composition_missing_duration_source",
          severity: "error",
          message:
            "Root composition has no data-duration, no GSAP timeline, and no CSS/WAAPI/Lottie/Three.js " +
            "animation for the runtime to infer a duration from. The render engine cannot determine " +
            'how long to capture and will fail with "Composition has zero duration".',
          fixHint:
            'Add data-duration="<seconds>" to the root element, or add a paused GSAP timeline registered ' +
            "on window.__timelines.",
          snippet: truncateSnippet(rootTag.raw),
        },
      ];
    }

    if (usesThree) {
      // No AnimationMixer/AnimationClip discovery in the three.js adapter
      // today (see adapters/three.ts) — genuinely not inferable.
      return [
        {
          code: "root_composition_missing_duration_source",
          severity: "error",
          message:
            "Root composition uses Three.js with no data-duration. The runtime cannot discover a " +
            "Three.js scene's duration automatically (no AnimationClip/AnimationMixer inspection) — " +
            'render will fail with "Composition has zero duration".',
          fixHint: 'Add data-duration="<seconds>" to the root element.',
          snippet: truncateSnippet(rootTag.raw),
        },
      ];
    }

    if (hasInfiniteCssAnimation && !usesLottie && !usesWaapi) {
      // An infinite/unbounded CSS animation makes the intended total length
      // ambiguous, so we require an explicit data-duration even when a finite
      // CSS animation is present alongside it. This is deliberately stricter
      // than the runtime's own inference: the CSS adapter's
      // getInferredDurationSeconds (see adapters/css.ts) returns the longest
      // finite animation end-time when one exists (so a finite sibling would
      // render at that length) and null when every animation is unbounded (so
      // a render with no finite source fails outright). Either way the author
      // hasn't declared how long the video should be — a decorative infinite
      // spinner next to a 3s fade doesn't tell us the clip is meant to be 3s
      // — so we flag it and let them state intent. The message stays honest
      // about both outcomes rather than claiming the render always fails.
      return [
        {
          code: "root_composition_missing_duration_source",
          severity: "error",
          message:
            "Root composition uses a CSS animation with animation-iteration-count: infinite and no " +
            "data-duration, so the intended total length is ambiguous. If a finite animation is also " +
            "present the runtime infers that length; with no finite source the render fails with " +
            '"Composition has zero duration". Declare the intended length explicitly.',
          fixHint:
            'Add data-duration="<seconds>" to the root element with the intended total length.',
          snippet: truncateSnippet(rootTag.raw),
        },
      ];
    }

    // Finite CSS animation, WAAPI .animate(), or Lottie — the runtime infers
    // duration from these at render time (see resolveAdapterDurationFloorSeconds
    // in runtime/init.ts). Not an error; data-duration is optional here.
    return [];
  },
];
