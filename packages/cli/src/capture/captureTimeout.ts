import { TimeoutError } from "puppeteer-core";

export const PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS = 180_000;

export class StageBudgetTimeoutError extends Error {
  readonly budgetMs: number;

  constructor(label: string, budgetMs: number) {
    super(`stage budget exceeded while ${label} (${budgetMs}ms)`);
    this.name = "StageBudgetTimeoutError";
    this.budgetMs = budgetMs;
  }
}

export function captureProtocolTimeoutMs(navTimeoutMs: number, postNavBudgetMs: number): number {
  if (!Number.isFinite(navTimeoutMs) || !Number.isFinite(postNavBudgetMs)) {
    return PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS;
  }
  return Math.max(60_000, Math.max(0, navTimeoutMs), Math.max(0, postNavBudgetMs));
}

export function isNavigationTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /navigation timeout/i.test(msg);
}

function isStageBudgetTimeoutError(err: unknown): boolean {
  return err instanceof StageBudgetTimeoutError;
}

export function isProtocolEvaluateTimeoutError(err: unknown): boolean {
  if (isNavigationTimeoutError(err)) {
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof TimeoutError) {
    return /Runtime\.evaluate timed out|protocolTimeout|protocol timeout/i.test(msg);
  }
  return /Runtime\.evaluate timed out|protocolTimeout|protocol timeout/i.test(msg);
}

export function isDegradableEvaluateTimeoutError(err: unknown): boolean {
  return isStageBudgetTimeoutError(err) || isProtocolEvaluateTimeoutError(err);
}

export async function withRemainingBudget<T>(
  work: Promise<T>,
  remainingMs: number,
  label: string,
): Promise<T> {
  if (!(remainingMs > 0)) {
    throw new StageBudgetTimeoutError(label, Math.max(0, remainingMs));
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new StageBudgetTimeoutError(label, remainingMs));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function formatCaptureFailureReason(errMsg: string): string {
  if (isProtocolEvaluateTimeoutError(errMsg) || /stage budget exceeded/i.test(errMsg)) {
    return (
      `Page extraction timed out while running in-page script (${errMsg}). ` +
      "The page likely opened, but a later capture step hung."
    );
  }
  if (isNavigationTimeoutError(errMsg)) {
    return "Page navigation timed out — the site may be blocking headless browsers or requires authentication.";
  }
  if (/timeout|timed out/i.test(errMsg)) {
    return `Capture timed out: ${errMsg}`;
  }
  return `Capture failed: ${errMsg}`;
}
