import * as clack from "@clack/prompts";
import type {
  ConfirmOptions,
  PasswordOptions,
  SelectOptions,
  SpinnerOptions,
  SpinnerResult,
  TextOptions,
} from "@clack/prompts";
import { stripVTControlCharacters } from "node:util";
import { isUnattended } from "../utils/attendedTerminal.js";
import { CliUsageError } from "../utils/commandResult.js";

// The only module that imports @clack/prompts (a lint rule enforces it), so no command can
// prompt, or draw a spinner, where nobody is there to see it.

export { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";

/** A command that would ask for confirmation, run where nobody can answer. */
export function confirmationRequired(command: string, hint: string): never {
  throw new CliUsageError(
    `${command} asks for confirmation, and this run cannot answer a prompt.`,
    { hint, code: "confirmation_required" },
  );
}

function assertCanPrompt(): void {
  if (!isUnattended()) return;
  throw new CliUsageError("This command asks a question, and this run cannot answer a prompt.", {
    hint: "Pass the answer as a flag; the command's --help lists them.",
    code: "prompt_unavailable",
  });
}

export function confirm(opts: ConfirmOptions): Promise<boolean | symbol> {
  assertCanPrompt();
  return clack.confirm(opts);
}

export function select<Value>(opts: SelectOptions<Value>): Promise<Value | symbol> {
  assertCanPrompt();
  return clack.select(opts);
}

export function text(opts: TextOptions): Promise<string | symbol> {
  assertCanPrompt();
  return clack.text(opts);
}

export function password(opts: PasswordOptions): Promise<string | symbol> {
  assertCanPrompt();
  return clack.password(opts);
}

function lineSpinner(): SpinnerResult {
  const say = (message?: string) => {
    if (message) process.stderr.write(`${stripVTControlCharacters(message)}\n`);
  };
  return {
    start: say,
    message: () => {},
    stop: say,
    cancel: say,
    error: say,
    clear: () => {},
    isCancelled: false,
  };
}

/** Unattended, the start and outcome messages are each written as one plain line on stderr. */
export function spinner(opts?: SpinnerOptions): SpinnerResult {
  return isUnattended() ? lineSpinner() : clack.spinner(opts);
}
