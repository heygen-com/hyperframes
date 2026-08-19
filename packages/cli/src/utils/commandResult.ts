export type CommandResultKind = "success" | "usage_error" | "runtime_error";

export interface CommandResult {
  exitCode: number;
  kind: CommandResultKind;
  /** The command already emitted its structured/human output. */
  presented?: boolean;
}

const SUCCESS_RESULT: CommandResult = { exitCode: 0, kind: "success" };
let pendingResult: CommandResult = SUCCESS_RESULT;
let rootExitRequester: ((exitCode: number) => void) | undefined;
let rootExitCodeSanitizer: (() => void) | undefined;

export class CliUsageError extends Error {
  readonly result: CommandResult;

  constructor(
    message = "Invalid command usage",
    options: { exitCode?: number; presented?: boolean } = {},
  ) {
    super(message);
    this.name = "CliUsageError";
    this.result = {
      exitCode: options.exitCode ?? 1,
      kind: "usage_error",
      presented: options.presented,
    };
  }
}

export class CliRuntimeError extends Error {
  readonly result: CommandResult;

  constructor(
    message = "Command failed",
    options: { exitCode?: number; presented?: boolean } = {},
  ) {
    super(message);
    this.name = "CliRuntimeError";
    this.result = {
      exitCode: options.exitCode ?? 1,
      kind: "runtime_error",
      presented: options.presented,
    };
  }
}

/** Internal control-flow signal for an early, already-presented result. */
export class CliResultSignal extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    super(`CLI result ${result.exitCode}`);
    this.name = "CliResultSignal";
    this.result = result;
  }
}

export function failCommand(exitCode = 1): never {
  throw new CliRuntimeError("Command failed", { exitCode, presented: true });
}

export function failUsage(exitCode = 1): never {
  throw new CliUsageError("Invalid command usage", { exitCode, presented: true });
}

export function finishCommand(exitCode = 0): never {
  throw new CliResultSignal({
    exitCode,
    kind: exitCode === 0 ? "success" : "runtime_error",
    presented: true,
  });
}

/** Record a non-fatal result while allowing output/finalizers to complete. */
export function setCommandResult(result: CommandResult): void {
  if (pendingResult.exitCode !== 0 && result.exitCode === 0) return;
  pendingResult = result;
}

export function setCommandExitCode(exitCode: number): void {
  setCommandResult({
    exitCode,
    kind: exitCode === 0 ? "success" : "runtime_error",
    presented: true,
  });
}

export function consumeCommandResult(): CommandResult {
  const result = pendingResult;
  pendingResult = SUCCESS_RESULT;
  return result;
}

/** Called only by cli.ts to retain ownership of forced process termination. */
export function registerRootExitRequester(requester: (exitCode: number) => void): void {
  rootExitRequester = requester;
}

/** Called only by cli.ts to retain ownership of process exit-code mutation. */
export function registerRootExitCodeSanitizer(sanitizer: () => void): void {
  rootExitCodeSanitizer = sanitizer;
}

/** Ask cli.ts to clear stray process exit state after a successful render. */
export function sanitizeSuccessfulExitCode(): void {
  rootExitCodeSanitizer?.();
}

/** Ask cli.ts to finalize telemetry/output and then terminate the process. */
export function requestCliExit(exitCode = 0): void {
  if (!rootExitRequester) {
    setCommandResult({
      exitCode,
      kind: exitCode === 0 ? "success" : "runtime_error",
      presented: true,
    });
    return;
  }
  rootExitRequester(exitCode);
}
