import { defineCommand as defineCittyCommand } from "citty";
import type { ArgsDef, CommandDef } from "citty";

const definedCommands = new WeakSet<object>();

// The one way to define a command: cli.ts wraps what it returns with the shared guards,
// and the agent-mode contract test rejects any registered command not built here.
export function defineCommand<const T extends ArgsDef = ArgsDef>(
  def: CommandDef<T>,
): CommandDef<T> {
  const command = defineCittyCommand(def);
  definedCommands.add(command);
  return command;
}

export function isDefinedCommand(command: unknown): boolean {
  return typeof command === "object" && command !== null && definedCommands.has(command);
}
