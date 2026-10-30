import type { CDPSession } from "puppeteer-core";

const PROBE_EVERY_MS = 4_000;
const PROBE_TIMEOUT_MS = 8_000;
const MISSES = 2;

/**
 * Software GL can starve a page after it loaded, so each of the capture's evaluates then waits out the protocol
 * timeout. Probe the page from outside; two probes in a row that go unanswered call `onStall` once. An error still
 * counts as an answer: only a silent page is stalled.
 */
export function watchWebglStall(
  cdp: CDPSession,
  onStall: () => void,
  timing = { everyMs: PROBE_EVERY_MS, timeoutMs: PROBE_TIMEOUT_MS },
): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let misses = 0;
  const probe = async () => {
    const answered = await Promise.race([
      cdp.send("Runtime.evaluate", { expression: "1" }).then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timing.timeoutMs).unref()),
    ]);
    if (stopped) return;
    misses = answered ? 0 : misses + 1;
    if (misses >= MISSES) return onStall();
    timer = setTimeout(probe, timing.everyMs);
    timer.unref();
  };
  timer = setTimeout(probe, timing.everyMs);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
