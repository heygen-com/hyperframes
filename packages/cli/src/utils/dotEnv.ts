import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEEDBACK_EMAIL_ENV } from "./feedbackSource.js";

export const PROJECT_ENV_KEYS = [
  "HEYGEN_API_KEY",
  "HYPERFRAMES_API_KEY",
  "ELEVENLABS_API_KEY",
  "FIGMA_TOKEN",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "HYPERFRAMES_VERTEX_PROJECT_ID",
  "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT",
  "HYPERFRAMES_VERTEX_LOCATION",
  "HYPERFRAMES_VERTEX_MODEL",
  "HYPERFRAMES_OPENROUTER_MODEL",
  "HYPERFRAMES_GEMINI_MODEL",
  "HYPERFRAMES_VISION_TIMEOUT_MS",
  // Telemetry opt-outs only turn sending off, and a project .env could already set them.
  "HYPERFRAMES_NO_TELEMETRY",
  "DO_NOT_TRACK",
];

// A quoted value ends at its closing quote; unquoted, `#` starts a comment only after whitespace (`KEY= # note` is empty), so `pass#word` stays.
function valueOf(rawValue: string): string {
  if (/^\s+#/.test(rawValue)) return "";
  const raw = rawValue.trim();
  const quote = raw.charAt(0);
  if (quote === '"' || quote === "'") {
    const end = raw.indexOf(quote, 1);
    return end > 0 ? raw.slice(1, end) : raw.slice(1);
  }
  const comment = raw.match(/\s+#/);
  return comment?.index === undefined ? raw : raw.slice(0, comment.index).trim();
}

function entryOf(rawLine: string): [string, string] | null {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  if (line.startsWith("export ")) line = line.slice(7).trim();
  const eq = line.indexOf("=");
  if (eq < 1) return null;
  return [line.slice(0, eq).trim(), valueOf(line.slice(eq + 1))];
}

function openQuoteOf(trimmedLine: string): string | null {
  const eq = trimmedLine.indexOf("=");
  if (eq < 1) return null;
  const valueStart = trimmedLine.slice(eq + 1).trim();
  const quote = valueStart.charAt(0);
  if (quote !== '"' && quote !== "'") return null;
  return valueStart.indexOf(quote, 1) < 0 ? quote : null;
}

function closingLineIndex(rawLines: string[], from: number, quote: string): number {
  for (let j = from; j < rawLines.length; j++) {
    if ((rawLines[j] ?? "").includes(quote)) return j;
  }
  return -1;
}

// A quoted value left open at end of line continues on later lines until one closes it;
// blank/comment lines and an EOF with no closing quote never open or complete a continuation.
function logicalLines(content: string): string[] {
  const rawLines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? "";
    const trimmed = line.trim();
    const quote = trimmed && !trimmed.startsWith("#") ? openQuoteOf(trimmed) : null;
    const end = quote === null ? -1 : closingLineIndex(rawLines, i + 1, quote);
    if (end === -1) {
      lines.push(line);
      continue;
    }
    lines.push(rawLines.slice(i, end + 1).join("\n"));
    i = end;
  }
  return lines;
}

// Never over a key already set, and never the feedback email in any letter case (Windows env names are case-blind):
// only the launching app may attach it, and an agent can write a project `.env`.
// An optional exact-name allowlist narrows callers that load less-trusted project settings.
export function applyDotEnv(
  content: string,
  env: NodeJS.ProcessEnv,
  allowedKeys?: readonly string[],
): string[] {
  const allowed = allowedKeys === undefined ? undefined : new Set(allowedKeys);
  const ignored: string[] = [];
  for (const entry of logicalLines(content).map(entryOf)) {
    if (!entry) continue;
    const [key, value] = entry;
    if (!key || key.toUpperCase() === FEEDBACK_EMAIL_ENV) continue;
    if (allowed !== undefined && !allowed.has(key)) ignored.push(key);
    else if (!(key in env)) env[key] = value;
  }
  return ignored;
}

export function loadProjectDotEnv(
  dir: string,
  env: NodeJS.ProcessEnv,
  warn: (line: string) => void,
): void {
  let content: string;
  try {
    content = readFileSync(join(dir, ".env"), "utf-8");
  } catch {
    return;
  }
  const ignored = [...new Set(applyDotEnv(content, env, PROJECT_ENV_KEYS))];
  if (ignored.length > 0) {
    warn(
      `[hyperframes] .env: ignoring ${ignored.join(", ")} (a project .env only sets the CLI's own settings)`,
    );
  }
}
