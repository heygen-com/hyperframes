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

export class StudioSaveHttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "StudioSaveHttpError";
    this.statusCode = statusCode;
  }
}

export class StudioSaveNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioSaveNetworkError";
  }
}

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

export function getStudioSaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown save failure";
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
    error_message: getStudioSaveErrorMessage(input.error),
    status_code: statusCode,
    file_path: input.filePath ?? input.targetSourceFile ?? undefined,
    mutation_type: input.mutationType ?? undefined,
    attempt,
    label: input.label ?? undefined,
    target_id: input.targetId ?? undefined,
    target_selector: input.targetSelector ?? undefined,
    target_source_file: input.targetSourceFile ?? undefined,
  };
}

export function trackStudioSaveFailure(input: StudioSaveFailureInput): void {
  trackStudioEvent("save_failure", buildStudioSaveFailureProperties(input));
}

export async function createStudioSaveHttpError(
  response: Response,
  fallbackMessage: string,
): Promise<StudioSaveHttpError> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const detail = body.trim().slice(0, 300);
  const message = detail
    ? `${fallbackMessage} (${response.status}): ${detail}`
    : `${fallbackMessage} (${response.status})`;
  return new StudioSaveHttpError(message, response.status);
}

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
