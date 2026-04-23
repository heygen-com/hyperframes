/**
 * Scenario 05: media sync drift.
 *
 * Loads the 10-video-grid fixture, starts playback, and uses
 * `requestVideoFrameCallback` on every video element to record
 * (compositionTime, actualMediaTime) pairs for each decoded frame. Drift is
 * the absolute difference between the *expected* media time (derived from the
 * composition time using the runtime's clip transform) and the actual media
 * time the decoder presented to the compositor.
 *
 * Per the proposal:
 *   Test 4: Media sync drift (player-perf-drift)
 *     Load 5-video composition → play for 10 seconds → on each RVFC callback,
 *     record drift between expected and actual media time
 *     Assert: max drift < 500ms, p95 drift < 100ms
 *
 * Methodology details:
 *   - We instrument *every* `video[data-start]` element in the fixture. The
 *     proposal called for 5 videos; the 10-video-grid gives us 10 streams in
 *     the same composition, which is a more conservative regression signal.
 *   - The expected media time uses the same transform the runtime applies in
 *     packages/core/src/runtime/media.ts:
 *
 *         expectedMediaTime = (compositionTime - clip.start) * clip.playbackRate
 *                              + clip.mediaStart
 *
 *     We snapshot `clip.start` / `clip.mediaStart` / `clip.playbackRate` from
 *     each element's dataset + `defaultPlaybackRate` once when the sampler is
 *     installed, so the per-frame work is just a subtract + multiply + abs.
 *   - The runtime's media sync runs on a 50ms `setInterval`. Between syncs the
 *     video element's clock free-runs. The drift we measure here is the
 *     residual after that 50ms loop catches up — i.e. the user-visible glitch
 *     budget. The runtime hard-resyncs when |currentTime - relTime| > 0.5s
 *     (see media.ts), which is exactly the proposal's max-drift ceiling: a
 *     regression past 500ms means the corrective resync kicked in and the
 *     viewer saw a jump.
 *   - We install RVFC *before* calling play(), then reset the sample buffer
 *     once `__player.isPlaying()` flips true. Frames captured during the
 *     postMessage round-trip would compare a non-zero mediaTime against
 *     `getTime() === 0` and inflate drift to several hundred ms — same gotcha
 *     as 02-fps.ts.
 *   - Sustain window is 6s instead of the proposal's 10s because the fixture
 *     composition is exactly 10s long, and we want headroom before the
 *     end-of-timeline pause/clamp behavior. With 10 videos × ~25fps × 6s we
 *     still pool ~1500 samples per run, more than enough for a stable p95.
 *
 * Outputs two metrics:
 *   - media_drift_max_ms   (lower-is-better, baseline driftMaxMs)
 *   - media_drift_p95_ms   (lower-is-better, baseline driftP95Ms)
 *
 * Aggregation: max() and percentile(95) across the pooled per-frame drifts
 * from every video in every run.
 */

import type { Browser, Frame, Page } from "puppeteer-core";
import { loadHostPage, percentile } from "../runner.ts";
import type { Metric } from "../perf-gate.ts";

export type DriftScenarioOpts = {
  browser: Browser;
  origin: string;
  /** Number of measurement runs. */
  runs: number;
  /** If null, runs the default fixture (10-video-grid). */
  fixture: string | null;
};

const DEFAULT_FIXTURE = "10-video-grid";
const PLAYBACK_DURATION_MS = 6_000;
const PLAY_CONFIRM_TIMEOUT_MS = 5_000;
const FRAME_LOOKUP_TIMEOUT_MS = 5_000;

type DriftSample = {
  compTime: number;
  actualMediaTime: number;
  clipStart: number;
  clipMediaStart: number;
  clipPlaybackRate: number;
};

declare global {
  interface Window {
    /** RVFC samples collected by the iframe-side observer. */
    __perfDriftSamples?: DriftSample[];
    /** Set to false to stop sampling at the end of the measurement window. */
    __perfDriftActive?: boolean;
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
  drifts: number[];
  videoCount: number;
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
  throw new Error(`[scenario:drift] fixture frame not found for "${fixture}" within timeout`);
}

async function runOnce(
  opts: DriftScenarioOpts,
  fixture: string,
  idx: number,
  total: number,
): Promise<RunResult> {
  const ctx = await opts.browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    const { duration } = await loadHostPage(page, opts.origin, { fixture });
    const requiredDurationSec = PLAYBACK_DURATION_MS / 1000;
    if (duration < requiredDurationSec) {
      throw new Error(
        `[scenario:drift] fixture composition is ${duration.toFixed(2)}s but drift sample window needs >= ${requiredDurationSec.toFixed(0)}s`,
      );
    }
    const frame = await getFixtureFrame(page, fixture);

    // Install RVFC on every `video[data-start]` element in the iframe. Each
    // callback records the wall-clock-aligned (compositionTime, mediaTime)
    // pair plus a snapshot of the clip transform so we can compute drift in
    // node without re-querying the dataset on every frame.
    const videoCount = (await frame.evaluate(() => {
      window.__perfDriftSamples = [];
      window.__perfDriftActive = true;
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-start]"));
      type RvfcMetadata = { mediaTime: number; presentationTime: number };
      type RvfcVideo = HTMLVideoElement & {
        requestVideoFrameCallback?: (
          cb: (now: DOMHighResTimeStamp, metadata: RvfcMetadata) => void,
        ) => number;
      };
      let installed = 0;
      for (const video of videos) {
        const rvfcVideo = video as RvfcVideo;
        const rvfc = rvfcVideo.requestVideoFrameCallback;
        // Headless Chrome supports RVFC; bail quietly on browsers that don't.
        if (!rvfc) continue;
        const clipStart = Number.parseFloat(video.dataset.start ?? "0") || 0;
        const clipMediaStart =
          Number.parseFloat(video.dataset.playbackStart ?? video.dataset.mediaStart ?? "0") || 0;
        const rawRate = video.defaultPlaybackRate;
        const clipPlaybackRate =
          Number.isFinite(rawRate) && rawRate > 0 ? Math.max(0.1, Math.min(5, rawRate)) : 1;
        const tick = (_now: DOMHighResTimeStamp, metadata: RvfcMetadata) => {
          if (!window.__perfDriftActive) return;
          const compTime = window.__player?.getTime?.() ?? Number.NaN;
          if (Number.isFinite(compTime)) {
            window.__perfDriftSamples!.push({
              compTime,
              actualMediaTime: metadata.mediaTime,
              clipStart,
              clipMediaStart,
              clipPlaybackRate,
            });
          }
          rvfc.call(video, tick);
        };
        rvfc.call(video, tick);
        installed++;
      }
      return installed;
    })) as number;

    if (videoCount === 0) {
      throw new Error(`[scenario:drift] fixture ${fixture} contains no video[data-start] elements`);
    }

    // Issue play from the host page; the player posts a control message into
    // the iframe and the runtime starts the 50ms media sync poll.
    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { play: () => void }) | null;
      if (!el) throw new Error("[scenario:drift] player element missing on host page");
      el.play();
    });

    // Wait for the runtime to confirm playing before we trust the samples.
    await frame.waitForFunction(() => window.__player?.isPlaying?.() === true, {
      timeout: PLAY_CONFIRM_TIMEOUT_MS,
    });

    // Reset the buffer now that playback is live. Anything captured during
    // the postMessage round-trip would compare a non-zero mediaTime against
    // `getTime() === 0` and bias drift up by hundreds of ms.
    await frame.evaluate(() => {
      window.__perfDriftSamples = [];
    });

    await new Promise((r) => setTimeout(r, PLAYBACK_DURATION_MS));

    // Stop sampling first, then pause. Same ordering as 02-fps.ts so the
    // pause command can't perturb the tail of the measurement window.
    const samples = (await frame.evaluate(() => {
      window.__perfDriftActive = false;
      return window.__perfDriftSamples ?? [];
    })) as DriftSample[];

    await page.evaluate(() => {
      const el = document.getElementById("player") as (HTMLElement & { pause: () => void }) | null;
      el?.pause();
    });

    if (samples.length === 0) {
      throw new Error(
        `[scenario:drift] run ${idx + 1}/${total}: zero RVFC samples captured (videos=${videoCount}, duration=${duration.toFixed(2)}s)`,
      );
    }

    // Apply the runtime's transform to derive the expected media time, then
    // compare against the actual media time the decoder presented. Convert
    // to ms here so the gate threshold (driftMaxMs / driftP95Ms) compares
    // apples-to-apples.
    const drifts: number[] = [];
    for (const s of samples) {
      const expectedMediaTime = (s.compTime - s.clipStart) * s.clipPlaybackRate + s.clipMediaStart;
      const driftMs = Math.abs(s.actualMediaTime - expectedMediaTime) * 1000;
      drifts.push(driftMs);
    }

    const max = Math.max(...drifts);
    const p95 = percentile(drifts, 95);
    console.log(
      `[scenario:drift] run[${idx + 1}/${total}] max=${max.toFixed(2)}ms p95=${p95.toFixed(2)}ms videos=${videoCount} samples=${samples.length}`,
    );

    await page.close();
    return { drifts, videoCount };
  } finally {
    await ctx.close();
  }
}

export async function runDrift(opts: DriftScenarioOpts): Promise<Metric[]> {
  const fixture = opts.fixture ?? DEFAULT_FIXTURE;
  const runs = Math.max(1, opts.runs);
  console.log(`[scenario:drift] fixture=${fixture} runs=${runs} window=${PLAYBACK_DURATION_MS}ms`);

  const allDrifts: number[] = [];
  let lastVideoCount = 0;
  for (let i = 0; i < runs; i++) {
    const result = await runOnce(opts, fixture, i, runs);
    allDrifts.push(...result.drifts);
    lastVideoCount = result.videoCount;
  }

  // Worst case wins for max; p95 is computed across the pooled per-frame
  // drifts from every video in every run. The proposal asserts max < 500ms
  // and p95 < 100ms, so a single bad sample legitimately gates the build.
  const maxDrift = Math.max(...allDrifts);
  const p95Drift = percentile(allDrifts, 95);
  // Coefficient of variation (stddev / mean) is logged here as a soft signal
  // we can eyeball in CI output. We deliberately do NOT gate on it — the
  // baseline asserts absolute thresholds (max, p95), and the underlying
  // distribution is heavy-tailed (most frames are sub-50ms, occasional ones
  // spike during the 50ms media-sync interval). But CV is a useful early
  // warning: if it climbs significantly across CI runs while max + p95 stay
  // green, our jitter assumptions about the runtime's resync loop have
  // shifted (e.g. if media.ts changes its 50ms `setInterval` cadence) and
  // we should revisit the baselines before they start producing flakes.
  // TODO(player-perf): once we have ~2 weeks of CI baseline data, decide
  // whether to publish CV as a tracked-but-ungated metric in baseline.json
  // alongside max + p95, or wire it into the Slack regression report.
  const meanDrift = allDrifts.reduce((a, b) => a + b, 0) / allDrifts.length;
  const variance = allDrifts.reduce((acc, d) => acc + (d - meanDrift) ** 2, 0) / allDrifts.length;
  const stddev = Math.sqrt(variance);
  const cv = meanDrift > 0 ? stddev / meanDrift : 0;
  console.log(
    `[scenario:drift] aggregate max=${maxDrift.toFixed(2)}ms p95=${p95Drift.toFixed(2)}ms mean=${meanDrift.toFixed(2)}ms cv=${cv.toFixed(3)} videos=${lastVideoCount} samples=${allDrifts.length} runs=${runs}`,
  );

  return [
    {
      name: "media_drift_max_ms",
      baselineKey: "driftMaxMs",
      value: maxDrift,
      unit: "ms",
      direction: "lower-is-better",
      samples: allDrifts,
    },
    {
      name: "media_drift_p95_ms",
      baselineKey: "driftP95Ms",
      value: p95Drift,
      unit: "ms",
      direction: "lower-is-better",
      samples: allDrifts,
    },
  ];
}
