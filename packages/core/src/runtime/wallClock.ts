// During a render the page's setTimeout and setInterval run on film time and fire only at the next seek.
// The runtime's own waits and deadlines must not depend on that seek, so they use the browser's timers.
type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;

interface VirtualTimeTimers {
  originalSetTimeout?: typeof setTimeout;
  originalClearTimeout?: typeof clearTimeout;
  originalSetInterval?: typeof setInterval;
  originalClearInterval?: typeof clearInterval;
}

const shim = (): VirtualTimeTimers | undefined =>
  (globalThis as { __HF_VIRTUAL_TIME__?: VirtualTimeTimers }).__HF_VIRTUAL_TIME__;

type Handler = (...args: never[]) => void;

export function wallSetTimeout(handler: Handler, timeout?: number, ...args: unknown[]): TimeoutId {
  return (shim()?.originalSetTimeout ?? setTimeout)(
    handler as (...a: unknown[]) => void,
    timeout,
    ...args,
  );
}

export function wallClearTimeout(id: TimeoutId | null | undefined): void {
  (shim()?.originalClearTimeout ?? clearTimeout)(id ?? undefined);
}

export function wallSetInterval(
  handler: Handler,
  timeout?: number,
  ...args: unknown[]
): IntervalId {
  return (shim()?.originalSetInterval ?? setInterval)(
    handler as (...a: unknown[]) => void,
    timeout,
    ...args,
  );
}

export function wallClearInterval(id: IntervalId | null | undefined): void {
  (shim()?.originalClearInterval ?? clearInterval)(id ?? undefined);
}
