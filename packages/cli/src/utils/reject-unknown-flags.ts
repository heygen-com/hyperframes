import type { ArgsDef, CommandDef } from "citty";

// citty is permissive: an unrecognized flag (e.g. `render --out x` when the flag
// is `--output`/`-o`) is silently ignored instead of rejected, so the value is
// dropped and the command falls back to its default — a silent wrong result. We
// reject unknown flags up front with a clear message.

// Global flags citty / the CLI understand on every command.
const ALWAYS_KNOWN = new Set(["help", "h", "version", "v", "json"]);

// A camelCase arg name (`gifLoop`) is passed as `--gif-loop`; a kebab name is
// passed as-is. Accept both spellings so the validator matches citty's parsing.
function nameVariants(name: string): string[] {
  const kebab = name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return [name, kebab, camel];
}

function knownFlags(args: ArgsDef | undefined): Set<string> {
  const known = new Set(ALWAYS_KNOWN);
  for (const [name, def] of Object.entries(args ?? {})) {
    for (const v of nameVariants(name)) known.add(v);
    const alias = (def as { alias?: string | string[] })?.alias;
    if (typeof alias === "string") known.add(alias);
    else if (Array.isArray(alias)) for (const a of alias) known.add(a);
  }
  return known;
}

// The unknown flag a single token introduces, or null when it's fine
// (positional, flag value, `--`, or all-known). `--no-foo` -> `foo`,
// `--flag=value` -> `flag`; a combined short group (`-ab`) checks each char.
// `--flag`, `--flag=value`, `--no-flag` -> the bare flag name.
function longFlagName(tok: string): string {
  const name = tok.slice(2).split("=")[0] ?? "";
  return name.startsWith("no-") ? name.slice(3) : name;
}

function unknownFlagIn(tok: string, known: Set<string>): string | null {
  if (tok === "-" || !tok.startsWith("-")) return null; // positional or flag value
  if (tok.startsWith("--")) {
    const name = longFlagName(tok);
    return name && !known.has(name) ? `--${name}` : null;
  }
  for (const ch of tok.slice(1).split("=")[0] ?? "") {
    if (!known.has(ch)) return `-${ch}`; // combined shorts: check each char
  }
  return null;
}

/**
 * Throw on the first flag in `rawArgs` not declared by `cmd` (its args + aliases
 * + the global set). Only dash-prefixed tokens are inspected, so positionals and
 * flag values pass through untouched. Stops at `--`.
 */
export function assertKnownFlags(cmd: CommandDef<ArgsDef>, rawArgs: string[]): void {
  if (!Array.isArray(rawArgs)) return;
  // citty types `args` as Resolvable<ArgsDef> (it may be a fn/promise); every
  // hyperframes command uses a static object, so treat anything else as "no
  // declared args" and skip validation rather than risk a wrong rejection.
  const rawDef = cmd.args;
  const args = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const known = knownFlags(args);
  for (const tok of rawArgs) {
    if (tok === "--") break;
    const bad = unknownFlagIn(tok, known);
    if (bad) throw new Error(`Unknown flag: ${bad}`);
  }
}
