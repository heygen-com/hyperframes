export type CaptureFailureKind =
  | "cancelled"
  | "transient_browser"
  | "protocol_timeout"
  | "memory_exhaustion"
  | "verification"
  | "authoring"
  | "io";

export interface CaptureWorkerDiagnostic {
  workerId: number;
  framesCaptured: number;
  startFrame: number;
  endFrame: number;
  lines: readonly string[];
}

export class CaptureFailure extends Error {
  readonly kind: CaptureFailureKind;
  readonly cause: unknown;
  readonly workerDiagnostics: readonly CaptureWorkerDiagnostic[];

  constructor(input: {
    kind: CaptureFailureKind;
    message: string;
    cause?: unknown;
    workerDiagnostics?: readonly CaptureWorkerDiagnostic[];
  }) {
    super(input.message);
    this.name = "CaptureFailure";
    this.kind = input.kind;
    this.cause = input.cause;
    this.workerDiagnostics = Object.freeze(
      (input.workerDiagnostics ?? []).map((diagnostic) =>
        Object.freeze({ ...diagnostic, lines: Object.freeze([...diagnostic.lines]) }),
      ),
    );
    if (input.cause instanceof Error && input.cause.stack) this.stack = input.cause.stack;
  }
}

const TRANSIENT_BROWSER_ERROR_PATTERNS = [
  /Navigating frame was detached/i,
  /Target closed/i,
  /Session closed/i,
  /browser has disconnected/i,
  /Page crashed/i,
  /Execution context was destroyed/i,
  /Cannot find context with specified id/i,
  /Failed to launch the browser process/i,
  /Navigation timeout of \d+ ms exceeded/i,
  /ECONNREFUSED/i,
  /net::ERR_NETWORK_CHANGED/i,
  /Composition has zero duration[\s\S]*Runtime ready: false/,
];

const PROTOCOL_TIMEOUT_PATTERNS = [
  /Runtime\.callFunctionOn timed out/i,
  /Runtime\.evaluate timed out/i,
  /HeadlessExperimental\.beginFrame timed out/i,
  /drawElement worker encode timed out \(frame \d+\)/i,
  /Protocol error[\s\S]*tim(?:ed|e) out/i,
  /Waiting failed:\s*\d+\s*ms exceeded/i,
  /Waiting failed[\s\S]*timeout/i,
  /timeout exceeded/i,
];

const MEMORY_EXHAUSTION_ERROR_PATTERNS = [
  /Set maximum size exceeded/i,
  /Map maximum size exceeded/i,
  /Invalid (?:array|string) length/i,
  /Array buffer allocation failed/i,
  /Cannot create a string longer than/i,
  /Reached heap limit/i,
  /JavaScript heap out of memory/i,
];

// Bun/JSC reports oversized allocations as the bare string "Out of memory".
// Match only the complete message, or the complete worker segment produced by
// parallel capture, so unrelated WebGL diagnostics are not misclassified.
const BUN_MEMORY_EXHAUSTION_EXACT_MESSAGE = /^out of memory\.?$/i;
const BUN_MEMORY_EXHAUSTION_WRAPPED_WORKER_MESSAGE = /\bworker \d+: out of memory\.?(?:;|$)/i;

const VERIFICATION_ERROR_PATTERNS = [
  /DrawElementVerificationError/i,
  /drawElement self-verify/i,
  /verification (?:failed|mismatch)/i,
  /blank drawElement frame/i,
];

const AUTHORING_ERROR_PATTERNS = [
  /Composition has zero duration[\s\S]*Runtime ready: true/i,
  /data-duration/i,
  /No root \[data-composition-id\]/i,
  /failed to parse/i,
  /unparseable/i,
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matchesAny(message: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

const IO_OPERATION_TOKENS = ["read", "write", "rename", "copy", "open", "file", "directory"];

function hasIoOperationFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.split(/[\r\n]/).some((line) =>
    IO_OPERATION_TOKENS.some((operation) => {
      const operationIndex = line.indexOf(operation);
      if (operationIndex < 0) return false;
      const failureStart = operationIndex + operation.length;
      return line.indexOf("failed", failureStart) >= 0 || line.indexOf("error", failureStart) >= 0;
    }),
  );
}

function ioError(error: unknown, message: string): boolean {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return (
    Boolean(code && /^(?:EACCES|EEXIST|EIO|EMFILE|ENFILE|ENOENT|ENOSPC|EPERM|EROFS)$/.test(code)) ||
    hasIoOperationFailure(message)
  );
}

export function classifyCaptureFailure(
  error: unknown,
  options: {
    signal?: AbortSignal;
    workerDiagnostics?: readonly CaptureWorkerDiagnostic[];
  } = {},
): CaptureFailure {
  if (error instanceof CaptureFailure && !options.workerDiagnostics && !options.signal?.aborted) {
    return error;
  }
  const message = messageOf(error);
  let kind: CaptureFailureKind;
  if (options.signal?.aborted || /(?:render|capture)?_?cancelled|AbortError/i.test(message)) {
    kind = "cancelled";
  } else if (
    BUN_MEMORY_EXHAUSTION_EXACT_MESSAGE.test(message.trim()) ||
    BUN_MEMORY_EXHAUSTION_WRAPPED_WORKER_MESSAGE.test(message) ||
    matchesAny(message, MEMORY_EXHAUSTION_ERROR_PATTERNS)
  ) {
    kind = "memory_exhaustion";
  } else if (matchesAny(message, VERIFICATION_ERROR_PATTERNS)) {
    kind = "verification";
  } else if (matchesAny(message, PROTOCOL_TIMEOUT_PATTERNS)) {
    kind = "protocol_timeout";
  } else if (matchesAny(message, TRANSIENT_BROWSER_ERROR_PATTERNS)) {
    kind = "transient_browser";
  } else if (matchesAny(message, AUTHORING_ERROR_PATTERNS)) {
    kind = "authoring";
  } else {
    kind = ioError(error, message) ? "io" : "authoring";
  }
  return new CaptureFailure({
    kind,
    message,
    cause: error,
    workerDiagnostics:
      options.workerDiagnostics ??
      (error instanceof CaptureFailure ? error.workerDiagnostics : undefined),
  });
}

export function isTransientBrowserError(error: unknown): boolean {
  return classifyCaptureFailure(error).kind === "transient_browser";
}

export function isMemoryExhaustionError(error: unknown): boolean {
  return classifyCaptureFailure(error).kind === "memory_exhaustion";
}

export function isFatalCaptureFailure(failure: CaptureFailure): boolean {
  return !["cancelled", "transient_browser", "protocol_timeout"].includes(failure.kind);
}
