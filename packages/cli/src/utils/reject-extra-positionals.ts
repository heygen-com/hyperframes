import { existsSync } from "node:fs";
import type { ArgsDef, CommandDef } from "citty";
import { CliUsageError } from "./commandResult.js";
import { isTextFile } from "./textFile.js";
import { jsonFailure } from "./jsonError.js";

// citty binds each declared positional in order and leaves the rest in `args._`, where they were
// silently dropped (`render ./proj out.mp4` rendered to the default path). Reject them up front.

// Leaf commands that read extra positionals from `args._` on purpose, by command path.
export const ACCEPTS_EXTRA_POSITIONALS = new Set([
  "add",
  "audio",
  "compare",
  "figma asset",
  "skills update",
  "timeline set",
]);

// Free-text commands: their last positional takes every remaining word (`tts hello world`).
export const JOINS_EXTRA_POSITIONALS = new Set(["catalog", "tts"]);

// citty parses `--json` on every command (`--json=1` as "1"); after `--` it is a positional.
function wantsJson(value: unknown): boolean {
  return value === true || (typeof value === "string" && value !== "false" && value !== "0");
}

function declaredArgs(cmd: CommandDef<ArgsDef>): ArgsDef {
  const raw = cmd.args;
  return raw && typeof raw === "object" ? (raw as ArgsDef) : {};
}

function usageLine(path: string, args: ArgsDef): string {
  const parts = ["hyperframes", path];
  let hasOptions = false;
  for (const [name, def] of Object.entries(args)) {
    if (def.type !== "positional") {
      hasOptions = true;
      continue;
    }
    const optional = def.required === false || def.default !== undefined;
    parts.push(optional ? `[${name.toUpperCase()}]` : `<${name.toUpperCase()}>`);
  }
  if (hasOptions) parts.push("[OPTIONS]");
  return parts.join(" ");
}

// An unquoted path with spaces reaches us as several words; the longest run of them that is a file names it.
function runStart(word: string): string {
  if (!word.startsWith("-")) return word;
  const eq = word.indexOf("=");
  return eq < 0 ? "" : word.slice(eq + 1);
}

function spacedPath(argv: readonly string[]): string | undefined {
  let longest = "";
  for (let i = 0; i < argv.length; i++) {
    let joined = runStart(argv[i]!);
    for (let j = i + 1; joined && j < argv.length && !argv[j]!.startsWith("-"); j++) {
      joined = `${joined} ${argv[j]}`;
      if (joined.length > longest.length && existsSync(joined)) longest = joined;
    }
  }
  return longest || undefined;
}

/** Join a free-text command's trailing words, else throw a usage error naming the extras. */
export function resolveExtraPositionals(
  cmd: CommandDef<ArgsDef>,
  path: string,
  parsed: Record<string, unknown> | undefined,
): void {
  if (ACCEPTS_EXTRA_POSITIONALS.has(path)) return;
  const args = declaredArgs(cmd);
  const positionals = Object.entries(args).filter(([, def]) => def.type === "positional");
  const given = (Array.isArray(parsed?._) ? parsed._ : []).map(String);
  const extra = given.slice(positionals.length);
  if (extra.length === 0) return;
  const last = positionals.at(-1)?.[0];
  const words = given.slice(positionals.length - 1);
  // `tts script.txt extra` reads the file, so its first word is a path, not free text.
  const ttsFile = path === "tts" && isTextFile(words[0]!);
  if (parsed && last && JOINS_EXTRA_POSITIONALS.has(path) && !ttsFile) {
    parsed[last] = words.join(" ");
    return;
  }

  const plural = extra.length === 1 ? "" : "s";
  const spaced = spacedPath(process.argv.slice(2));
  const message =
    `Unexpected extra argument${plural} for hyperframes ${path}: ${extra.join(", ")}\n` +
    (spaced ? `'${spaced}' is one path with spaces: quote it.\n` : "") +
    `Usage: ${usageLine(path, args)}`;
  if (wantsJson(parsed?.json)) console.log(JSON.stringify(jsonFailure("usage_error", message)));
  else console.error(message);
  // Telemetry reads the thrown message: the command path and a count, never the arguments.
  throw new CliUsageError(
    `${extra.length} unexpected extra argument${plural} for hyperframes ${path}`,
    {
      presented: true,
    },
  );
}
