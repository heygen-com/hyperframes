export function captureProtocolTimeoutMs(navTimeoutMs: number, postNavBudgetMs: number): number {
  const nav = Number.isFinite(navTimeoutMs) ? Math.max(0, navTimeoutMs) : 0;
  const budget = Number.isFinite(postNavBudgetMs) ? Math.max(0, postNavBudgetMs) : 0;
  return Math.max(60_000, nav, budget);
}

export function isProtocolEvaluateTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Runtime\.evaluate timed out|protocolTimeout|protocol timeout/i.test(msg);
}

function isNavigationTimeoutErrorMessage(errMsg: string): boolean {
  return /navigation timeout/i.test(errMsg);
}

export function formatCaptureFailureReason(errMsg: string): string {
  if (isProtocolEvaluateTimeoutError(errMsg)) {
    return (
      `Page extraction timed out while running in-page script (${errMsg}). ` +
      "The page likely opened, but a later capture step hung."
    );
  }
  if (isNavigationTimeoutErrorMessage(errMsg)) {
    return "Page navigation timed out — the site may be blocking headless browsers or requires authentication.";
  }
  if (/timeout|timed out/i.test(errMsg)) {
    return `Capture timed out: ${errMsg}`;
  }
  return `Capture failed: ${errMsg}`;
}
