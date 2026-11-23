import type { AudioFailureDiagnostic } from "@hyperframes/engine";

const ENCODER_INTERRUPTED = "ENCODER_INTERRUPTED" as const;

interface EncoderFailureResult {
  error?: string;
  failureReason?: "external_interruption";
  audioFailures?: AudioFailureDiagnostic[];
}

/** A host/process lifecycle interruption that is safe to retry on a fresh producer. */
export class EncoderInterruptedError extends Error {
  readonly code = ENCODER_INTERRUPTED;
  readonly owner = "system" as const;
  readonly retryable = true as const;

  /** Retained inside the producer for diagnostics; never copied to the wire envelope. */
  readonly diagnosticMessage: string;

  readonly audioFailures: AudioFailureDiagnostic[];

  constructor(
    prefix: string,
    diagnosticMessage: string,
    audioFailures: AudioFailureDiagnostic[] = [],
  ) {
    super(`${prefix}: encoder process was interrupted by the host lifecycle`);
    this.name = "EncoderInterruptedError";
    this.diagnosticMessage = diagnosticMessage;
    this.audioFailures = audioFailures;
  }
}

export function encoderFailureError(prefix: string, result: EncoderFailureResult): Error {
  const message = `${prefix}: ${result.error ?? "unknown encoder failure"}`;
  return result.failureReason === "external_interruption"
    ? new EncoderInterruptedError(prefix, message, result.audioFailures)
    : new Error(message);
}
