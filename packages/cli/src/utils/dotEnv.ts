import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { terminalText } from "@hyperframes/core";
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
  sourceDir?: string,
): string[] {
  const allowed = allowedKeys === undefined ? undefined : new Set(allowedKeys);
  const ignored: string[] = [];
  for (const entry of logicalLines(content).map(entryOf)) {
    if (!entry) continue;
    const [key, value] = entry;
    if (!key || key.toUpperCase() === FEEDBACK_EMAIL_ENV) continue;
    if (allowed !== undefined && !allowed.has(key)) ignored.push(key);
    else if (!alreadySetOrYielded(env, key, sourceDir)) {
      env[key] = value;
      if (sourceDir !== undefined && env === process.env)
        projectEnvValues.set(key, { value, sourceDir });
    }
  }
  return ignored;
}

function alreadySetOrYielded(env: NodeJS.ProcessEnv, key: string, sourceDir?: string): boolean {
  return key in env || (sourceDir !== undefined && yieldedKeys.has(keyId(sourceDir, key)));
}

const projectEnvValues = new Map<string, { value: string; sourceDir: string }>();
const yieldedKeys = new Set<string>();
const keyId = (dir: string, name: string) => `${resolve(dir)}\0${name}`;

function yieldKey(name: string, dir: string): void {
  delete process.env[name];
  projectEnvValues.delete(name);
  yieldedKeys.add(keyId(dir, name));
}

export function projectEnvDir(name: string): string | undefined {
  const set = projectEnvValues.get(name);
  return set !== undefined && process.env[name] === set.value ? set.sourceDir : undefined;
}

// Each group is one choice between providers: capture and snapshot vision, then Gemini speech and music.
const COMPETING_PROVIDER_KEYS: readonly (readonly string[])[] = [
  [
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "HYPERFRAMES_VERTEX_PROJECT_ID",
    "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT",
  ],
  ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GCS_CREDS"],
];

const competitorsOf = (name: string): string[] =>
  COMPETING_PROVIDER_KEYS.filter((group) => group.includes(name)).flatMap((group) =>
    group.filter((other) => other !== name && Boolean(process.env[other])),
  );

async function untrustedEnvOrigin(dir: string): Promise<string | null> {
  const { receivedFiles, receivedRecordStatus } = await import("./privateProjectFile.js");
  if (receivedRecordStatus(dir) === "unchecked")
    return "a project whose origin could not be checked (too many folders to scan)";
  return receivedFiles(dir)(".env") ? "a received project" : null;
}

/** Unsets each provider key a received project's `.env` set while the person has their own credential for a competing provider. */
export async function yieldReceivedProviderKeys(warn: (line: string) => void): Promise<void> {
  const contested = [...projectEnvValues.keys()].filter(
    (name) => projectEnvDir(name) !== undefined && competitorsOf(name).length > 0,
  );
  const origins = new Map<string, string | null>();
  for (const dir of new Set(contested.map((name) => projectEnvDir(name) ?? ""))) {
    origins.set(dir, await untrustedEnvOrigin(dir));
  }
  const originOf = (name: string) => origins.get(projectEnvDir(name) ?? "") ?? null;
  for (const name of contested.filter((name) => originOf(name) !== null)) {
    const own = competitorsOf(name).find((other) => originOf(other) === null);
    if (own === undefined) continue;
    const dir = projectEnvDir(name) ?? "";
    const origin = originOf(name);
    yieldKey(name, dir);
    warn(
      `[hyperframes] .env: ignoring ${name} from ${origin} (${terminalText(join(dir, ".env"))}); using your own ${own}`,
    );
  }
}

// Capture's vision credentials in the order it picks them; a Vertex one is usable only with both parts set.
const VISION_CREDENTIALS: readonly (readonly string[])[] = [
  ["OPENROUTER_API_KEY"],
  ["HYPERFRAMES_VERTEX_PROJECT_ID", "HYPERFRAMES_VERTEX_ACCESS_TOKEN"],
  ["HYPERFRAMES_VERTEX_PROJECT_ID", "HYPERFRAMES_VERTEX_SERVICE_ACCOUNT"],
  ["GEMINI_API_KEY"],
  ["GOOGLE_API_KEY"],
];

export const geminiKeyName = (): string =>
  process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GOOGLE_API_KEY";

export const visionCredential = (): readonly string[] | undefined =>
  VISION_CREDENTIALS.find((parts) => parts.every((part) => Boolean(process.env[part])));

const projectKeysNoted = new Set<string>();

/** Says once per process, before a provider uses `name` from a project `.env`, which file it came from. */
export async function noteProjectProviderKey(
  name: string,
  use: string,
  warn: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  const dir = projectEnvDir(name);
  if (dir === undefined || projectKeysNoted.has(name)) return;
  projectKeysNoted.add(name);
  const origin = (await untrustedEnvOrigin(dir)) ?? "a project .env";
  warn(`[hyperframes] Using ${name} from ${terminalText(join(dir, ".env"))}, ${origin}: ${use}.`);
}

export const PROJECT_ENV_ORIGINS = "HYPERFRAMES_PROJECT_ENV_ORIGINS";
export const PROJECT_ENV_YIELDED = "HYPERFRAMES_PROJECT_ENV_YIELDED";

export const projectEnvYielded = (): [string, string][] =>
  [...yieldedKeys].map((id) => {
    const [dir = "", name = ""] = id.split("\0");
    return [name, dir];
  });

/** The folder of each key a project `.env` set, for the scripts the CLI launches to weigh the same way. */
export function projectEnvOrigins(): Record<string, string> {
  return Object.fromEntries(
    [...projectEnvValues.keys()].flatMap((name) => {
      const dir = projectEnvDir(name);
      return dir === undefined ? [] : [[name, dir]];
    }),
  );
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
  const ignored = [...new Set(applyDotEnv(content, env, PROJECT_ENV_KEYS, dir))];
  if (ignored.length > 0) {
    warn(
      `[hyperframes] .env: ignoring ${ignored.join(", ")} (a project .env only sets the CLI's own settings)`,
    );
  }
}
