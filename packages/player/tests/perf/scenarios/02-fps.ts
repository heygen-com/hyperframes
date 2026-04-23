/**
 * Scenario 02: sustained playback against the composition clock.
 *
 * Loads the 10-video-grid fixture, calls `player.play()`, then samples
 * `__player.getTime()` at fixed wall-clock intervals for ~5 seconds. The
 * emitted metric is the ratio of composition-time advanced to wall-clock
 * elapsed:
 *
 *   composition_time_advancement_ratio = (getTime(end) - getTime(start)) / wallSeconds
 *
 * This reads ~1.0 when the runtime is keeping up with its intended playback
 * speed and falls below 1.0 when the player stalls — a slow video decoder, a
 * blocked main thread, a GC pause, anything that prevents the composition
 * clock from advancing at real-time. The metric is independent of the host
 * display refresh rate by construction: both numerator and denominator are
 * wall-clock timestamps, neither is a frame count, so a 60Hz, 120Hz, or 240Hz
 * runner sees the same value for a healthy player.
 *
 * Why we replaced the previous rAF-based FPS metric:
 *   The original implementation counted `requestAnimationFrame` ticks per
 *   wall-clock second and asserted `fps >= 55`. On a 120Hz CI runner that
 *   reads ~120 fps regardless of whether the composition is actually
 *   advancing, so the gate passed even when the player was silently stalling.
 *   See PR #400 review (jrusso1020 + miguel-heygen) for the full discussion;
 *   this implementation follows jrusso1020's "first choice" recommendation.
 *
 * Per the proposal:
 *   Test 1: Playback frame rate (player-perf-fps)
 *     Load 10-video composition → play 5s → measure how well the player kept
 *     up with the composition clock.
 *
 * Methodology details:
 *   - We install the wall-clock sampler before calling `play()` so the very
 *     first post-play tick is captured. We then wait for `__player.isPlaying()`
 *     to flip true (the parent→iframe `play` message is async via postMessage)
 *     and *reset* the sample buffer, so the measurement window only contains
 *     samples taken while the runtime was actively playing the timeline.
 *   - Sampling cadence is 100ms (10 samples/sec). That's fine-grained enough
 *     to spot a half-second stall but coarse enough that the sampler itself
 *     has negligible overhead. With a 5s window we collect ~50 samples; the
 *     ratio is computed from the first and last sample's `getTime()` values.
 *   - We use `setInterval` (not rAF) on purpose: rAF cadence is the metric we
 *     are trying to *avoid* depending on. `setInterval` is wall-clock-driven.
 *
 * Outputs one metric:
 *   - composition_time_advancement_ratio_min
 *     (higher-is-better, baseline key compositionTimeAdvancementRatioMin)
 *
 * Aggregation: `min(ratio)` across runs because the proposal asserts a floor
 * — the worst run is the one that gates against regressions.
 */

import type { Browser, Frame, Page } from "puppeteer-core";
import { loadHostPage } from "../runner.ts";
import type { Metric } from "../perf-gate.ts";

export type FpsScenarioOpts = {
  browser: Browser;
  origin: string;
  /** Number of measurement runs. */
  runs: number;
  /** If null, runs the default fixture (10-video-grid). */
  fixture: string | null;
};

const DEFAULT_FIXTURE = "10-video-grid";
const PLAYBACK_DURATION_MS = 5_000;
const SAMPLE_INTERVAL_MS = 100;
const PLAY_CONFIRM_TIMEOUT_MS = 5_000;
const FRAME_LOOKUP_TIMEOUT_MS = 5_000;

declare global {
  interface Window {
    /** (wallClockMs, compositionTimeSec) pairs collected by the sampler. */
    __perfPlaySamples?: Array<{ wall: number; comp: number }>;
    /** setInterval handle used by the sampler; cleared at the end of the window. */
    __perfPlaySamplerHandle?: number;
    /** Hyperframes runtime player API exposed inside the composition iframe. */
    __player?: {
      play: () => void;
      pause: () => void;
      seek: (timeSeconds: number) => void;
      getTime: () => number;
      getDuration: () => number;
      isPlaying: () => boolean;
    };
  }
}

type RunResult = {
  ratio: number;
  compElapsedSec: number;
  wallElapsedSec: number;
  samples: number;
};

/**
 * Find the iframe Puppeteer Frame that hosts the fixture composition. The
 * `<hyperframes-player>` shell wraps an iframe whose URL is derived from the
 * player's `src` attribute, so we match by path substring rather than full URL.
 */
async function getFixtureFrame(page: Page, fixture: string): Promise<Frame> {
  const expected = `/fixtures/${fixture}/`;
  const deadline = Date.now() + FRAME_LOOKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes(expected));
    if (frame) return frame;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`[scenario:fps] fixture frame not found for "${fixture}" within timeout`);
}

async function runOnce(
  opts: FpsScenarioOpts,
  fixture: string,
  idx: number,
  total: number,
): Promise<RunResult> {
  const ctx = await opts.browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    const { duration } = await loadHostPage(page, opts.origin, { fixture });
    const frame = await getFixtureFrame(page, fixture);

    // Install the wall-clock sampler in the iframe context. We use setInterval
    // because rAF cadence is exactly the host-display-dependent signal we are
    // trying NOT to depend on; setInterval is driven by the event loop and
    // gives us samples at fixed wall-clock cadence regardless of refresh rate.
    await frame.evaluate((sampleIntervalMs: number) => {
      window.__perfPlaySamples = [];
      window.__perfPlaySamplerHandle = window.setInterval(() => {
        const comp = window.__player?.getTime?.();
        if (typeof comp !== "number" || !Number.isFinite(comp)) return;
        window.__perfPlaySamples!.push({
          wall: performance.timeOrigin + performance.now(),
          comp,
        });
      }, sampleIntervalMs);
    }, SAMPLE_INTERVAL_MS);

    // Issue play from the host page (parent of the iframe). The player's
    // public `play()` posts a control message into the iframe.
    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { play: () => void }) | null;
      if (!el) throw new Error("[scenario:fps] player element missing on host page");
      el.play();
    });

    // Wait for the runtime to actually transition to playing — this is the
    // signal that the postMessage round trip + timeline.play() finished.
    await frame.waitForFunction(() => window.__player?.isPlaying?.() === true, {
      timeout: PLAY_CONFIRM_TIMEOUT_MS,
    });

    // Reset samples now that playback is confirmed running. Anything captured
    // before this point belongs to the ramp-up window (composition clock at
    // 0, wall clock advancing) and would skew the ratio toward 0.
    await frame.evaluate(() => {
      window.__perfPlaySamples = [];
    });

    // Sustain playback for the measurement window.
    await new Promise((r) => setTimeout(r, PLAYBACK_DURATION_MS));

    // Stop the sampler and harvest the samples before pausing the runtime,
    // so the pause command can't perturb the tail of the sample window.
    const samples = (await frame.evaluate(() => {
      if (window.__perfPlaySamplerHandle !== undefined) {
        clearInterval(window.__perfPlaySamplerHandle);
        window.__perfPlaySamplerHandle = undefined;
      }
      return window.__perfPlaySamples ?? [];
    })) as Array<{ wall: number; comp: number }>;

    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { pause: () => void }) | null;
      el?.pause();
    });

    if (samples.length < 2) {
      throw new Error(
        `[scenario:fps] run ${idx + 1}/${total}: only ${samples.length} composition-clock samples captured (composition duration ${duration}s)`,
      );
    }

    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const wallElapsedSec = (last.wall - first.wall) / 1000;
    const compElapsedSec = last.comp - first.comp;
    const ratio = wallElapsedSec > 0 ? compElapsedSec / wallElapsedSec : 0;

    console.log(
      `[scenario:fps] run[${idx + 1}/${total}] ratio=${ratio.toFixed(4)} compElapsed=${compElapsedSec.toFixed(3)}s wallElapsed=${wallElapsedSec.toFixed(3)}s samples=${samples.length}`,
    );

    await page.close();
    return {
      ratio,
      compElapsedSec,
      wallElapsedSec,
      samples: samples.length,
    };
  } finally {
    await ctx.close();
  }
}

export async function runFps(opts: FpsScenarioOpts): Promise<Metric[]> {
  const fixture = opts.fixture ?? DEFAULT_FIXTURE;
  const runs = Math.max(1, opts.runs);
  console.log(
    `[scenario:fps] fixture=${fixture} runs=${runs} window=${PLAYBACK_DURATION_MS}ms sampleInterval=${SAMPLE_INTERVAL_MS}ms`,
  );

  const ratios: number[] = [];
  for (let i = 0; i < runs; i++) {
    const result = await runOnce(opts, fixture, i, runs);
    ratios.push(result.ratio);
  }

  // Worst run wins: the proposal asserts a floor on this ratio, so a single
  // bad run (slow decoder, GC pause, host contention) is the one that gates.
  const ratioMin = Math.min(...ratios);
  console.log(`[scenario:fps] aggregate min ratio=${ratioMin.toFixed(4)} runs=${runs}`);

  return [
    {
      name: "composition_time_advancement_ratio_min",
      baselineKey: "compositionTimeAdvancementRatioMin",
      value: ratioMin,
      unit: "ratio",
      direction: "higher-is-better",
      samples: ratios,
    },
  ];
}
