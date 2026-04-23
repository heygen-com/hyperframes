/**
 * Scenario 04: scrub latency.
 *
 * Loads the 10-video-grid fixture, pauses the player, then issues 10 seek
 * calls in sequence — first through the synchronous "inline" path, then
 * through the postMessage-driven "isolated" path — and measures the wall-clock
 * latency from each `seek()` call to the first paint where the iframe's
 * timeline reports the new time.
 *
 * Per the proposal:
 *   Test 2: Scrub latency (player-perf-scrub)
 *     Load composition → seek to 10 positions in sequence → measure time
 *     from seek() call to state update callback
 *     Assert: p95 < 80ms (isolated), p95 < 33ms (inline, Phase 4+)
 *
 * Methodology details:
 *   - Both modes are measured in the same page load. Inline runs first so
 *     the isolated mode's monkey-patch (forcing `_trySyncSeek` to return
 *     false) doesn't bleed into the inline samples.
 *   - "Inline" mode is the default behavior of `<hyperframes-player>` when the
 *     iframe is same-origin and exposes `__player.seek()` synchronously.
 *     `seek()` lands the new frame in the same task as the input event.
 *   - "Isolated" mode is forced by replacing the player element's
 *     `_trySyncSeek` method with `() => false`, which sends the player
 *     element through the postMessage bridge — exactly what cross-origin
 *     embeds and Phase 1 (pre-sync) builds did.
 *   - Detection is via a `requestAnimationFrame` watcher inside the iframe
 *     that polls `__player.getTime()` until it is within `MATCH_TOLERANCE_S`
 *     of the requested target. We use a tolerance because the postMessage
 *     bridge converts seconds → frame number → seconds, which can introduce
 *     sub-frame quantization drift even for targets on the canonical fps grid.
 *   - Timing uses `performance.timeOrigin + performance.now()` in both the
 *     host and iframe contexts. `timeOrigin` is consistent across same-process
 *     frames, so the difference is a true wall-clock measurement of latency.
 *   - Seek targets alternate forward/backward across the 10s composition so
 *     no two consecutive seeks land near each other; this avoids the rAF
 *     watcher matching against a stale `getTime()` value before the seek
 *     command is processed.
 *
 * Outputs two metrics:
 *   - scrub_latency_p95_inline_ms     (lower-is-better, baseline scrubLatencyP95InlineMs)
 *   - scrub_latency_p95_isolated_ms   (lower-is-better, baseline scrubLatencyP95IsolatedMs)
 *
 * Aggregation: percentile(95) is computed across the pooled per-seek
 * latencies from every run. With 10 seeks per mode per run × 3 runs we get
 * 30 samples per mode per CI shard, which is enough for a stable p95.
 */

import type { Browser, Frame, Page } from "puppeteer-core";
import { loadHostPage, percentile } from "../runner.ts";
import type { Metric } from "../perf-gate.ts";

export type ScrubScenarioOpts = {
  browser: Browser;
  origin: string;
  /** Number of measurement runs. */
  runs: number;
  /** If null, runs the default fixture (10-video-grid). */
  fixture: string | null;
};

const DEFAULT_FIXTURE = "10-video-grid";
/** Targets are seconds within the composition (10s duration). */
const SEEK_TARGETS: readonly number[] = [1.0, 7.0, 2.0, 8.0, 3.0, 9.0, 4.0, 6.0, 5.0, 0.5];
/**
 * Tolerance window the rAF watcher uses to decide that the iframe's reported
 * `__player.getTime()` matches the requested seek target. 50ms = 1.5 frames at
 * 30fps, which absorbs three sources of expected slippage:
 *
 *   1. **Frame quantization on the postMessage path.** `_sendControl("seek")`
 *      converts seconds → integer frame number → seconds inside the runtime,
 *      so e.g. a target of 1.0s on a 30fps composition lands at frame 30 →
 *      1.000s exactly, but a target of 1.005s lands at frame 30 → still
 *      1.000s, a 5ms quantization error baked into the API itself.
 *   2. **Sub-frame intra-clip clock advance.** Even with the iframe paused,
 *      between the `seek()` call landing and the next rAF tick, the runtime
 *      may have already nudged time by a fraction of a frame as part of
 *      finalizing the seek; `getTime()` reports the post-finalize value.
 *   3. **Variable host load + browser jitter on CI.** GitHub runners share
 *      cores, so a noisy neighbor can delay the rAF tick that would otherwise
 *      register the match by tens of ms. Picking a tolerance much tighter
 *      than this would gate against runner contention rather than player
 *      regressions.
 *
 * The metric this scenario asserts is *latency to user-visible match*, not
 * *exact equality of the reported time*, so a 50ms acceptance window is the
 * intended behavior — but if we ever want to tighten this (e.g. to assert
 * sub-frame precision on the inline path now that PR #397 documented it),
 * this is the knob to turn. Configurability is deliberately deferred until
 * we have a concrete second use case; YAGNI.
 *
 * TODO(player-perf): revisit this constant after P0-1b lands and we have ~2
 * weeks of CI baseline data — if the inline-mode samples consistently cluster
 * well below 50ms, drop this to e.g. 16ms (1 frame @ 60fps) and split the
 * tolerance per mode (tighter for inline, current for isolated).
 */
const MATCH_TOLERANCE_S = 0.05;
/** Per-seek timeout; isolated p95 in the proposal is 80ms, so 1s is huge headroom. */
const SEEK_TIMEOUT_MS = 1_000;
const PAUSE_CONFIRM_TIMEOUT_MS = 5_000;
const FRAME_LOOKUP_TIMEOUT_MS = 5_000;

declare global {
  interface Window {
    /** Promise resolved by the iframe rAF watcher with the wall-clock t1 of the matching paint. */
    __perfScrubAwait?: Promise<number>;
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

type Mode = "inline" | "isolated";

type RunResult = {
  inlineLatencies: number[];
  isolatedLatencies: number[];
};

/**
 * Find the iframe Puppeteer Frame that hosts the fixture composition. Same
 * helper as 02-fps.ts; duplicated locally so each scenario file is
 * self-contained.
 */
async function getFixtureFrame(page: Page, fixture: string): Promise<Frame> {
  const expected = `/fixtures/${fixture}/`;
  const deadline = Date.now() + FRAME_LOOKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes(expected));
    if (frame) return frame;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`[scenario:scrub] fixture frame not found for "${fixture}" within timeout`);
}

/**
 * Measure a single seek's latency.
 *
 * Sequence:
 *   1. Install a rAF watcher in the iframe that resolves with the wall-clock
 *      timestamp of the first paint where `__player.getTime()` is within
 *      tolerance of `target`. Promise is stashed on `window.__perfScrubAwait`.
 *   2. Capture host wall-clock t0 and call `el.seek(target)` in the same task.
 *   3. Await the iframe's resolved Promise (returns t1).
 *   4. Latency = t1 - t0 (ms).
 */
async function measureSingleSeek(page: Page, frame: Frame, target: number): Promise<number> {
  await frame.evaluate(
    (target: number, tolerance: number, timeoutMs: number) => {
      window.__perfScrubAwait = new Promise<number>((resolve, reject) => {
        const deadlineWall = performance.timeOrigin + performance.now() + timeoutMs;
        const tick = () => {
          const wall = performance.timeOrigin + performance.now();
          const time = window.__player?.getTime?.() ?? Number.NaN;
          if (Number.isFinite(time) && Math.abs(time - target) < tolerance) {
            resolve(wall);
            return;
          }
          if (wall > deadlineWall) {
            reject(new Error(`[scrub] timeout target=${target} last=${time}`));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    target,
    MATCH_TOLERANCE_S,
    SEEK_TIMEOUT_MS,
  );

  const t0Wall = await page.evaluate((targetSeconds: number) => {
    const el = document.getElementById("player") as
      | (HTMLElement & { seek: (t: number) => void })
      | null;
    if (!el) throw new Error("[scenario:scrub] player element missing on host page");
    const wall = performance.timeOrigin + performance.now();
    el.seek(targetSeconds);
    return wall;
  }, target);

  // Puppeteer awaits the Promise we stashed on window and returns its resolved value.
  const t1Wall = (await frame.evaluate(() => window.__perfScrubAwait as Promise<number>)) as number;

  return t1Wall - t0Wall;
}

async function runScrubBatch(
  page: Page,
  frame: Frame,
  mode: Mode,
  idx: number,
  total: number,
): Promise<number[]> {
  const latencies: number[] = [];
  for (const target of SEEK_TARGETS) {
    const latency = await measureSingleSeek(page, frame, target);
    latencies.push(latency);
  }
  const p95 = percentile(latencies, 95);
  console.log(
    `[scenario:scrub] run[${idx + 1}/${total}] mode=${mode} p95=${p95.toFixed(2)}ms n=${latencies.length}`,
  );
  return latencies;
}

async function runOnce(
  opts: ScrubScenarioOpts,
  fixture: string,
  idx: number,
  total: number,
): Promise<RunResult> {
  const ctx = await opts.browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    const { duration } = await loadHostPage(page, opts.origin, { fixture });
    const requiredDuration = Math.max(...SEEK_TARGETS);
    if (duration < requiredDuration) {
      throw new Error(
        `[scenario:scrub] fixture composition is ${duration.toFixed(2)}s but scrub targets require >= ${requiredDuration}s`,
      );
    }
    const frame = await getFixtureFrame(page, fixture);

    // Defensively pause: the host shell doesn't autoplay, but `pause()` also
    // cancels any pending autoplay-on-ready behavior and guarantees the
    // timeline isn't ticking under our seek measurements.
    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { pause?: () => void }) | null;
      el?.pause?.();
    });
    await frame.waitForFunction(() => window.__player?.isPlaying?.() === false, {
      timeout: PAUSE_CONFIRM_TIMEOUT_MS,
    });

    // Inline mode first — the player's default `_trySyncSeek` path lands the
    // seek synchronously when the iframe is same-origin (which it is here).
    const inlineLatencies = await runScrubBatch(page, frame, "inline", idx, total);

    // Force isolated mode by shadowing `_trySyncSeek` on the instance with
    // a function that always reports failure. The fallback in `seek()` then
    // sends the seek through `_sendControl("seek", { frame })`, which is the
    // same path a cross-origin embed (or a Phase 1 build without sync seek)
    // would take.
    await page.evaluate(() => {
      const el = document.getElementById("player") as
        | (HTMLElement & { _trySyncSeek?: (t: number) => boolean })
        | null;
      if (!el) throw new Error("[scenario:scrub] player element missing on host page");
      el._trySyncSeek = () => false;
    });

    const isolatedLatencies = await runScrubBatch(page, frame, "isolated", idx, total);

    await page.close();
    return { inlineLatencies, isolatedLatencies };
  } finally {
    await ctx.close();
  }
}

export async function runScrub(opts: ScrubScenarioOpts): Promise<Metric[]> {
  const fixture = opts.fixture ?? DEFAULT_FIXTURE;
  const runs = Math.max(1, opts.runs);
  console.log(
    `[scenario:scrub] fixture=${fixture} runs=${runs} seeks_per_mode=${SEEK_TARGETS.length} tolerance=${(MATCH_TOLERANCE_S * 1000).toFixed(0)}ms`,
  );

  const allInline: number[] = [];
  const allIsolated: number[] = [];
  for (let i = 0; i < runs; i++) {
    const result = await runOnce(opts, fixture, i, runs);
    allInline.push(...result.inlineLatencies);
    allIsolated.push(...result.isolatedLatencies);
  }

  const inlineP95 = percentile(allInline, 95);
  const isolatedP95 = percentile(allIsolated, 95);
  console.log(
    `[scenario:scrub] aggregate inline_p95=${inlineP95.toFixed(2)}ms isolated_p95=${isolatedP95.toFixed(2)}ms (runs=${runs} samples_per_mode=${allInline.length})`,
  );

  return [
    {
      name: "scrub_latency_p95_inline_ms",
      baselineKey: "scrubLatencyP95InlineMs",
      value: inlineP95,
      unit: "ms",
      direction: "lower-is-better",
      samples: allInline,
    },
    {
      name: "scrub_latency_p95_isolated_ms",
      baselineKey: "scrubLatencyP95IsolatedMs",
      value: isolatedP95,
      unit: "ms",
      direction: "lower-is-better",
      samples: allIsolated,
    },
  ];
}
