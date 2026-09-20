export class CaptureDeadlineTimeoutError extends Error {
  readonly retryable = false;
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`capture deadline exceeded (${deadlineMs}ms)`);
    this.name = "CaptureDeadlineTimeoutError";
    this.deadlineMs = deadlineMs;
  }
}

export interface CaptureWatchdogBrowser {
  close(): Promise<void>;
}

export interface CaptureWatchdog {
  readonly expired: () => boolean;
  readonly promise: Promise<never>;
  readonly registerBrowser: (browser: CaptureWatchdogBrowser) => void;
  readonly unregisterBrowser: (browser: CaptureWatchdogBrowser) => void;
  readonly dispose: () => void;
}

export function createCaptureWatchdog(deadlineMs: number | undefined): CaptureWatchdog {
  let browser: CaptureWatchdogBrowser | undefined;
  let didExpire = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: (error: CaptureDeadlineTimeoutError) => void = () => {};

  const promise = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });

  if (deadlineMs !== undefined) {
    timer = setTimeout(() => {
      didExpire = true;
      rejectDeadline(new CaptureDeadlineTimeoutError(deadlineMs));
      void browser?.close().catch(() => undefined);
    }, deadlineMs);
  }

  return {
    expired: () => didExpire,
    promise,
    registerBrowser: (nextBrowser) => {
      browser = nextBrowser;
      if (didExpire) void browser.close().catch(() => undefined);
    },
    unregisterBrowser: (closedBrowser) => {
      if (browser === closedBrowser) browser = undefined;
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export function parseCaptureDeadline(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
