/**
 * Poll a HyperFrames render until it reaches a terminal state.
 *
 * Defaults: 10s interval, 60min cap — confirmed with the API owner. The
 * `start_to_close` timeout on the underlying Temporal workflow is the
 * same order of magnitude, so polling longer would only hide a stuck
 * workflow rather than recover from one.
 *
 * Spinner output is silenced when stdout isn't a TTY (CI, piped output)
 * so the JSON-emitting modes upstream don't get garbled.
 */

import type { HyperframesCloudClient } from "./_gen/client.js";
import type { HyperframesRenderDetail, HyperframesRenderStatus } from "./_gen/types.js";

export interface PollOptions {
  intervalMs?: number;
  maxWaitMs?: number;
  /** Called once per tick with the latest render state. */
  onTick?: (detail: HyperframesRenderDetail, elapsedMs: number) => void;
  /** Inject a clock for tests. */
  now?: () => number;
  /** Inject a sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_MAX_WAIT_MS = 60 * 60 * 1000;

const TERMINAL_STATUSES: ReadonlySet<HyperframesRenderStatus> = new Set(["completed", "failed"]);

export class PollTimeoutError extends Error {
  readonly lastDetail: HyperframesRenderDetail;
  constructor(lastDetail: HyperframesRenderDetail, elapsedMs: number) {
    super(
      `Render ${lastDetail.render_id} did not reach a terminal state within ${Math.round(elapsedMs / 1000)}s`,
    );
    this.name = "PollTimeoutError";
    this.lastDetail = lastDetail;
  }
}

export function isTerminal(status: HyperframesRenderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Poll `GET /v3/hyperframes/renders/{id}` until status is `completed` or
 * `failed`, or `maxWaitMs` elapses (in which case throws
 * {@link PollTimeoutError}). Errors from the underlying request bubble
 * up immediately — they are not retried, because every error class the
 * API can return at this stage (404, 401, 5xx) is unlikely to recover
 * on a retry inside the poll window.
 */
export async function pollUntilTerminal(
  client: HyperframesCloudClient,
  renderId: string,
  options: PollOptions = {},
): Promise<HyperframesRenderDetail> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = options.now ?? (() => Date.now());
  // Default sleep honors the abort signal so Ctrl+C feels immediate
  // instead of waiting out the full interval. Tests inject a no-op
  // sleep that ignores the signal — that's fine, they don't abort.
  const sleep = options.sleep ?? defaultAbortableSleep(options.signal);

  const started = now();

  while (true) {
    if (options.signal?.aborted) {
      throw signalAbortError(options.signal);
    }
    const detail = await client.getRender({ render_id: renderId, signal: options.signal });
    const elapsed = now() - started;
    options.onTick?.(detail, elapsed);

    if (isTerminal(detail.status)) {
      return detail;
    }
    if (elapsed >= maxWaitMs) {
      throw new PollTimeoutError(detail, elapsed);
    }
    await sleep(intervalMs);
  }
}

function signalAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error("Poll aborted");
}

function defaultAbortableSleep(signal?: AbortSignal): (ms: number) => Promise<void> {
  // fallow-ignore-next-line complexity
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signalAbortError(signal!));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
}
