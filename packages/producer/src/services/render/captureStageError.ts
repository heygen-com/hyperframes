import { normalizeErrorMessage } from "../../utils/errorMessage.js";
import { CaptureFailure, classifyCaptureFailure } from "@hyperframes/engine";
import { EncoderInterruptedError } from "./encoderInterruption.js";

export class CaptureStageError extends CaptureFailure {
  readonly browserConsole: string[];

  constructor(input: { cause: unknown; browserConsole: string[] }) {
    const classified = classifyCaptureFailure(input.cause);
    super({
      kind: classified.kind,
      message: normalizeErrorMessage(input.cause),
      cause: input.cause,
      workerDiagnostics: classified.workerDiagnostics,
    });
    this.name = "CaptureStageError";
    this.browserConsole = input.browserConsole.slice();
    if (input.cause instanceof Error && input.cause.stack) {
      this.stack = input.cause.stack;
    }
  }
}

export function wrapCaptureStageError(
  error: unknown,
  browserConsole: string[],
): CaptureStageError | EncoderInterruptedError {
  if (error instanceof CaptureStageError || error instanceof EncoderInterruptedError) return error;
  return new CaptureStageError({ cause: error, browserConsole });
}

export function getCaptureStageBrowserConsole(error: unknown): string[] {
  if (error instanceof CaptureStageError) return error.browserConsole;
  return [];
}
