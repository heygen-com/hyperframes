// storyboard.mjs — vendored lenient parser for STORYBOARD.md.
//
// Faithful plain-JS port of @hyperframes/core/storyboard
// (packages/core/src/storyboard/parseStoryboard.ts). Vendored because skills
// ship standalone: installed via `npx skills add`, a skill's scripts can't reach
// the monorepo's core package, and the core export points at .ts source that
// `node` (which runs these scripts) can't load. CANONICAL contract = the core
// parser + skills/hyperframes-core/references/storyboard-format.md; keep this in
// lockstep. Behavior: never throws, accepts freeform narrative, recognizes
// Frame/Beat/Scene headings at H2/H3, preserves unknown keys verbatim under
// `extra` (keys lowercased). Pure node — no deps.

export const FRAME_STATUSES = ["outline", "built", "animated"];
export const DEFAULT_FRAME_STATUS = "outline";

// Detection-only frame heading (ends at the keyword); ReDoS-hardened — keep as-is.
const FRAME_HEADING_RE = /^(#{2,3})[ \t]+(?:frame|beat|scene)\b/i;
const FRAME_TITLE_SEP_RE = /^[\s.:—-]+/;
const HEADING_LEVEL_RE = /^(#{1,6})\s+/;
const META_RE = /^\s*[-*]\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/;
const LEADING_INT_RE = /^(\d+)/;
const DURATION_NUM_RE = /(\d+(?:\.\d+)?)/;
const TRANSITION_KEYS = new Set(["transition_in", "transitionin", "transition"]);
const SCENE_KEYS = new Set(["scene", "description", "summary", "caption"]);
export const VOICEOVER_ALIASES = ["voiceover", "vo", "voice_over", "narration"];
const VOICEOVER_KEYS = new Set(VOICEOVER_ALIASES);

export function parseStoryboard(source) {
  const warnings = [];
  const { globals, bodyStartLine, body } = parseFrontmatter(source, warnings);
  const frames = parseFrames(body, bodyStartLine, warnings);
  return { globals, frames, warnings };
}

function emptyGlobals() {
  return { extra: {} };
}

function isFrameStatus(value) {
  return FRAME_STATUSES.includes(value);
}

// ── Frontmatter ─────────────────────────────────────────────────────────────
function findFrontmatterRange(lines, warnings) {
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

function parseFrontmatterEntries(lines, start, end, warnings) {
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

function parseFrontmatter(source, warnings) {
  const lines = source.split(/\r?\n/);
  const range = findFrontmatterRange(lines, warnings);
  if (!range) return { globals: emptyGlobals(), bodyStartLine: 1, body: source };
  const globals = parseFrontmatterEntries(lines, range.start, range.end, warnings);
  const body = lines.slice(range.end + 1).join("\n");
  return { globals, bodyStartLine: range.end + 2, body };
}

function assignGlobal(globals, key, value) {
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

// ── Frames ──────────────────────────────────────────────────────────────────
function openFrameSection(line, headingLine) {
  const match = FRAME_HEADING_RE.exec(line);
  if (!match) return null;
  const headingText = line.slice(match[0].length).replace(FRAME_TITLE_SEP_RE, "").trim();
  return { headingText, headingLine, level: (match[1] ?? "##").length, lines: [] };
}

function endsFrameSection(line, current) {
  if (!current) return false;
  const heading = HEADING_LEVEL_RE.exec(line);
  return heading !== null && (heading[1] ?? "").length <= current.level;
}

function parseFrames(body, bodyStartLine, warnings) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let current = null;
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

function buildFrame(section, index, warnings) {
  const frame = { index, status: DEFAULT_FRAME_STATUS, narrative: "", extra: {} };
  const { number, title } = parseHeading(section.headingText);
  if (number !== undefined) frame.number = number;
  if (title) frame.title = title;

  const narrativeLines = [];
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

function parseHeading(text) {
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

// Dispatch a recognized metadata key to its field, else stash under `extra`.
// Mirrors core's META_SETTERS map exactly (direct keys + alias sets).
function applyMeta(frame, key, value, headingLine, warnings) {
  switch (key) {
    case "duration":
      applyDuration(frame, value, headingLine, warnings);
      return;
    case "status":
      applyStatus(frame, value, headingLine, warnings);
      return;
    case "poster":
      applyPoster(frame, value);
      return;
    case "src":
      frame.src = value;
      return;
  }
  if (TRANSITION_KEYS.has(key)) {
    frame.transitionIn = value;
    return;
  }
  if (SCENE_KEYS.has(key)) {
    frame.scene = value;
    return;
  }
  if (VOICEOVER_KEYS.has(key)) {
    frame.voiceover = stripQuotes(value);
    return;
  }
  frame.extra[key] = value;
}

function applyPoster(frame, value) {
  const num = DURATION_NUM_RE.exec(value);
  if (num) frame.poster = Number.parseFloat(num[1] ?? "");
}

function applyDuration(frame, value, headingLine, warnings) {
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

function applyStatus(frame, value, headingLine, warnings) {
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

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
