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

export interface CaptureEndpointDiagnostic {
  host: string;
  port: number;
}

export class CaptureFailure extends Error {
  readonly kind: CaptureFailureKind;
  readonly cause: unknown;
  readonly workerDiagnostics: readonly CaptureWorkerDiagnostic[];
  readonly endpoint?: Readonly<CaptureEndpointDiagnostic>;

  constructor(input: {
    kind: CaptureFailureKind;
    message: string;
    cause?: unknown;
    workerDiagnostics?: readonly CaptureWorkerDiagnostic[];
    endpoint?: CaptureEndpointDiagnostic;
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
    this.endpoint = input.endpoint ? Object.freeze({ ...input.endpoint }) : undefined;
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
  // CDP can refuse a capture call outright with this exact wording; timed-out
  // variants of the same call hit PROTOCOL_TIMEOUT_PATTERNS, checked first.
  // Anchored to this literal reason (not just the CDP method) so an unrelated,
  // genuinely deterministic Page.captureScreenshot error isn't swept in too.
  /Protocol error \(Page\.captureScreenshot\): Unable to capture screenshot/i,
];

const PROTOCOL_TIMEOUT_PATTERNS = [
  /Network\.enable timed out/i,
  /Runtime\.callFunctionOn timed out/i,
  /Runtime\.evaluate timed out/i,
  /Page\.captureScreenshot timed out/i,
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

const CAUSE_CHAIN_DEPTH = 5;

/**
 * Every message reachable from `error` through `.cause` (and the members of
 * an `AggregateError`), top-level first. undici flattens a failed connect to
 * a top-level `"fetch failed"` whose `.cause` carries the errno message, and a
 * `localhost` connect that tried both address families surfaces as an
 * `AggregateError` with an empty own message, so classification must read the
 * whole chain — the same walk `isDrawElementVerificationError` performs.
 */
function collectMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < CAUSE_CHAIN_DEPTH && current !== undefined && current !== null;
    depth++
  ) {
    const message = messageOf(current);
    if (message) messages.push(message);
    if (current instanceof AggregateError) {
      for (const member of current.errors) {
        const memberMessage = messageOf(member);
        if (memberMessage) messages.push(memberMessage);
      }
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return messages;
}

// Node/Bun errno text is unbracketed (`connect ETIMEDOUT ::1:49152`); Chrome
// URLs bracket IPv6 (`http://[::1]:49152/`). Both name the same loopback.
const LOOPBACK_HOST = String.raw`(127\.0\.0\.1|localhost|\[::1\]|::1)`;
const LOOPBACK_CONNECTION_LOSS_PATTERNS = [
  new RegExp(String.raw`connect (?:ETIMEDOUT|ECONNREFUSED|ECONNRESET) ${LOOPBACK_HOST}:(\d+)`, "i"),
  new RegExp(
    String.raw`net::ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE) at https?://${LOOPBACK_HOST}:(\d+)`,
    "i",
  ),
];

/**
 * The loopback endpoint a connection-loss error names, when it names one.
 * Only loopback hosts qualify: the render's file server and Chrome's DevTools
 * endpoint both live there, so a lost loopback connection is the signal the
 * pre-frame recovery acts on. A remote host that times out stays fatal.
 */
function loopbackConnectionLossEndpoint(text: string): CaptureEndpointDiagnostic | undefined {
  for (const pattern of LOOPBACK_CONNECTION_LOSS_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1] || !match[2]) continue;
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    return { host: match[1] === "[::1]" ? "::1" : match[1], port };
  }
  return undefined;
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

function isMemoryExhaustionText(message: string, chainText: string): boolean {
  return (
    BUN_MEMORY_EXHAUSTION_EXACT_MESSAGE.test(message.trim()) ||
    BUN_MEMORY_EXHAUSTION_WRAPPED_WORKER_MESSAGE.test(chainText) ||
    matchesAny(chainText, MEMORY_EXHAUSTION_ERROR_PATTERNS)
  );
}

interface CaptureFailureKindInput {
  error: unknown;
  message: string;
  chainText: string;
  aborted: boolean;
  loopbackLoss: boolean;
}

const CANCELLATION_PATTERN = /(?:render|capture)?_?cancelled|AbortError/i;

// Order matters: cancellation and memory exhaustion outrank everything, a
// protocol timeout outranks a loopback host mentioned in the same text, and
// authoring/io are the fall-through.
const ORDERED_KIND_MATCHERS: ReadonlyArray<
  readonly [CaptureFailureKind, (input: CaptureFailureKindInput) => boolean]
> = [
  ["cancelled", (input) => input.aborted || CANCELLATION_PATTERN.test(input.chainText)],
  ["memory_exhaustion", (input) => isMemoryExhaustionText(input.message, input.chainText)],
  ["verification", (input) => matchesAny(input.chainText, VERIFICATION_ERROR_PATTERNS)],
  ["protocol_timeout", (input) => matchesAny(input.chainText, PROTOCOL_TIMEOUT_PATTERNS)],
  [
    "transient_browser",
    (input) => input.loopbackLoss || matchesAny(input.chainText, TRANSIENT_BROWSER_ERROR_PATTERNS),
  ],
  ["authoring", (input) => matchesAny(input.chainText, AUTHORING_ERROR_PATTERNS)],
];

function resolveCaptureFailureKind(input: CaptureFailureKindInput): CaptureFailureKind {
  const matched = ORDERED_KIND_MATCHERS.find(([, matches]) => matches(input));
  if (matched) return matched[0];
  return ioError(input.error, input.chainText) ? "io" : "authoring";
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
  const messages = collectMessages(error);
  const message = messages[0] ?? messageOf(error);
  // Patterns match against the whole cause chain so a wrapped connect failure
  // classifies by the errno it carries, not by the wrapper's generic text.
  const chainText = messages.join("\n");
  const lossEndpoint = loopbackConnectionLossEndpoint(chainText);
  const endpoint = error instanceof CaptureFailure ? error.endpoint : lossEndpoint;
  return new CaptureFailure({
    kind: resolveCaptureFailureKind({
      error,
      message,
      chainText,
      aborted: options.signal?.aborted === true,
      loopbackLoss: lossEndpoint !== undefined,
    }),
    message,
    cause: error,
    workerDiagnostics:
      options.workerDiagnostics ??
      (error instanceof CaptureFailure ? error.workerDiagnostics : undefined),
    endpoint,
  });
}

export function isTransientBrowserError(error: unknown): boolean {
  return classifyCaptureFailure(error).kind === "transient_browser";
}

/**
 * A transient failure that names the loopback endpoint whose connection was
 * lost — the file server or Chrome's DevTools port. This is the only
 * transient shape the producer's pre-frame recovery retries on an ordinary
 * one-worker stream; a bare `Target closed` (Chrome killed by SIGTERM) carries
 * no endpoint and stays outside it.
 */
export type LoopbackConnectionLoss = CaptureFailure & {
  endpoint: Readonly<CaptureEndpointDiagnostic>;
};

export function isLoopbackConnectionLoss(
  failure: CaptureFailure,
): failure is LoopbackConnectionLoss {
  return failure.kind === "transient_browser" && failure.endpoint !== undefined;
}

export function isMemoryExhaustionError(error: unknown): boolean {
  return classifyCaptureFailure(error).kind === "memory_exhaustion";
}

export function isFatalCaptureFailure(failure: CaptureFailure): boolean {
  return !["cancelled", "transient_browser", "protocol_timeout"].includes(failure.kind);
}
