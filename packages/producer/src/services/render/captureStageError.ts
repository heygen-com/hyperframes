import { normalizeErrorMessage } from "../../utils/errorMessage.js";

export class CaptureStageError extends Error {
  readonly browserConsole: string[];
  readonly cause: unknown;

  constructor(input: { cause: unknown; browserConsole: string[] }) {
    super(normalizeErrorMessage(input.cause));
    this.name = "CaptureStageError";
    this.cause = input.cause;
    this.browserConsole = input.browserConsole.slice();
    if (input.cause instanceof Error && input.cause.stack) {
      this.stack = input.cause.stack;
    }
  }
}

export function wrapCaptureStageError(error: unknown, browserConsole: string[]): CaptureStageError {
  if (error instanceof CaptureStageError) return error;
  return new CaptureStageError({ cause: error, browserConsole });
}

export function getCaptureStageBrowserConsole(error: unknown): string[] {
  if (error instanceof CaptureStageError) return error.browserConsole;
  return [];
}
