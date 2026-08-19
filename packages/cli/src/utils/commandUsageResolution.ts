import type { CommandDef } from "citty";

type LazyCommandDef = CommandDef | (() => CommandDef | Promise<CommandDef>);

export interface ResolvedCommandUsage {
  command: CommandDef;
  parent?: CommandDef;
}

async function loadSubcommand(command: CommandDef, name: string): Promise<CommandDef | undefined> {
  const subcommands = command.subCommands as Record<string, LazyCommandDef> | undefined;
  const candidate = subcommands?.[name];
  if (!candidate) return undefined;
  return typeof candidate === "function" ? candidate() : candidate;
}

/** Resolve the deepest adjacent citty subcommand named by argv. */
export async function resolveCommandUsage(
  root: CommandDef,
  argv: readonly string[],
): Promise<ResolvedCommandUsage> {
  let command = root;
  let parent: CommandDef | undefined;
  for (const argument of argv) {
    if (argument.startsWith("-")) break;
    const child = await loadSubcommand(command, argument);
    if (!child) break;
    parent = command;
    command = child;
  }
  return { command, parent };
}
