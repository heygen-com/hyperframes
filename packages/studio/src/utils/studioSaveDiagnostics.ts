import { trackStudioEvent } from "./studioTelemetry";

type StudioTelemetryValue = string | number | boolean | null | undefined;
const STUDIO_SAVE_ATTEMPT_PROPERTY = "__studioSaveAttempt";

export interface StudioSaveFailureInput {
  source: string;
  error: unknown;
  statusCode?: number | null;
  filePath?: string | null;
  mutationType?: string | null;
  attempt?: number | null;
  label?: string | null;
  targetId?: string | null;
  targetSelector?: string | null;
  targetSourceFile?: string | null;
}

const SERVER_WHY = new Set([
  "nul",
  "dangling_symlink",
  "outside_project",
  "protected_path",
  "busy",
  "permission",
  "not_a_file",
  "too_large",
  "binary",
  "link",
  "project_dir_missing",
]);

export class StudioSaveHttpError extends Error {
  readonly statusCode: number;
  readonly alreadyToasted: boolean;
  readonly heldFile: boolean;
  readonly why: string | null;

  constructor(
    message: string,
    statusCode: number,
    options: { alreadyToasted?: boolean; heldFile?: boolean; why?: string | null } = {},
  ) {
    super(message);
    this.name = "StudioSaveHttpError";
    this.statusCode = statusCode;
    this.alreadyToasted = options.alreadyToasted ?? false;
    this.heldFile = options.heldFile ?? false;
    this.why = options.why ?? null;
  }
}

export class StudioSaveNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioSaveNetworkError";
  }
}

export class StudioFileConflictError extends StudioSaveHttpError {
  readonly filePath: string;
  readonly currentVersion: string | null;
  readonly currentContent: string | null;
  readonly attemptedContent: string;

  constructor(input: {
    filePath: string;
    currentVersion: string | null;
    currentContent: string | null;
    attemptedContent: string;
  }) {
    super(`Save conflict: ${input.filePath} changed outside this Studio session`, 409);
    this.name = "StudioFileConflictError";
    this.filePath = input.filePath;
    this.currentVersion = input.currentVersion;
    this.currentContent = input.currentContent;
    this.attemptedContent = input.attemptedContent;
  }
}

export type StudioSaveDrainResult<Failure = unknown> =
  | { status: "clean" }
  | { status: "conflict"; error: StudioFileConflictError }
  | { status: "failed"; error: Failure };

function readNumericProperty(value: object, key: string): number | undefined {
  const record = value as Record<string, unknown>;
  const property = record[key];
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function createStudioSaveAbortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Save aborted", "AbortError");
  const error = new Error("Save aborted");
  error.name = "AbortError";
  return error;
}

function throwIfStudioSaveAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createStudioSaveAbortError();
}

function attachStudioSaveAttempt(error: unknown, attempt: number): unknown {
  if (!error || typeof error !== "object") return error;
  try {
    Object.defineProperty(error, STUDIO_SAVE_ATTEMPT_PROPERTY, {
      value: attempt,
      configurable: true,
    });
  } catch {
    // Best-effort diagnostic only.
  }
  return error;
}

export function getStudioSaveErrorTone(error: unknown): "info" | "error" {
  return error instanceof Error && "tone" in error && error.tone === "info" ? "info" : "error";
}

export function getStudioSaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown save failure";
}

export function markStudioSaveErrorAlreadyToasted<T>(error: T): T {
  if (!error || typeof error !== "object") return error;
  try {
    Object.defineProperty(error, "alreadyToasted", { value: true, configurable: true });
  } catch {
    // Best effort: failure reporting must not replace the original save error.
  }
  return error;
}

export function isStudioSaveErrorAlreadyToasted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { alreadyToasted?: unknown }).alreadyToasted === true) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause !== error && isStudioSaveErrorAlreadyToasted(cause);
}

export function getStudioSaveStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct =
    readNumericProperty(error, "statusCode") ??
    readNumericProperty(error, "status") ??
    readNumericProperty(error, "status_code");
  if (direct != null) return direct;

  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) return getStudioSaveStatusCode(cause);
  return undefined;
}

function getStudioSaveAttempt(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const direct = readNumericProperty(error, STUDIO_SAVE_ATTEMPT_PROPERTY);
  if (direct != null) return direct;

  const cause = (error as { cause?: unknown }).cause;
  if (cause && cause !== error) return getStudioSaveAttempt(cause);
  return undefined;
}

function isStudioSaveAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRetryableStudioSaveError(error: unknown): boolean {
  if (isStudioSaveAbortError(error)) return false;
  if (error instanceof StudioSaveNetworkError) return true;
  const statusCode = getStudioSaveStatusCode(error);
  if (statusCode == null) return false;
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

export function buildStudioSaveFailureProperties(
  input: StudioSaveFailureInput,
): Record<string, StudioTelemetryValue> {
  const statusCode = input.statusCode ?? getStudioSaveStatusCode(input.error) ?? null;
  const attempt = input.attempt ?? getStudioSaveAttempt(input.error) ?? undefined;
  return {
    source: input.source,
    ...studioSaveErrorCodes(input.error),
    status_code: statusCode,
    file_path: input.filePath ?? input.targetSourceFile ?? undefined,
    mutation_type: input.mutationType ?? undefined,
    attempt,
    label: input.label ?? undefined,
    target_id: input.targetId ?? undefined,
    target_selector: input.targetSelector ?? undefined,
    target_source_file: input.targetSourceFile ?? undefined,
    block_detail: gsapBlockDetail(input.error),
  };
}

const isNamed = (name: string) => (error: unknown) => error instanceof Error && error.name === name;
const ERROR_KEYS: ReadonlyArray<readonly [string, (error: unknown) => boolean]> = [
  ["conflict", (error) => findCause(error, StudioFileConflictError) !== null],
  ["held", (error) => findCause(error, StudioSaveHttpError)?.heldFile === true],
  ["http", (error) => findCause(error, StudioSaveHttpError) !== null],
  ["network", (error) => findCause(error, StudioSaveNetworkError) !== null],
  ["aborted", isNamed("AbortError")],
  ["blocked", isNamed("GsapEditBlockedError")],
];

export function studioSaveErrorCodes(error: unknown): Record<string, StudioTelemetryValue> {
  const failure = error instanceof Error ? error : null;
  const http = findCause(error, StudioSaveHttpError);
  const errorKey = ERROR_KEYS.find(([, matches]) => matches(error))?.[0] ?? "unknown";
  return {
    error_class: failure?.name ?? typeof error,
    error_key: errorKey,
    server_why: http ? (http.why ?? "other") : undefined,
    block_reason: blockReason(error),
  };
}

function findCause<T extends Error>(error: unknown, type: new (...args: never[]) => T): T | null {
  for (let at = error, depth = 0; at && typeof at === "object" && depth < 5; depth++) {
    if (at instanceof type) return at;
    at = (at as { cause?: unknown }).cause;
  }
  return null;
}

function blockReason(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== "GsapEditBlockedError") return undefined;
  const reason = (error as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * The specific cause behind a blocked GSAP edit: one block reason covers six
 * different situations, so the reason alone cannot say which one a user hit.
 */
function gsapBlockDetail(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== "GsapEditBlockedError") return undefined;
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : undefined;
}

export function trackStudioSaveFailure(input: StudioSaveFailureInput): void {
  trackStudioEvent("save_failure", buildStudioSaveFailureProperties(input));
}

export function trackStudioEditBlocked(input: StudioSaveFailureInput): void {
  trackStudioEvent("edit_blocked", buildStudioSaveFailureProperties(input));
}

const HELD_FILE_WORDS = {
  busy: (file: string) => `${file} is open in another program. Close it there, then try again.`,
  permission: (file: string) =>
    `${file} can't be changed: it is read-only or protected. Check its permissions, then try again.`,
} as const;

function heldFileMessage(body: string, path: string | undefined): string | null {
  if (!path) return null;
  try {
    const why: unknown = (JSON.parse(body) as { why?: unknown }).why;
    if (why !== "busy" && why !== "permission") return null;
    return HELD_FILE_WORDS[why](path.split(/[\\/]/).pop() ?? path);
  } catch {
    return null;
  }
}

export const withStatus = (words: string, response: Response) => `${words} (${response.status})`;

export async function heldFileWordsOf(response: Response, path: string): Promise<string | null> {
  return heldFileMessage(
    await response
      .clone()
      .text()
      .catch(() => ""),
    path,
  );
}

export async function createStudioSaveHttpError(
  response: Response,
  fallbackMessage: string,
  options: { alreadyToasted?: boolean; path?: string } = {},
): Promise<StudioSaveHttpError> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const detail = body.trim().slice(0, 300);
  const held = heldFileMessage(body, options.path);
  const why = serverWhy(body);
  const message =
    held ??
    (detail
      ? `${fallbackMessage} (${response.status}): ${detail}`
      : `${fallbackMessage} (${response.status})`);
  return new StudioSaveHttpError(message, response.status, {
    ...options,
    heldFile: held !== null,
    why,
  });
}

function serverWhy(body: string): string | null {
  try {
    const why: unknown = (JSON.parse(body) as { why?: unknown }).why;
    return typeof why === "string" && SERVER_WHY.has(why) ? why : null;
  } catch {
    return null;
  }
}

export const heldFileWords = (error: unknown): string | null =>
  error instanceof StudioSaveHttpError && error.heldFile ? error.message : null;

export async function retryStudioSave<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterRatio?: number;
    random?: () => number;
    signal?: AbortSignal;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const jitterRatio = options.jitterRatio ?? 0.25;
  const random = options.random ?? Math.random;
  const shouldRetry = options.shouldRetry ?? isRetryableStudioSaveError;
  const sleep =
    options.sleep ??
    ((delayMs: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        throwIfStudioSaveAborted(signal);
        const onAbort = () => {
          globalThis.clearTimeout(timeout);
          reject(createStudioSaveAbortError());
        };
        const timeout = globalThis.setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        signal?.addEventListener("abort", onAbort, { once: true });
      }));
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      throwIfStudioSaveAborted(options.signal);
      return await operation(attempt);
    } catch (error) {
      const failure = attachStudioSaveAttempt(error, attempt);
      if (attempt >= maxAttempts || !shouldRetry(failure, attempt)) throw failure;
      const retryIndex = attempt - 1;
      const exponentialDelay = Math.min(baseDelayMs * 2 ** retryIndex, maxDelayMs);
      const jitterSpan = exponentialDelay * jitterRatio;
      const jitteredDelay = Math.round(exponentialDelay + (random() * 2 - 1) * jitterSpan);
      const delayMs = Math.max(0, Math.min(maxDelayMs, jitteredDelay));
      await sleep(delayMs, options.signal);
    }
  }

  throw new Error("Save retry loop exited unexpectedly");
}
