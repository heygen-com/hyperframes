export interface CaptureWatchdogBrowser {
  close(): Promise<void>;
}

export interface CaptureWatchdog {
  readonly expired: () => boolean;
  readonly promise: Promise<void>;
  readonly registerBrowser: (browser: CaptureWatchdogBrowser) => void;
  readonly unregisterBrowser: (browser: CaptureWatchdogBrowser) => void;
  readonly dispose: () => void;
}

export type CaptureAttempt<T> =
  | { kind: "complete"; result: T }
  | { kind: "error"; error: unknown }
  | { kind: "deadline" };

export async function runWithWatchdog<T>(
  work: Promise<T>,
  deadline: Promise<void>,
): Promise<CaptureAttempt<T>> {
  const observedWork = work.then(
    (result): CaptureAttempt<T> => ({ kind: "complete", result }),
    (error): CaptureAttempt<T> => ({ kind: "error", error }),
  );
  return await Promise.race([
    observedWork,
    deadline.then((): CaptureAttempt<T> => ({ kind: "deadline" })),
  ]);
}

export function createCaptureWatchdog(deadlineMs: number | undefined): CaptureWatchdog {
  let browser: CaptureWatchdogBrowser | undefined;
  let didExpire = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveDeadline: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });

  if (deadlineMs !== undefined) {
    timer = setTimeout(() => {
      didExpire = true;
      resolveDeadline();
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
