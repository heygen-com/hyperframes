import { postRuntimeMessage } from "./bridge";
import type {
  PlaybackHeldBy,
  PlaybackMotionBlurReport,
  PreviewFrameShape,
  RuntimePreviewHealthMessage,
} from "./types";

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
  heldBy?: PlaybackHeldBy | null;
  frozen?: boolean;
  clock: "audio" | "webaudio" | "monotonic";
  /** Anything that changes how heavy a frame is to draw (window size, zoom). */
  layoutKey: string;
  audio?: { el: HTMLMediaElement; time: number } | null;
  readMotionBlur?: () => PlaybackMotionBlurReport | null;
};

type Sample = {
  atMs: number;
  gapMs: number;
  drawn: boolean;
  waiting: boolean;
  frozen: boolean;
  heldBy: PlaybackHeldBy | null;
};
type Last = { ms: number; film: number; frame: number };
type AudioStep = { atMs: number; ms: number };

const FORWARD_JUMP_SECONDS = 0.5;
const MAX_MEDIA_STEP_MS = 500;
const FRAME_16_MS = 25;
const FRAME_33_MS = 41.7;
let samples: Sample[] = [];
let audioSteps: AudioStep[] = [];
let lastAudio: { el: HTMLMediaElement; time: number } | null = null;
let last: Last | null = null;
let warmEndMs = 0;
let key = "";
let posted = false;
let postedAtMs = 0;
let clockSource: PlaybackHealthInput["clock"] = "monotonic";
const fetchStartedAt = new WeakMap<EventTarget, number>();

export function watchMediaFetches(doc: Document): () => void {
  const onStart = (event: Event) => {
    if (event.target) fetchStartedAt.set(event.target, performance.now());
  };
  doc.addEventListener("loadstart", onStart, true);
  return () => doc.removeEventListener("loadstart", onStart, true);
}

const resourceFetchStart = (src: string) => performance.getEntriesByName(src).at(-1)?.startTime;

export function heldByMedia(el: HTMLMediaElement, nowMs: number): PlaybackHeldBy {
  const started =
    fetchStartedAt.get(el) ?? (el.currentSrc ? resourceFetchStart(el.currentSrc) : undefined);
  return {
    kind: el.tagName === "VIDEO" ? "video" : "audio",
    readyState: el.readyState,
    networkState: el.networkState,
    fetchMs: started === undefined ? null : Math.round(nowMs - started),
  };
}

function post(health: RuntimePreviewHealthMessage["health"]): void {
  postRuntimeMessage({ source: "hf-preview", type: "preview-health", health });
}

function clear(): void {
  samples = [];
  audioSteps = [];
  lastAudio = null;
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

function mediaStepP90(): number | null {
  if (audioSteps.length === 0) return null;
  const sorted = audioSteps.map((step) => step.ms).sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(0.9 * sorted.length) - 1] ?? 0);
}

function summarizeGaps(): {
  gapP50Ms: number;
  gapP95Ms: number;
  worstFrameMs: number;
  over16: number;
  over33: number;
} {
  const gaps = samples.map((sample) => sample.gapMs).sort((a, b) => a - b);
  const gapAt = (share: number) => Math.round(gaps[Math.ceil(share * gaps.length) - 1] ?? 0);
  let over16 = 0;
  let over33 = 0;
  for (const gap of gaps) {
    if (gap > FRAME_16_MS) over16 += 1;
    if (gap > FRAME_33_MS) over33 += 1;
  }
  return {
    gapP50Ms: gapAt(0.5),
    gapP95Ms: gapAt(0.95),
    worstFrameMs: Math.round(gaps[gaps.length - 1] ?? 0),
    over16,
    over33,
  };
}

function trimWindow(nowMs: number, windowMs: number): void {
  const cutoff = nowMs - windowMs;
  while (samples[0] && samples[0].atMs < cutoff) samples.shift();
  while (audioSteps[0] && audioSteps[0].atMs < cutoff) audioSteps.shift();
}

function summarizeWindow(spanMs: number, fps: number, rate: number) {
  let drawn = 0;
  let waitingMs = 0;
  let frozenMs = 0;
  let heldBy: PlaybackHeldBy | null = null;
  for (const sample of samples) {
    if (sample.drawn) drawn += 1;
    if (sample.waiting) waitingMs += sample.gapMs;
    if (sample.frozen) frozenMs += sample.gapMs;
    if (sample.heldBy) heldBy = sample.heldBy;
  }
  const due = (spanMs / 1000) * fps * rate;
  const skipped = due > 0 ? 1 - Math.min(drawn, due) / due : 0;
  const droppedShare = Math.max(skipped, waitingMs / spanMs);
  return { drawn, skipped, waitingMs, frozenMs, droppedShare, heldBy };
}

function measure(
  nowMs: number,
  fps: number,
  rate: number,
  readMotionBlur?: () => PlaybackMotionBlurReport | null,
): void {
  const windowMs = PLAYBACK_HEALTH.windowSeconds * 1000;
  trimWindow(nowMs, windowMs);
  const first = samples[0];
  if (!first) return;
  const spanMs = nowMs - (first.atMs - first.gapMs);
  if (spanMs < windowMs || nowMs - postedAtMs < PLAYBACK_HEALTH.reportEveryMs) return;
  const { drawn, skipped, waitingMs, frozenMs, droppedShare, heldBy } = summarizeWindow(
    spanMs,
    fps,
    rate,
  );
  const motionBlur = readMotionBlur?.();
  posted = true;
  postedAtMs = nowMs;
  post({
    droppedShare: Math.round(droppedShare * 1000) / 1000,
    seconds: Math.round(spanMs / 100) / 10,
    choppy: droppedShare >= PLAYBACK_HEALTH.choppyShare,
    fps: Math.round((drawn / (spanMs / 1000)) * 10) / 10,
    skippedShare: Math.round(skipped * 1000) / 1000,
    waitingShare: Math.round((waitingMs / spanMs) * 1000) / 1000,
    frozenShare: Math.round((frozenMs / spanMs) * 1000) / 1000,
    clockSource,
    heldBy,
    mediaStepP90Ms: mediaStepP90(),
    ...summarizeGaps(),
    ...(motionBlur !== undefined ? { motionBlur } : {}),
    mode: "play",
  });
}

function noteAudioStep(nowMs: number, audio: PlaybackHealthInput["audio"]): void {
  if (!audio || lastAudio?.el !== audio.el) {
    lastAudio = audio ? { el: audio.el, time: audio.time } : null;
    return;
  }
  if (audio.time === lastAudio.time) return;
  const stepMs = (audio.time - lastAudio.time) * 1000;
  if (stepMs > 0 && stepMs < MAX_MEDIA_STEP_MS) audioSteps.push({ atMs: nowMs, ms: stepMs });
  lastAudio.time = audio.time;
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
  clockSource = input.clock;
  noteAudioStep(nowMs, input.audio);
  samples.push({
    atMs: nowMs,
    gapMs,
    drawn: frame !== previous.frame,
    waiting: input.waiting,
    frozen: input.frozen === true,
    heldBy: input.heldBy ?? null,
  });
  measure(nowMs, fps, rate, input.readMotionBlur);
}

type FrameMetricsWindow = Window & {
  __hfMotionBlur?: {
    report?: () => { state?: string; tier?: string | null; movers?: number };
  };
  gsap?: { globalTimeline?: { getChildren?: (...flags: boolean[]) => unknown[] } };
};

export function readMotionBlurSummary(
  doc: Document = document,
  win: Window = window,
): PlaybackMotionBlurReport | null {
  try {
    const root = doc.querySelector("[data-composition-id]");
    if (!root) return null;
    const report = (win as FrameMetricsWindow).__hfMotionBlur?.report?.();
    const tier =
      report?.state === "on" && (report.tier === "filter" || report.tier === "capture")
        ? report.tier
        : null;
    return {
      attr: root.getAttribute("data-motion-blur"),
      shutter: root.getAttribute("data-motion-blur-shutter"),
      state: tier ? "on" : "off",
      tier,
      movers: tier && typeof report?.movers === "number" ? report.movers : null,
    };
  } catch {
    return null;
  }
}

export function readPreviewFrameShape(
  doc: Document = document,
  win: Window = window,
): PreviewFrameShape {
  let tweens: number | null = null;
  try {
    const list = (win as FrameMetricsWindow).gsap?.globalTimeline?.getChildren?.(true, true, false);
    if (Array.isArray(list)) tweens = list.length;
  } catch {
    tweens = null;
  }
  return {
    canvas: doc.querySelectorAll("canvas").length,
    svg: doc.querySelectorAll("svg").length,
    filter: doc.querySelectorAll('[style*="filter"]').length,
    tweens,
  };
}
