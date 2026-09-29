const ENCODER_INTERRUPTED = "ENCODER_INTERRUPTED" as const;

interface EncoderFailureResult {
  error?: string;
  failureReason?: "external_interruption";
}

/** A host/process lifecycle interruption that is safe to retry on a fresh producer. */
export class EncoderInterruptedError extends Error {
  readonly code = ENCODER_INTERRUPTED;
  readonly owner = "system" as const;
  readonly retryable = true as const;

  /** Retained inside the producer for diagnostics; never copied to the wire envelope. */
  readonly diagnosticMessage: string;

  constructor(prefix: string, diagnosticMessage: string) {
    super(`${prefix}: encoder process was interrupted by the host lifecycle`);
    this.name = "EncoderInterruptedError";
    this.diagnosticMessage = diagnosticMessage;
  }
}

export function encoderFailureError(prefix: string, result: EncoderFailureResult): Error {
  const message = `${prefix}: ${result.error ?? "unknown encoder failure"}`;
  return result.failureReason === "external_interruption"
    ? new EncoderInterruptedError(prefix, message)
    : new Error(message);
}
