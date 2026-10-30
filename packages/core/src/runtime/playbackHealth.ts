import { postRuntimeMessage } from "./bridge";
import type { RuntimePreviewHealthMessage } from "./types";

/** What counts as a choppy preview; every number of the rule lives here. */
export const PLAYBACK_HEALTH = {
  windowSeconds: 3,
  choppyShare: 0.25,
  warmupSeconds: 1,
  reportEveryMs: 1000,
} as const;

export type PlaybackHealthInput = {
  nowMs: number;
  filmTime: number;
  fps: number;
  rate: number;
  playing: boolean;
  hidden: boolean;
  /** A playing video is waiting for data. */
  waiting: boolean;
  /** Anything that changes how heavy a frame is to draw (window size, zoom). */
  layoutKey: string;
};

type Sample = { atMs: number; gapMs: number; drawn: boolean; waiting: boolean };
type Last = { ms: number; film: number; frame: number };

const FORWARD_JUMP_SECONDS = 0.5;
let samples: Sample[] = [];
let last: Last | null = null;
let warmEndMs = 0;
let key = "";
let posted = false;
let postedAtMs = 0;

function post(health: RuntimePreviewHealthMessage["health"]): void {
  postRuntimeMessage({ source: "hf-preview", type: "preview-health", health });
}

function clear(): void {
  samples = [];
  last = null;
  if (posted) post(null);
  posted = false;
  postedAtMs = 0;
}

let displayScale: number | null = null;

/** The host re-sends its scale on every resize; only a different scale restarts the window. */
export function noteDisplayScale(scale: number): void {
  if (scale === displayScale) return;
  displayScale = scale;
  clear();
}

/** Restarts the window after something that stalls playback for reasons unrelated to the level. */
export function restartPlaybackHealth(): void {
  clear();
}

function measure(nowMs: number, fps: number, rate: number): void {
  const windowMs = PLAYBACK_HEALTH.windowSeconds * 1000;
  while (samples[0] && samples[0].atMs < nowMs - windowMs) samples.shift();
  const first = samples[0];
  if (!first) return;
  const spanMs = nowMs - (first.atMs - first.gapMs);
  if (spanMs < windowMs || nowMs - postedAtMs < PLAYBACK_HEALTH.reportEveryMs) return;
  const drawn = samples.filter((sample) => sample.drawn).length;
  const due = (spanMs / 1000) * fps * rate;
  const skipped = due > 0 ? 1 - Math.min(drawn, due) / due : 0;
  const waitingMs = samples.reduce((sum, s) => sum + (s.waiting ? s.gapMs : 0), 0);
  const droppedShare = Math.max(skipped, waitingMs / spanMs);
  const gaps = samples.map((sample) => sample.gapMs).sort((a, b) => a - b);
  const gapAt = (share: number) => Math.round(gaps[Math.ceil(share * gaps.length) - 1] ?? 0);
  posted = true;
  postedAtMs = nowMs;
  post({
    droppedShare: Math.round(droppedShare * 1000) / 1000,
    seconds: Math.round(spanMs / 100) / 10,
    choppy: droppedShare >= PLAYBACK_HEALTH.choppyShare,
    fps: Math.round((drawn / (spanMs / 1000)) * 10) / 10,
    worstFrameMs: Math.round(Math.max(...samples.map((sample) => sample.gapMs))),
    skippedShare: Math.round(skipped * 1000) / 1000,
    waitingShare: Math.round((waitingMs / spanMs) * 1000) / 1000,
    gapP50Ms: gapAt(0.5),
    gapP95Ms: gapAt(0.95),
    mode: "play",
  });
}

/** One call per runtime tick: counts frames drawn against frames due while the film plays. */
export function notePlaybackFrame(input: PlaybackHealthInput): void {
  const { nowMs, filmTime, fps, rate } = input;
  const nextKey = `${fps}|${rate}|${input.layoutKey}`;
  if (!input.playing || input.hidden) {
    clear();
    return;
  }
  if (nextKey !== key) {
    key = nextKey;
    clear();
  }
  const frame = Math.floor(filmTime * fps + 1e-6);
  const previous = last;
  last = { ms: nowMs, film: filmTime, frame };
  if (!previous) {
    warmEndMs = nowMs + PLAYBACK_HEALTH.warmupSeconds * 1000;
    return;
  }
  const gapMs = nowMs - previous.ms;
  const expected = previous.film + (gapMs / 1000) * rate;
  if (filmTime < previous.film || filmTime > expected + FORWARD_JUMP_SECONDS) {
    clear();
    last = { ms: nowMs, film: filmTime, frame };
    warmEndMs = nowMs + PLAYBACK_HEALTH.warmupSeconds * 1000;
    return;
  }
  if (nowMs < warmEndMs) return;
  samples.push({ atMs: nowMs, gapMs, drawn: frame !== previous.frame, waiting: input.waiting });
  measure(nowMs, fps, rate);
}
