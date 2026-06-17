import {
  DEFAULT_FRAME_STATUS,
  FRAME_STATUSES,
  type FrameStatus,
  type StoryboardFrame,
  type StoryboardGlobals,
  type StoryboardManifest,
  type StoryboardWarning,
} from "./types.js";

/**
 * Lenient parser for `STORYBOARD.md`.
 *
 * The canonical (structured) format is:
 *
 * ```markdown
 * ---
 * format: 1920x1080
 * message: "Ship a launch video in an afternoon"
 * arc: Problem → Solution
 * audience: indie devs on X
 * ---
 *
 * ## Frame 3 — The feature in action
 * - duration: 6s
 * - transition_in: crossfade
 * - status: animated
 * - src: compositions/frames/03-feature.html
 *
 * The diff animates line by line as the narration says "...".
 * ```
 *
 * The parser is deliberately tolerant: it never throws, it accepts freeform
 * narrative, it recognizes `Frame` / `Beat` / `Scene` section headings at H2 or
 * H3, and it records anything surprising as a {@link StoryboardWarning} rather
 * than failing. Unknown frontmatter / metadata keys are preserved in `extra`.
 */
export function parseStoryboard(source: string): StoryboardManifest {
  const warnings: StoryboardWarning[] = [];
  const { globals, bodyStartLine, body } = parseFrontmatter(source, warnings);
  const frames = parseFrames(body, bodyStartLine, warnings);
  return { globals, frames, warnings };
}

// Headings that begin a frame section: `## Frame N`, `### Beat 1.1`, `## Scene 2`.
// Detection-only (ends at the keyword) — the title is sliced off in code. A single
// `[ \t]+` before the required keyword stays linear; avoids the polynomial backtracking
// a trailing `[\s…]*(.*)$` would add on tab-heavy input (CodeQL js/polynomial-redos).
const FRAME_HEADING_RE = /^(#{2,3})[ \t]+(?:frame|beat|scene)\b/i;
/** Leading separators between the frame keyword and its title text. */
const FRAME_TITLE_SEP_RE = /^[\s.:—-]+/;
/** Any markdown heading; captures the `#` run so section depth can be compared. */
const HEADING_LEVEL_RE = /^(#{1,6})\s+/;
/** A metadata list item: `- key: value` or `* key: value`. */
const META_RE = /^\s*[-*]\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/;
/** Leading integer of a frame label, e.g. `3` in `3 — Title` or `1` in `1.1`. */
const LEADING_INT_RE = /^(\d+)/;
/** First numeric token in a duration string, e.g. `6` in `6s`, `6.5` in `6.5 sec`. */
const DURATION_NUM_RE = /(\d+(?:\.\d+)?)/;
/** Metadata keys that all map to the transition-in field. */
const TRANSITION_KEYS = new Set(["transition_in", "transitionin", "transition"]);
/** Metadata keys that all map to the one-line scene description. */
const SCENE_KEYS = new Set(["scene", "description", "summary", "caption"]);
/** Metadata keys that all map to the voiceover/narration line. */
const VOICEOVER_KEYS = new Set(["voiceover", "vo", "voice_over", "narration"]);

interface FrontmatterResult {
  globals: StoryboardGlobals;
  /** 1-based line number where the body (post-frontmatter) begins. */
  bodyStartLine: number;
  body: string;
}

function emptyGlobals(): StoryboardGlobals {
  return { extra: {} };
}

function isFrameStatus(value: string): value is FrameStatus {
  return (FRAME_STATUSES as readonly string[]).includes(value);
}

// ── Frontmatter ───────────────────────────────────────────────────────────────

/** Locate the `---`-delimited frontmatter block, or null when there is none. */
function findFrontmatterRange(
  lines: string[],
  warnings: StoryboardWarning[],
): { start: number; end: number } | null {
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if ((lines[start] ?? "").trim() !== "---") return null;

  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") return { start, end: i };
  }
  warnings.push({
    message: "Frontmatter opening '---' has no closing '---'; treating whole file as body.",
    line: start + 1,
  });
  return null;
}

function parseFrontmatterEntries(
  lines: string[],
  start: number,
  end: number,
  warnings: StoryboardWarning[],
): StoryboardGlobals {
  const globals = emptyGlobals();
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;
    const colon = raw.indexOf(":");
    if (colon === -1) {
      warnings.push({
        message: `Ignored non key:value frontmatter line: "${raw.trim()}"`,
        line: i + 1,
      });
      continue;
    }
    const key = raw.slice(0, colon).trim().toLowerCase();
    assignGlobal(globals, key, stripQuotes(raw.slice(colon + 1).trim()));
  }
  return globals;
}

function parseFrontmatter(source: string, warnings: StoryboardWarning[]): FrontmatterResult {
  const lines = source.split(/\r?\n/);
  const range = findFrontmatterRange(lines, warnings);
  if (!range) return { globals: emptyGlobals(), bodyStartLine: 1, body: source };

  const globals = parseFrontmatterEntries(lines, range.start, range.end, warnings);
  const body = lines.slice(range.end + 1).join("\n");
  return { globals, bodyStartLine: range.end + 2, body };
}

function assignGlobal(globals: StoryboardGlobals, key: string, value: string): void {
  switch (key) {
    case "format":
      globals.format = value;
      break;
    case "message":
      globals.message = value;
      break;
    case "arc":
      globals.arc = value;
      break;
    case "audience":
      globals.audience = value;
      break;
    default:
      globals.extra[key] = value;
  }
}

// ── Frames ────────────────────────────────────────────────────────────────────

interface FrameSection {
  headingText: string;
  headingLine: number;
  /** Heading depth (number of leading `#`) that opened this frame section. */
  level: number;
  lines: string[];
}

/** Open a new frame section if `line` is a frame heading, else null. */
function openFrameSection(line: string, headingLine: number): FrameSection | null {
  const match = FRAME_HEADING_RE.exec(line);
  if (!match) return null;
  const headingText = line.slice(match[0].length).replace(FRAME_TITLE_SEP_RE, "").trim();
  return { headingText, headingLine, level: (match[1] ?? "##").length, lines: [] };
}

/**
 * Whether `line` ends the current frame: a non-frame heading at the same or
 * shallower depth (e.g. a sibling `## Fonts`). Deeper sub-headings (e.g.
 * `#### Beats`) stay part of the frame's narrative.
 */
function endsFrameSection(line: string, current: FrameSection | null): boolean {
  if (!current) return false;
  const heading = HEADING_LEVEL_RE.exec(line);
  return heading !== null && (heading[1] ?? "").length <= current.level;
}

function parseFrames(
  body: string,
  bodyStartLine: number,
  warnings: StoryboardWarning[],
): StoryboardFrame[] {
  const lines = body.split(/\r?\n/);
  const sections: FrameSection[] = [];
  let current: FrameSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const opened = openFrameSection(line, bodyStartLine + i);
    if (opened) {
      sections.push(opened);
      current = opened;
    } else if (endsFrameSection(line, current)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }

  return sections.map((section, idx) => buildFrame(section, idx + 1, warnings));
}

function buildFrame(
  section: FrameSection,
  index: number,
  warnings: StoryboardWarning[],
): StoryboardFrame {
  const frame: StoryboardFrame = { index, status: DEFAULT_FRAME_STATUS, narrative: "", extra: {} };

  const { number, title } = parseHeading(section.headingText);
  if (number !== undefined) frame.number = number;
  if (title) frame.title = title;

  const narrativeLines: string[] = [];
  for (const line of section.lines) {
    const meta = META_RE.exec(line);
    if (meta) {
      applyMeta(
        frame,
        (meta[1] ?? "").toLowerCase(),
        (meta[2] ?? "").trim(),
        section.headingLine,
        warnings,
      );
    } else {
      narrativeLines.push(line);
    }
  }
  frame.narrative = narrativeLines.join("\n").trim();
  return frame;
}

function parseHeading(text: string): { number?: number; title?: string } {
  if (!text) return {};
  const intMatch = LEADING_INT_RE.exec(text);
  if (!intMatch) return { title: text };

  const number = Number.parseInt(intMatch[1] ?? "", 10);
  const rest = text
    .slice((intMatch[0] ?? "").length)
    .replace(/^[\s.:—-]+/, "")
    .trim();
  return { number, title: rest || undefined };
}

/** Setter for a recognized metadata key. Extra trailing args are ignored by simple setters. */
type MetaSetter = (
  frame: StoryboardFrame,
  value: string,
  headingLine: number,
  warnings: StoryboardWarning[],
) => void;

/** Map of metadata key (and aliases) → setter. Keeps {@link applyMeta} a flat dispatch. */
const META_SETTERS = new Map<string, MetaSetter>([
  ["duration", applyDuration],
  ["status", applyStatus],
  ["poster", applyPoster],
  [
    "src",
    (frame, value) => {
      frame.src = value;
    },
  ],
  ...keyedSetters(TRANSITION_KEYS, (frame, value) => {
    frame.transitionIn = value;
  }),
  ...keyedSetters(SCENE_KEYS, (frame, value) => {
    frame.scene = value;
  }),
  ...keyedSetters(VOICEOVER_KEYS, (frame, value) => {
    frame.voiceover = stripQuotes(value);
  }),
]);

function keyedSetters(keys: Set<string>, setter: MetaSetter): Array<[string, MetaSetter]> {
  return [...keys].map((key) => [key, setter]);
}

function applyMeta(
  frame: StoryboardFrame,
  key: string,
  value: string,
  headingLine: number,
  warnings: StoryboardWarning[],
): void {
  const setter = META_SETTERS.get(key);
  if (setter) setter(frame, value, headingLine, warnings);
  else frame.extra[key] = value;
}

function applyPoster(frame: StoryboardFrame, value: string): void {
  const num = DURATION_NUM_RE.exec(value);
  if (num) frame.poster = Number.parseFloat(num[1] ?? "");
}

function applyDuration(
  frame: StoryboardFrame,
  value: string,
  headingLine: number,
  warnings: StoryboardWarning[],
): void {
  frame.duration = value;
  const num = DURATION_NUM_RE.exec(value);
  if (num) {
    frame.durationSeconds = Number.parseFloat(num[1] ?? "");
    return;
  }
  warnings.push({
    message: `Frame ${frame.index}: could not parse duration "${value}".`,
    line: headingLine,
    frameIndex: frame.index,
  });
}

function applyStatus(
  frame: StoryboardFrame,
  value: string,
  headingLine: number,
  warnings: StoryboardWarning[],
): void {
  const normalized = value.toLowerCase();
  if (isFrameStatus(normalized)) {
    frame.status = normalized;
    return;
  }
  frame.extra.status = value;
  warnings.push({
    message: `Frame ${frame.index}: unknown status "${value}"; defaulting to "${DEFAULT_FRAME_STATUS}".`,
    line: headingLine,
    frameIndex: frame.index,
  });
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
