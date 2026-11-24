/** Turns one run's traces into numbers for the five playback problems; pure, so each is unit-tested. */
import type { EditSpec } from "./compositions.ts";

export type Dump = {
  kind: "host" | "comp";
  events: [number, string, string, number | string][];
  frames: [number, string, number, number, number][];
  samples: [number, string, number, number, number, number, number, number | null][];
  params: [number, number | null, number | null, string, string, number, number | null][];
  edges: [number, number | string][];
  sources: [number, string][];
  tap: [number, number, number, number, number, number, number][];
  ctxs: [number, number, number, number][];
  rejects: number;
};

export type Run = {
  edit: EditSpec;
  comp: Dump;
  host: Dump;
  playAt: number;
  endedAt: number | null;
  ownership: [number, string][];
};

export type Metrics = {
  /** Problem 1 */
  firstTakeOverrunFrames: number;
  cutsWithOverrun: number;
  pictureAheadMs: number | null;
  playheadStartMs: number | null;
  /** Problem 2 */
  joins: number;
  joinsWithMidPlaySeek: number;
  jumpMedianMs: number | null;
  jumpMaxMs: number | null;
  audioLateStartMedianMs: number | null;
  joinsPreSeeked: number;
  /** Problem 3: scheduled lane time minus when the audio reached that point, in ms (negative is early). */
  automationOffsetMedianMs: number | null;
  automationOffsetMinMs: number | null;
  automationOffsetMaxMs: number | null;
  /** The end of each take's fade-out, the point a user hears land, one per take. */
  fadeOutOffsetsMs: number[];
  takesWithAutomationOff50: number;
  /** Problem 4 */
  secondFrameGapMedianMs: number | null;
  secondFrameGapMaxMs: number | null;
  /** How far the incoming picture sits behind the playhead over its take's first 0.5 s, median per cut. */
  cutPictureLagMedianMs: number | null;
  cutPictureLagMaxMs: number | null;
  playheadHoldMedianMs: number | null;
  playheadHoldP90Ms: number | null;
  holdsOver100: number;
  cuts: number;
  playedLongerMs: number | null;
  /** Problem 5: takes whose own stretch of the file was heard, how many parent-proxy seeks per second */
  takesHeard: number | null;
  proxySeeksPerSecond: number | null;
  /** How long the parent proxy played, from its first play to its last pause. */
  proxyPlayedSeconds: number | null;
  ownershipParent: boolean;
  rejectedPlays: number;
};

export const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
export const pct = (v: number[], p: number): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const round = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

type Sample = Dump["samples"][number];

/** First time the playhead reaches `ph` (epoch ms), from the per-rAF samples (one frame's rows share a time). */
function timeAtPlayhead(samples: Sample[], ph: number): number | null {
  let prev: Sample | null = null;
  for (const b of samples) {
    if (b[7] === null) continue;
    if (prev && b[0] > prev[0] && prev[7]! <= ph && b[7] >= ph && b[7] > prev[7]!)
      return prev[0] + ((ph - prev[7]!) / (b[7] - prev[7]!)) * (b[0] - prev[0]);
    if (!prev || b[0] > prev[0]) prev = b;
  }
  return null;
}

const byId = (samples: Sample[], id: string) => samples.filter((s) => s[1] === id);

/** Element-time to epoch: when did `currentTime` first reach `m` after the element was last seeked to before it. */
function timeAtMedia(series: Sample[], m: number, after: number): number | null {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!,
      b = series[i]!;
    if (b[0] < after || b[3] === 1) continue;
    if (a[2] <= m && b[2] >= m && b[2] > a[2])
      return a[0] + ((m - a[2]) / (b[2] - a[2])) * (b[0] - a[0]);
  }
  return null;
}

export function analyze(run: Run): Metrics {
  const { edit, comp, host } = run;
  const fps = edit.fps;
  const takes = edit.takes;
  const samples = comp.samples;
  const m = {} as Metrics;

  // ---- Problem 1: frames shown past an out-point, the picture running ahead of a clock that has not started
  const overrun = takes.map((t, k) => {
    const frames = comp.frames.filter((f) => f[1] === `v${k}` && f[4] === 1);
    const seen = new Set<number>();
    for (const f of frames)
      if (Math.round(f[2] * fps) >= t.outFrame) seen.add(Math.round(f[2] * fps));
    return seen.size;
  });
  m.firstTakeOverrunFrames = overrun[0] ?? 0;
  m.cutsWithOverrun = overrun.slice(1, -1).filter((n) => n > 0).length;
  const v0 = byId(samples, "v0");
  let ahead: number | null = null;
  for (const s of v0) {
    if (s[0] < run.playAt || s[0] > run.playAt + 1500 || s[3] === 1 || s[7] === null) continue;
    const d = (s[2] - takes[0]!.inPoint - s[7]) * 1000;
    ahead = ahead === null ? d : Math.max(ahead, d);
  }
  m.pictureAheadMs = round(ahead);
  const moved = samples.find((s) => s[0] >= run.playAt && s[7] !== null && s[7] > 0.05);
  m.playheadStartMs = moved ? round(moved[0] - run.playAt) : null;

  // ---- Problem 2: audio joins
  const jumps: number[] = [];
  const lates: number[] = [];
  let withSeek = 0,
    preSeeked = 0,
    joins = 0;
  for (const t of takes.slice(1)) {
    const id = `a${t.index}`;
    const series = byId(samples, id);
    const t0 = timeAtPlayhead(samples, t.audio.start);
    if (t0 === null || !series.length) continue;
    joins++;
    const pre = series.find((s) => s[0] >= t0 - 50);
    if (pre && Math.abs(pre[2] - t.audio.mediaStart) < 0.02) preSeeked++;
    const playing = comp.events.find((e) => e[1] === id && e[2] === "playing" && e[0] >= t0 - 300);
    const from = playing ? Math.max(playing[0], t0) : t0;
    const seeks = comp.events.filter(
      (e) => e[1] === id && e[2] === "seeking" && e[0] >= from && e[0] <= t0 + 600,
    );
    if (seeks.length) withSeek++;
    for (const e of seeks) {
      const i = series.findIndex((s) => s[0] >= e[0]);
      if (i < 1) continue;
      const a = series[i - 1]!,
        b = series[i]!;
      const jump = (b[2] - a[2] - ((b[0] - a[0]) / 1000) * (b[5] || 1)) * 1000;
      jumps.push(Math.abs(jump));
    }
    const at = series.find((s) => s[0] >= t0 + 50 && s[3] === 0);
    if (at && at[7] !== null)
      lates.push((at[7] - t.audio.start + t.audio.mediaStart - at[2]) * 1000);
  }
  m.joins = joins;
  m.joinsWithMidPlaySeek = withSeek;
  m.jumpMedianMs = round(median(jumps));
  m.jumpMaxMs = round(jumps.length ? Math.max(...jumps) : null);
  m.audioLateStartMedianMs = round(median(lates));
  m.joinsPreSeeked = preSeeked;

  // ---- Problem 3: where the volume lane landed against the audio it shapes
  // The gain node for an element is the first one downstream of its source that had params scheduled.
  const gainOfSource = new Map<string, number>();
  const owners = new Set(comp.params.map((p) => p[2]));
  for (const [src, el] of comp.sources) {
    const queue = [src];
    const visited = new Set<number>();
    while (queue.length) {
      const n = queue.shift()!;
      if (visited.has(n)) continue;
      visited.add(n);
      if (n !== src && owners.has(n)) {
        gainOfSource.set(el, n);
        break;
      }
      for (const [from, to] of comp.edges) if (from === n && typeof to === "number") queue.push(to);
    }
  }
  const offsets: number[] = [];
  const fadeOut: number[] = [];
  let off50 = 0;
  for (const t of takes) {
    const id = `a${t.index}`;
    const gain = gainOfSource.get(id);
    if (gain === undefined) continue;
    const calls = comp.params.filter((p) => p[2] === gain && p[4] === "linearRampToValueAtTime");
    const series = byId(samples, id);
    let bad = false;
    // The runtime sets the first point with setValueAtTime and ramps to each later one, in lane order.
    for (const [i, pt] of t.lane.entries()) {
      const target = calls[i - 1];
      if (!target || Math.abs((target[6] ?? NaN) - pt.v) > 0.0006) continue;
      const mPos = t.audio.mediaStart + pt.t;
      const e = timeAtMedia(series, mPos, run.playAt);
      if (e === null) continue;
      const ctxRow = [...comp.ctxs].reverse().find((c) => c[0] <= e) ?? comp.ctxs[0];
      if (!ctxRow) continue;
      const ctxAt = ctxRow[2] + (e - ctxRow[3]) / 1000;
      const off = (target[5] - ctxAt) * 1000;
      offsets.push(off);
      if (i === t.lane.length - 1) fadeOut.push(round(off) as number);
      if (Math.abs(off) > 50) bad = true;
    }
    if (bad) off50++;
  }
  m.automationOffsetMedianMs = round(median(offsets));
  m.automationOffsetMinMs = round(offsets.length ? Math.min(...offsets) : null);
  m.automationOffsetMaxMs = round(offsets.length ? Math.max(...offsets) : null);
  m.takesWithAutomationOff50 = off50;
  m.fadeOutOffsetsMs = fadeOut;

  // ---- Problem 4: what a cut costs
  const gaps: number[] = [];
  const holds: number[] = [];
  const lags: number[] = [];
  for (const t of takes.slice(1)) {
    const opening = byId(samples, `v${t.index}`).filter(
      (s) => s[3] === 0 && s[7] !== null && s[7] >= t.start && s[7] <= t.start + 0.5,
    );
    const lag = median(opening.map((s) => (t.inPoint + s[7]! - t.start - s[2]) * 1000));
    if (lag !== null) lags.push(lag);
    const fr = comp.frames
      .filter((f) => f[1] === `v${t.index}` && f[4] === 1)
      .sort((a, b) => a[0] - b[0]);
    if (fr.length >= 2) gaps.push(fr[1]![0] - fr[0]![0]);
    const a = timeAtPlayhead(samples, t.start - 0.5),
      b = timeAtPlayhead(samples, t.start + 0.5);
    if (a !== null && b !== null) holds.push(b - a - 1000);
  }
  m.cuts = takes.length - 1;
  m.secondFrameGapMedianMs = round(median(gaps));
  m.secondFrameGapMaxMs = round(gaps.length ? Math.max(...gaps) : null);
  m.cutPictureLagMedianMs = round(median(lags));
  m.cutPictureLagMaxMs = round(lags.length ? Math.max(...lags) : null);
  m.playheadHoldMedianMs = round(median(holds));
  m.playheadHoldP90Ms = round(pct(holds, 0.9));
  m.holdsOver100 = holds.filter((h) => h > 100).length;
  m.playedLongerMs =
    run.endedAt === null ? null : round(run.endedAt - run.playAt - edit.duration * 1000);

  // ---- Problem 5: the parent proxy path. Which stretch of the file reached the output, window by window.
  m.ownershipParent = run.ownership.some((o) => o[1] === "parent");
  m.rejectedPlays = comp.rejects;
  // Seeks per second of the time the parent proxy was actually playing (first play to its last pause).
  const firstPlay = host.events.find((e) => e[2] === "play" && e[0] >= run.playAt);
  const lastPause = [...host.events].reverse().find((e) => e[2] === "pause" || e[2] === "ended");
  const span =
    firstPlay && lastPause && lastPause[0] > firstPlay[0]
      ? (lastPause[0] - firstPlay[0]) / 1000
      : null;
  const proxySeeks = host.events.filter(
    (e) => e[2] === "seeking" && firstPlay && e[0] >= firstPlay[0],
  ).length;
  m.proxySeeksPerSecond = span ? round(proxySeeks / span) : null;
  m.proxyPlayedSeconds = round(span);
  const heardRows = [...host.tap, ...comp.tap].filter(
    (r) => r[4] >= 0 && r[5] >= 0 && r[6] >= run.playAt,
  );
  if (!heardRows.length) m.takesHeard = null;
  else {
    let heard = 0;
    for (const t of takes) {
      const startEpoch = timeAtPlayhead(samples, t.start) ?? run.playAt + t.start * 1000;
      const inWindow = heardRows.filter(
        (r) => r[6] >= startEpoch + 200 && r[6] <= startEpoch + t.dur * 1000,
      );
      if (!inWindow.length) continue;
      const right = inWindow.filter((r) => {
        const pos = r[5] * 16 + r[4] * 0.5;
        return pos >= t.inPoint - 0.75 && pos <= t.inPoint + t.dur + 0.75;
      });
      if (right.length / inWindow.length > 0.5) heard++;
    }
    m.takesHeard = heard;
  }
  return m;
}
