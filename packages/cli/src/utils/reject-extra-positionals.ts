import type { ArgsDef, CommandDef } from "citty";
import { CliUsageError } from "./commandResult.js";

// citty binds each declared positional in order and leaves the rest in `args._`, where they were
// silently dropped (`render ./proj out.mp4` rendered to the default path). Reject them up front.

// Leaf commands that read extra positionals from `args._` on purpose, by command path.
export const ACCEPTS_EXTRA_POSITIONALS = new Set([
  "compare",
  "figma asset",
  "skills update",
  "timeline set",
]);

function declaredArgs(cmd: CommandDef<ArgsDef>): ArgsDef {
  const raw = cmd.args;
  return raw && typeof raw === "object" ? (raw as ArgsDef) : {};
}

export function usageLine(path: string, args: ArgsDef): string {
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

/** Throw a usage error naming every positional beyond the ones `cmd` declares. */
export function assertNoExtraPositionals(
  cmd: CommandDef<ArgsDef>,
  path: string,
  parsed: { _?: unknown } | undefined,
  rawArgs: string[],
): void {
  if (ACCEPTS_EXTRA_POSITIONALS.has(path)) return;
  const args = declaredArgs(cmd);
  const slots = Object.values(args).filter((def) => def.type === "positional").length;
  const extra = (Array.isArray(parsed?._) ? parsed._ : []).slice(slots).map(String);
  if (extra.length === 0) return;

  const plural = extra.length === 1 ? "" : "s";
  const message =
    `Unexpected extra argument${plural} for hyperframes ${path}: ${extra.join(", ")}\n` +
    `Usage: ${usageLine(path, args)}`;
  if (rawArgs.includes("--json")) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(message);
  throw new CliUsageError(message, { presented: true });
}
