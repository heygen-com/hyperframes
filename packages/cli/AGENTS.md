# Working on the CLI

Read this before you add or change a command in `packages/cli`.

## CLI rules for agents

Coding agents and CI run this CLI far more often than people do, with no
terminal and nobody to answer a question. Every command follows these rules,
and `src/cli.agentMode.test.ts` runs every registered command the way an agent
does to hold them.

- **Stdout is data, stderr is messages.** Results go to stdout. Progress,
  warnings, notices and errors go to stderr.
- **Never prompt without a person.** `isUnattended()` in
  `src/utils/attendedTerminal.ts` is true without a TTY, under CI, inside a
  coding agent, or with `HYPERFRAMES_AGENT=1`. Import prompts and spinners from
  `src/ui/prompts.ts`, never from `@clack/prompts` (lint enforces it): its
  prompts refuse to ask when unattended. A command that needs a confirmation
  takes `--yes` and calls `confirmationRequired()` when it is missing.
- **Exit codes.** 0 success, 1 the command ran and failed, 2 the command line
  is wrong. Throw `CliUsageError` for a usage error; it exits 2.
- **`--json` always returns an envelope.** A command supports `--json` by
  declaring a `json` arg; every other command rejects the flag with exit 2. On
  failure, stdout is `{"ok": false, "error": {"code", "message", "hint"?}}`.
  Build it with `jsonFailure()` from `src/utils/jsonError.ts`. If a failing
  `--json` run printed nothing, `cli.ts` writes the envelope for it.
- **Define commands with `defineCommand` from `src/utils/defineCommand.ts`**
  and register them in `commandLoaders` in `src/cli.ts`. The contract test
  picks up a new command from there, with no change to the test.
