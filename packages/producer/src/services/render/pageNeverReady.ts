import { isEvaluateTimeout } from "./captureCost.js";

const PAGE_NEVER_READY = "PAGE_NEVER_READY" as const;

class PageNeverReadyError extends Error {
  readonly code = PAGE_NEVER_READY;
  // The producer server reads these off the error for the wire envelope.
  readonly owner = "user" as const;
  readonly retryable = false as const;

  constructor(cause: unknown) {
    super(
      "The composition page never became ready: it did not answer browser commands during " +
        "calibration or capture, and no frame was captured. Its script may never return.",
      { cause },
    );
    this.name = "PageNeverReadyError";
  }
}

/** Calibration and capture both timed out on `Runtime.evaluate` with no frame captured. */
export function checkPageNeverReady(input: {
  calibrationEvaluateTimedOut: boolean;
  framesRendered: number;
  error: unknown;
}): Error | undefined {
  const { calibrationEvaluateTimedOut, framesRendered, error } = input;
  if (!calibrationEvaluateTimedOut || framesRendered > 0 || !isEvaluateTimeout(error)) {
    return undefined;
  }
  return new PageNeverReadyError(error);
}
