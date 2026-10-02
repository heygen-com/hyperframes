import type { ProcessRssSample } from "../utils/processRss.js";

/**
 * Chrome process memory observed during one capture session. Peaks are
 * per-process-type maxima across samples; `rssLastMb` is the whole tree at
 * the most recent successful sample. Surfaced on render_error /
 * render_complete so the long-render "Target closed" class (spec §2.5) can be
 * correlated with memory instead of guessed at.
 */
export interface ChromeMemoryStats {
  browserRssPeakMb?: number;
  rendererRssPeakMb?: number;
  rssLastMb?: number;
  gpuProcessSeenLastSample?: boolean;
  samples: number;
}

export interface ChromePids {
  browser?: number;
  renderers: number[];
  gpu: number[];
}

/**
 * Timer seams, typed to the two-argument shape the sampler uses rather than
 * `typeof setInterval`: with the DOM lib in scope that type also carries the
 * `(handler, timeout) => number` overload, so a test could only satisfy it
 * with a cast. The globals are assignable to these narrower shapes.
 */
type SetIntervalFn = (callback: () => void, ms: number) => NodeJS.Timeout;
type ClearIntervalFn = (timer: NodeJS.Timeout) => void;

export interface ChromeMemorySamplerDeps {
  getPids: () => Promise<ChromePids>;
  sampleRss: (pids: readonly number[]) => Promise<ProcessRssSample[]>;
  intervalMs: number;
  onSample?: (stats: ChromeMemoryStats) => void;
  /** Test seam; defaults to the global setInterval. */
  setIntervalFn?: SetIntervalFn;
  /** Test seam; defaults to the global clearInterval. */
  clearIntervalFn?: ClearIntervalFn;
}

export interface ChromeMemorySampler {
  start(): void;
  stop(): void;
  stats(): ChromeMemoryStats;
  /**
   * One sample, awaited by the caller; used by tests and by close(). If a
   * sample is already in flight this resolves when that sample finishes
   * instead of starting another, so `stop(); await sampleOnce()` always sees
   * the running tick's result and `onSample` cannot fire after it resolves.
   */
  sampleOnce(): Promise<void>;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Pure merge of one sample into the running stats. Empty `rss` → unchanged. */
export function mergeSample(
  prev: ChromeMemoryStats,
  pids: ChromePids,
  rss: readonly ProcessRssSample[],
): ChromeMemoryStats {
  if (rss.length === 0) return prev;
  const byPid = new Map(rss.map((s) => [s.pid, s.rssMb]));
  const browserMb = pids.browser === undefined ? undefined : byPid.get(pids.browser);
  const rendererMbs = pids.renderers
    .map((p) => byPid.get(p))
    .filter((v): v is number => v !== undefined);
  const gpuMbs = pids.gpu.map((p) => byPid.get(p)).filter((v): v is number => v !== undefined);
  const rendererMax = rendererMbs.length > 0 ? Math.max(...rendererMbs) : undefined;
  const total = rss.reduce((sum, s) => sum + s.rssMb, 0);
  return {
    browserRssPeakMb: maxDefined(prev.browserRssPeakMb, browserMb),
    rendererRssPeakMb: maxDefined(prev.rendererRssPeakMb, rendererMax),
    rssLastMb: total,
    gpuProcessSeenLastSample: gpuMbs.length > 0,
    samples: prev.samples + 1,
  };
}

export function createChromeMemorySampler(deps: ChromeMemorySamplerDeps): ChromeMemorySampler {
  const setIntervalFn: SetIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn: ClearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  let stats: ChromeMemoryStats = { samples: 0 };
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  const runSample = async (): Promise<void> => {
    try {
      const pids = await deps.getPids();
      const all = [pids.browser, ...pids.renderers, ...pids.gpu].filter(
        (p): p is number => typeof p === "number",
      );
      const rss = await deps.sampleRss(all);
      const next = mergeSample(stats, pids, rss);
      if (next !== stats) {
        stats = next;
        deps.onSample?.(stats);
      }
    } catch {
      // Sampling is observability only; a CDP or ps failure must never reach
      // the capture loop. The next tick retries.
    }
  };

  const sampleOnce = (): Promise<void> => {
    // Reentrancy guard: an interval tick that lands while a sample is still
    // running joins it rather than stacking a second CDP/ps round-trip, and a
    // close-time call waits for the running tick instead of skipping it.
    // runSample never rejects, so the .finally reset always runs; it runs on
    // a microtask, after the assignment below.
    if (inFlight !== null) return inFlight;
    inFlight = runSample().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    start() {
      if (timer !== null) return;
      // Node's Timeout has unref(); the engine already relies on it
      // (utils/processTracker.ts). Keeps the interval from holding the
      // process open if a caller forgets stop().
      timer = setIntervalFn(() => {
        void sampleOnce();
      }, deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
    stats: () => stats,
    sampleOnce,
  };
}
