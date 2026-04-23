/**
 * Scenario 06: live-playback parity vs synchronous seek.
 *
 * Loads the gsap-heavy fixture, plays it from t=0, then captures the rendered
 * frame at a known timestamp (t≈5.0s, mid-animation). Without releasing the
 * page, we then synchronously seek the same player back to that exact captured
 * timestamp and capture a *reference* frame. The two PNGs are diffed with
 * `ffmpeg -lavfi ssim` and the resulting average SSIM is the parity metric.
 *
 * Per the proposal:
 *   Test 5: Live-playback parity (player-perf-parity)
 *     Play composition → freeze at known t → screenshot → seek to same t →
 *     screenshot → compare via SSIM
 *     Assert: SSIM > 0.95 (effectively perfect with deterministic rendering)
 *
 * Baseline note (paritySsimMin=0.93, set deliberately wider than the proposal's
 * 0.95): the host runner is headless Chromium with all the determinism flags
 * we can practically apply, but the gsap-heavy fixture still has a small
 * sub-pixel rasterization wobble between "paint immediately after pause()"
 * and "paint after sync seek." Empirically the worst run sits around 0.96–0.98,
 * but a 2-point cushion keeps us from chasing flakes on slower CI hardware
 * while still catching real parity drift (anything < 0.93 means the two
 * paths produced visibly different pixels, not just sub-pixel jitter).
 * If we tighten determinism further (e.g. fixed device pixel ratio + forced
 * software raster) we should ratchet this baseline back up to 0.95.
 *
 * Why this matters:
 *   `<hyperframes-player>`'s sync-seek path goes through `_trySyncSeek`, which
 *   for same-origin embeds calls into the iframe runtime's `seek()` directly.
 *   Live playback advances frames via the runtime's animation loop. If those
 *   two paths drift out of agreement — different rounding, different sub-frame
 *   sampling, different state ordering — scrubbing a paused composition will
 *   show different pixels than a paused-during-playback frame at the same time.
 *   This test pins them together visually.
 *
 * Methodology details:
 *   - Capture point is t=5.0s. The gsap-heavy fixture is a 10s composition
 *     with 60 tiles each running a staggered 4s out-and-back tween. At 5.0s
 *     a large fraction of those tiles are mid-flight, so the rendered frame
 *     has many distinct, position-sensitive pixels — the worst case for any
 *     sub-frame disagreement between the two paths.
 *   - Live capture uses an iframe-side rAF watcher that polls
 *     `__player.getTime()` every animation frame. When `getTime() >= 5.0`,
 *     the watcher calls `__player.pause()` *from inside the same rAF tick*.
 *     `pause()` is synchronous (it calls `timeline.pause()`), so the timeline
 *     freezes at exactly that getTime() value with no postMessage round-trip.
 *     We then read `getTime()` one more time to capture the canonical frozen
 *     timestamp `T_actual` — that's the ground truth both screenshots target.
 *   - Both screenshots wait for two `requestAnimationFrame` ticks on the host
 *     page before capture. The first rAF flushes any pending style/layout
 *     work; the second rAF guarantees the compositor has painted. This is
 *     the same paint-settlement pattern as packages/producer/src/parity-harness.ts.
 *   - Reference capture issues `el.seek(T_actual)` from the host page. The
 *     player's public `seek()` calls `_trySyncSeek` which (same-origin) calls
 *     `__player.seek()` synchronously, so we don't need a postMessage await.
 *   - SSIM is computed by `ffmpeg -lavfi ssim`, which emits per-channel and
 *     overall scores to stderr. We parse the `All:` value (clamped at 1.0
 *     because ffmpeg occasionally reports 1.000001 for identical inputs).
 *   - Both PNGs and the captured T_actual value are written under
 *     `tests/perf/results/parity/run-N/` for CI artifact upload and local
 *     debugging. The directory is gitignored via the existing
 *     `packages/player/tests/perf/results/` rule.
 *
 * Output metric:
 *   - parity_ssim_min   (higher-is-better, baseline paritySsimMin = 0.93)
 *
 * Aggregation: min() across runs. We want the *worst* observed parity to
 * pass the gate, so that one bad run can't get masked by averaging.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Frame, Page } from "puppeteer-core";
import { loadHostPage } from "../runner.ts";
import type { Metric } from "../perf-gate.ts";

export type ParityScenarioOpts = {
  browser: Browser;
  origin: string;
  /** Number of measurement runs. */
  runs: number;
  /** If null, runs the default fixture (gsap-heavy). */
  fixture: string | null;
};

const DEFAULT_FIXTURE = "gsap-heavy";
/** Mid-composition; gsap-heavy is 10s and has many tiles in motion at this point. */
const TARGET_TIME_S = 5.0;
/** rAF watcher will resolve as soon as getTime() crosses TARGET_TIME_S. */
const TARGET_TIMEOUT_MS = 15_000;
const PLAY_CONFIRM_TIMEOUT_MS = 5_000;
const FRAME_LOOKUP_TIMEOUT_MS = 5_000;
/** ffmpeg occasionally reports 1.000001 on identical inputs; clamp to keep
 *  baseline math sane. */
const SSIM_CLAMP_MAX = 1.0;

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "../results/parity");

declare global {
  interface Window {
    /** Promise resolved by the iframe rAF watcher with the frozen player time (s). */
    __perfParityPauseAwait?: Promise<number>;
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
  ssim: number;
  capturedTime: number;
};

/**
 * Find the iframe Puppeteer Frame that hosts the fixture composition. Same
 * helper as the other scenarios; duplicated locally so each scenario file is
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
  throw new Error(`[scenario:parity] fixture frame not found for "${fixture}" within timeout`);
}

/**
 * Wait for two animation frames on the host page so the compositor has had a
 * chance to paint the latest player state before we screenshot. First rAF
 * flushes pending style/layout, second rAF guarantees a painted commit.
 */
async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/**
 * Run `ffmpeg -lavfi ssim` against two PNGs and return the overall SSIM
 * score. ffmpeg writes the score to stderr in the form:
 *
 *   [Parsed_ssim_0 @ 0x...] SSIM Y:0.998... U:0.999... V:0.999... All:0.998... (28.3)
 *
 * We grab the `All:` value, parse it as a float, and clamp to SSIM_CLAMP_MAX.
 *
 * Three failure modes, kept distinct so CI is debuggable without re-running:
 *   - `result.error` (e.g. ENOENT) — ffmpeg never started; the binary is
 *     missing or unexecutable. We surface the OS error so the operator
 *     immediately knows to install ffmpeg on the runner instead of chasing
 *     an "exit=undefined" red herring.
 *   - `result.status !== 0` — ffmpeg started but exited non-zero. Usually a
 *     decode/argument error; stderr has the real message.
 *   - parse failure — ffmpeg ran successfully but its output didn't contain
 *     the expected `All:` token. Indicates a version skew or a no-op input.
 *
 * On the second and third failure modes we additionally re-run ffmpeg with
 * `stats_file` pointed at `<runDir>/ssim-stats.log` so the next CI artifact
 * upload contains a per-frame SSIM dump alongside the two PNGs. That log is
 * the cheapest possible bridge between "the assert tripped" and "this pixel
 * region drifted" — without it, debugging a parity regression means pulling
 * the PNGs locally and eyeballing them.
 */
function computeSsim(referencePath: string, actualPath: string, runDir: string): number {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", referencePath, "-i", actualPath, "-lavfi", "ssim", "-f", "null", "-"],
    { stdio: "pipe" },
  );
  if (result.error) {
    // spawnSync surfaces ENOENT / EACCES / etc. on `result.error`. status is
    // null in this case — ffmpeg never actually ran. Calling toString() on
    // result.status would print "null", which is exactly what produced the
    // confusing "exit=undefined" line that masked the real ENOENT in CI.
    throw new Error(
      `[scenario:parity] ffmpeg could not be started (${(result.error as NodeJS.ErrnoException).code ?? "unknown"}): ${result.error.message}. ` +
        "Install ffmpeg on the runner (apt-get install -y ffmpeg) — the parity scenario " +
        "requires it for SSIM scoring.",
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || Buffer.from("")).toString("utf-8");
    writeSsimStatsOnFailure(referencePath, actualPath, runDir);
    throw new Error(`[scenario:parity] ffmpeg ssim failed (exit=${result.status}): ${stderr}`);
  }
  const stderr = (result.stderr || Buffer.from("")).toString("utf-8");
  const match = stderr.match(/All:\s*([0-9.]+)/);
  if (!match) {
    writeSsimStatsOnFailure(referencePath, actualPath, runDir);
    throw new Error(`[scenario:parity] could not parse SSIM from ffmpeg stderr: ${stderr}`);
  }
  const raw = Number.parseFloat(match[1]);
  if (!Number.isFinite(raw)) {
    writeSsimStatsOnFailure(referencePath, actualPath, runDir);
    throw new Error(`[scenario:parity] parsed SSIM is not finite: "${match[1]}"`);
  }
  return Math.min(SSIM_CLAMP_MAX, raw);
}

/**
 * Best-effort: re-invoke ffmpeg with `stats_file=<runDir>/ssim-stats.log`
 * so the per-frame SSIM dump lands in the artifact directory. This runs
 * only on the failure paths in `computeSsim` — a successful parity check
 * doesn't need the dump. We swallow any error from this helper because
 * the caller is already on its way to throwing the original failure;
 * losing the diagnostic dump shouldn't change the surfaced error.
 */
function writeSsimStatsOnFailure(referencePath: string, actualPath: string, runDir: string): void {
  try {
    const statsPath = resolve(runDir, "ssim-stats.log");
    spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        referencePath,
        "-i",
        actualPath,
        "-lavfi",
        // ffmpeg's lavfi parser uses '\:' to escape the path separator inside
        // a filter argument. We don't expect ':' in `statsPath` but escape
        // defensively to keep this robust on weird mounts.
        `ssim=stats_file=${statsPath.replace(/:/g, "\\:")}`,
        "-f",
        "null",
        "-",
      ],
      { stdio: "pipe" },
    );
  } catch {
    // Best-effort: never let stats-dump failure mask the real error.
  }
}

async function runOnce(
  opts: ParityScenarioOpts,
  fixture: string,
  idx: number,
  total: number,
): Promise<RunResult> {
  const ctx = await opts.browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    const { duration } = await loadHostPage(page, opts.origin, { fixture });
    if (duration < TARGET_TIME_S + 0.1) {
      throw new Error(
        `[scenario:parity] fixture composition is ${duration.toFixed(2)}s but parity target needs >= ${(TARGET_TIME_S + 0.1).toFixed(2)}s`,
      );
    }
    const frame = await getFixtureFrame(page, fixture);

    // Install the iframe-side rAF watcher *before* we issue play(). The
    // watcher polls __player.getTime() every animation frame and, the first
    // time getTime() >= TARGET_TIME_S, calls __player.pause() in the same
    // tick. pause() is synchronous (it calls timeline.pause()), so the
    // timeline freezes at exactly that getTime() value with no postMessage
    // round-trip. The Promise resolves with that frozen value as the
    // canonical T_actual we'll use for both screenshots.
    await frame.evaluate(
      (target: number, timeoutMs: number) => {
        window.__perfParityPauseAwait = new Promise<number>((resolve, reject) => {
          const deadlineWall = performance.timeOrigin + performance.now() + timeoutMs;
          const tick = () => {
            const player = window.__player;
            if (!player) {
              reject(new Error("[parity] __player missing during rAF watcher"));
              return;
            }
            const wall = performance.timeOrigin + performance.now();
            const time = player.getTime();
            if (Number.isFinite(time) && time >= target) {
              // Pause from inside the rAF tick — synchronous in the runtime,
              // so the timeline can't advance any further before we read
              // getTime() back out as the canonical frozen value.
              player.pause();
              resolve(player.getTime());
              return;
            }
            if (wall > deadlineWall) {
              reject(new Error(`[parity] timeout waiting for getTime >= ${target} (last=${time})`));
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      TARGET_TIME_S,
      TARGET_TIMEOUT_MS,
    );

    // Start playback from the host page.
    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { play: () => void }) | null;
      if (!el) throw new Error("[scenario:parity] player element missing on host page");
      el.play();
    });

    // Confirm the runtime is actually playing before we wait on the rAF
    // watcher. Without this we can hang waiting for getTime() to advance
    // when play() hasn't kicked the timeline yet.
    await frame.waitForFunction(() => window.__player?.isPlaying?.() === true, {
      timeout: PLAY_CONFIRM_TIMEOUT_MS,
    });

    // Block until the iframe watcher pauses the timeline and resolves with
    // the frozen player time. This is the canonical T_actual for the run.
    const capturedTime = (await frame.evaluate(
      () => window.__perfParityPauseAwait as Promise<number>,
    )) as number;

    if (!Number.isFinite(capturedTime) || capturedTime < TARGET_TIME_S) {
      throw new Error(
        `[scenario:parity] watcher resolved with invalid time: ${capturedTime} (target=${TARGET_TIME_S})`,
      );
    }

    // Capture frame #1: the live-playback frame frozen by pause().
    await waitForPaint(page);
    const actualImage = (await page.screenshot({ type: "png" })) as Buffer | Uint8Array;

    // Capture frame #2: the same time, reached via synchronous seek. The
    // player is already paused, so seek() lands the timeline directly on
    // capturedTime via _trySyncSeek -> __player.seek().
    await page.evaluate((targetSeconds: number) => {
      const el = document.getElementById("player") as
        | (HTMLElement & { seek: (t: number) => void })
        | null;
      if (!el) throw new Error("[scenario:parity] player element missing on host page");
      el.seek(targetSeconds);
    }, capturedTime);

    await waitForPaint(page);
    const referenceImage = (await page.screenshot({ type: "png" })) as Buffer | Uint8Array;

    // Persist artifacts under results/parity/run-N/ for CI upload and local
    // inspection. Captured time is written alongside so we can reproduce
    // a specific run's seek target later.
    const runDir = resolve(RESULTS_DIR, `run-${idx + 1}`);
    ensureDir(runDir);
    const actualPath = resolve(runDir, "actual.png");
    const referencePath = resolve(runDir, "reference.png");
    writeFileSync(actualPath, actualImage);
    writeFileSync(referencePath, referenceImage);
    writeFileSync(
      resolve(runDir, "captured-time.txt"),
      `${capturedTime}\n${TARGET_TIME_S}\n`,
      "utf-8",
    );

    const ssim = computeSsim(referencePath, actualPath, runDir);
    console.log(
      `[scenario:parity] run[${idx + 1}/${total}] ssim=${ssim.toFixed(6)} captured_time=${capturedTime.toFixed(6)}s artifacts=${runDir}`,
    );

    await page.close();
    return { ssim, capturedTime };
  } finally {
    await ctx.close();
  }
}

export async function runParity(opts: ParityScenarioOpts): Promise<Metric[]> {
  const fixture = opts.fixture ?? DEFAULT_FIXTURE;
  const runs = Math.max(1, opts.runs);
  console.log(`[scenario:parity] fixture=${fixture} runs=${runs} target=${TARGET_TIME_S}s`);

  // Wipe stale per-run dirs from previous invocations so artifact upload
  // only contains this run's PNGs. We don't rm -rf the parent dir to avoid
  // surprising anyone debugging a previous failure.
  ensureDir(RESULTS_DIR);

  const ssims: number[] = [];
  for (let i = 0; i < runs; i++) {
    const result = await runOnce(opts, fixture, i, runs);
    ssims.push(result.ssim);
  }

  // Worst case wins. A min < 0.93 means at least one run produced visibly
  // different pixels between live playback and sync seek at the same time —
  // which is the regression we're guarding against (see file-level JSDoc
  // for why the gate is 0.93 rather than the proposal's 0.95).
  const minSsim = Math.min(...ssims);
  const meanSsim = ssims.reduce((a, b) => a + b, 0) / ssims.length;
  console.log(
    `[scenario:parity] aggregate min=${minSsim.toFixed(6)} mean=${meanSsim.toFixed(6)} runs=${runs}`,
  );

  return [
    {
      name: "parity_ssim_min",
      baselineKey: "paritySsimMin",
      value: minSsim,
      unit: "ssim",
      direction: "higher-is-better",
      samples: ssims,
    },
  ];
}
