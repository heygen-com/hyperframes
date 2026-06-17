import { FRAME_HEADING_RE, VOICEOVER_ALIASES } from "./parseStoryboard.js";
import type { FrameStatus } from "./types.js";

// Re-exported for back-compat: the canonical list now lives in parseStoryboard.ts.
export { VOICEOVER_ALIASES };

/**
 * Surgical writers for `STORYBOARD.md`.
 *
 * These update a single frame's metadata in place — preserving all other
 * content, formatting, comments, and non-frame sections — rather than
 * re-serializing the parsed manifest (which would be lossy). Used by the
 * storyboard frame-focus editor to persist `voiceover` / `status` edits.
 *
 * Frame detection and the voiceover aliases are imported from `parseStoryboard.ts`
 * so the read and write sides share one definition and can't drift.
 */

const HEADING_LEVEL_RE = /^(#{1,6})[ \t]+/;
/**
 * `- key:` prefix — captures the bullet, key, and `:`-separator (incl. surrounding
 * spaces) so the line can be rewritten as `<prefix><new value>`. Deliberately stops
 * at the separator and captures no value/EOL: the old value is overwritten wholesale,
 * so there's nothing to capture, and dropping the trailing `[ \t]*…(.*)$` removes the
 * overlapping-quantifier polynomial backtracking CodeQL flags (js/polynomial-redos).
 */
const META_LINE_RE = /^([ \t]*[-*][ \t]+)([A-Za-z_][\w-]*)([ \t]*:[ \t]*)/;

interface FrameBounds {
  /** 0-based line index of the frame heading. */
  start: number;
  /** 0-based line index just past the frame's content (exclusive). */
  end: number;
  /** Heading depth (`#` count) that opened the frame. */
  level: number;
}

/** Locate every frame's line range, using the same boundary rules as the parser. */
// fallow-ignore-next-line complexity
function frameBounds(lines: string[]): FrameBounds[] {
  const bounds: FrameBounds[] = [];
  let current: FrameBounds | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const frameMatch = FRAME_HEADING_RE.exec(line);
    if (frameMatch) {
      if (current) current.end = i;
      current = { start: i, end: lines.length, level: (frameMatch[1] ?? "##").length };
      bounds.push(current);
      continue;
    }
    const heading = HEADING_LEVEL_RE.exec(line);
    if (current && heading && (heading[1] ?? "").length <= current.level) {
      current.end = i;
      current = null;
    }
  }
  return bounds;
}

function formatValue(value: string, quote: boolean): string {
  // Metadata is a single line: collapse every whitespace run (incl. newlines from a
  // multi-line textarea) to one space so the value can't split the `- key:` line and
  // corrupt the file. A single linear `\s+` avoids the `\s*\r?\n\s*` polynomial
  // backtracking CodeQL flags (js/polynomial-redos) on long all-space input.
  const clean = value.replace(/\s+/g, " ").trim();
  // Always wrap when quoting. The parser's stripQuotes removes exactly one outer
  // pair, so wrapping round-trips losslessly even for empty values or values that
  // themselves contain quotes (`"foo"` → `""foo""` → parses back to `"foo"`).
  return quote ? `"${clean}"` : clean;
}

/**
 * Set (or insert) a metadata field on the frame at `frameIndex` (1-based).
 * Replaces an existing `- key: …` line (matching any alias) in place; otherwise
 * inserts a new line right after the frame heading.
 *
 * Throws when the frame doesn't exist, so a stale/raced index (e.g. the frame
 * was deleted on disk after render) surfaces as an error instead of a silent
 * no-op the UI would report as a successful save.
 */
export function setFrameField(
  source: string,
  frameIndex: number,
  key: string,
  value: string,
  opts: { aliases?: readonly string[]; quote?: boolean } = {},
): string {
  const lines = source.split(/\r?\n/);
  const target = frameBounds(lines)[frameIndex - 1];
  if (!target) throw new Error(`storyboard frame ${frameIndex} not found`);

  const aliases = new Set([key, ...(opts.aliases ?? [])].map((k) => k.toLowerCase()));
  const formatted = formatValue(value, opts.quote ?? false);

  for (let i = target.start + 1; i < target.end; i++) {
    const match = META_LINE_RE.exec(lines[i] ?? "");
    if (match && aliases.has((match[2] ?? "").toLowerCase())) {
      lines[i] = `${match[1]}${match[2]}${match[3]}${formatted}`;
      return lines.join("\n");
    }
  }

  lines.splice(target.start + 1, 0, `- ${key}: ${formatted}`);
  return lines.join("\n");
}

/** Set the voiceover (guide) line for a frame, matching any voiceover alias. */
export function setFrameVoiceover(source: string, frameIndex: number, value: string): string {
  return setFrameField(source, frameIndex, "voiceover", value, {
    aliases: VOICEOVER_ALIASES,
    quote: true,
  });
}

/** Set the lifecycle status for a frame. */
export function setFrameStatus(source: string, frameIndex: number, status: FrameStatus): string {
  return setFrameField(source, frameIndex, "status", status);
}
