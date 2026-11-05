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

const DEADLINE_UNDER_AGENT_SHELL_LIMITS_MS = 4 * 60_000;

export function createCaptureWatchdog(
  deadlineMs: number = DEADLINE_UNDER_AGENT_SHELL_LIMITS_MS,
): CaptureWatchdog {
  let browser: CaptureWatchdogBrowser | undefined;
  let didExpire = false;
  let resolveDeadline: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });

  let deadlineFromFirstBrowser: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    didExpire = true;
    resolveDeadline();
    void browser?.close().catch(() => undefined);
  };

  return {
    expired: () => didExpire,
    promise,
    registerBrowser: (nextBrowser) => {
      browser = nextBrowser;
      deadlineFromFirstBrowser ??= setTimeout(expire, deadlineMs);
      if (didExpire) void browser.close().catch(() => undefined);
    },
    unregisterBrowser: (closedBrowser) => {
      if (browser === closedBrowser) browser = undefined;
    },
    dispose: () => {
      clearTimeout(deadlineFromFirstBrowser);
    },
  };
}

export function parseCaptureDeadline(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
