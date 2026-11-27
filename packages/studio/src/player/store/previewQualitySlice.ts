import type { StoreApi } from "zustand";
import { isPreviewQuality, type PreviewQuality } from "@hyperframes/core/preview-quality";
import { isMessageList } from "@hyperframes/core/runtime/protocol";
import type {
  PlaybackHealthReport,
  PlaybackMotionBlurReport,
  PreviewFrameShape,
} from "@hyperframes/core";
import type { MediaLoadFailure } from "@hyperframes/core/runtime/protocol";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

/** The lighter copies of heavy videos the preview wants at its current quality. */
export interface PreviewCopies {
  total: number;
  ready: number;
  failed: number;
  progress: number | null;
  error: string | null;
}

type HealthCore = "droppedShare" | "seconds" | "choppy" | "fps" | "worstFrameMs" | "mode";

/** The runtime's report; an older runtime leaves out all but the core fields. */
export type PlaybackHealth = Pick<PlaybackHealthReport, HealthCore> &
  Partial<Omit<PlaybackHealthReport, HealthCore>>;

/** What the preview holds, counts and classes only, filled when asked for. */
export interface PreviewFacts {
  sceneCount: number;
  mountedElementCount: number;
  durationSeconds: number;
  videos: Array<{ codec: string; width: number; height: number; bitDepth: number; count: number }>;
  lighterAt: PreviewQuality[];
  copiesReady: boolean;
  frameShape?: PreviewFrameShape;
}

export type PreviewQualityChosenBy = "person" | "app";

export interface PreviewQualitySlice {
  previewQuality: PreviewQuality;
  /** Who set the level: a person (saved level, or a pick) or the app (never saved); null while nothing has. */
  previewQualityChosenBy: PreviewQualityChosenBy | null;
  /** A person's pick is saved; `by: "app"` sets the level without saving it and never overrides a saved pick. */
  setPreviewQuality: (level: PreviewQuality, options?: { by?: PreviewQualityChosenBy }) => void;
  /** Null when no copies are wanted: full quality, or nothing heavy. */
  previewCopies: PreviewCopies | null;
  setPreviewCopies: (copies: PreviewCopies | null) => void;
  /** Bumped by retryPreviewCopies; the preview owner forwards each bump to the runtime. */
  previewCopiesRetry: number;
  retryPreviewCopies: () => void;
  playbackHealth: PlaybackHealth | null;
  setPlaybackHealth: (health: PlaybackHealth | null) => void;
  previewFacts: PreviewFacts | null;
  setPreviewFacts: (facts: PreviewFacts | null) => void;
  mediaLoadFailure: MediaLoadFailure | null;
  setMediaLoadFailure: (failure: MediaLoadFailure | null) => void;
  /** Bumped by requestPreviewFacts; the preview owner forwards each bump and the answer lands in previewFacts. */
  previewFactsRequests: number;
  requestPreviewFacts: () => void;
}

export function createPreviewQualitySlice(
  set: StoreApi<PreviewQualitySlice>["setState"],
  get: StoreApi<PreviewQualitySlice>["getState"],
): PreviewQualitySlice {
  const saved = readStudioUiPreferences().previewQuality;
  return {
    previewQuality: saved ?? 1,
    previewQualityChosenBy: saved === undefined ? null : "person",
    setPreviewQuality: (previewQuality, options) => {
      // A health reading belongs to the level it was measured at; drop it in the same update as the level.
      const stale = previewQuality === get().previewQuality ? {} : { playbackHealth: null };
      if (options?.by === "app") {
        if (get().previewQualityChosenBy !== "person") {
          set({ previewQuality, previewQualityChosenBy: "app", ...stale });
        }
        return;
      }
      writeStudioUiPreferences({ previewQuality });
      set({ previewQuality, previewQualityChosenBy: "person", ...stale });
    },
    previewCopies: null,
    setPreviewCopies: (previewCopies) => set({ previewCopies }),
    previewCopiesRetry: 0,
    retryPreviewCopies: () =>
      set((state) => ({ previewCopiesRetry: state.previewCopiesRetry + 1 })),
    playbackHealth: null,
    setPlaybackHealth: (playbackHealth) => set({ playbackHealth }),
    previewFacts: null,
    setPreviewFacts: (previewFacts) => set({ previewFacts }),
    mediaLoadFailure: null,
    setMediaLoadFailure: (mediaLoadFailure) => set({ mediaLoadFailure }),
    previewFactsRequests: 0,
    requestPreviewFacts: () =>
      set((state) => ({ previewFactsRequests: state.previewFactsRequests + 1 })),
  };
}

/** The runtime's report, kept only when it has the shape of one. */
export function parsePreviewCopies(value: unknown): PreviewCopies | null {
  if (typeof value !== "object" || value === null) return null;
  const { total, ready, failed, progress, error } = value as Record<string, unknown>;
  const counts = [total, ready, failed].every((count) => typeof count === "number");
  if (!counts || typeof progress !== "number") return null;
  return {
    total: total as number,
    ready: ready as number,
    failed: failed as number,
    progress,
    error: typeof error === "string" ? error : null,
  };
}

const optionalNumber = (n: unknown) => (typeof n === "number" ? n : undefined);
const MAX_METRIC_COUNT = 1_000_000;
const MAX_MEDIA_STEP_MS = 60_000;
const MAX_BLUR_ATTR_LEN = 32;
const BLUR_STATES = ["on", "off"] as const;
const BLUR_TIERS = ["filter", "capture"] as const;

const boundedNonNegInt = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), max)
    : undefined;

const optionalBoundedNullableInt = (value: unknown, max: number): number | null | undefined =>
  value === null ? null : boundedNonNegInt(value, max);

const nullableShortString = (value: unknown, maxLen: number): string | null | undefined =>
  value === null ? null : typeof value === "string" && value.length <= maxLen ? value : undefined;

function parseMotionBlur(value: unknown): PlaybackMotionBlurReport | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const state = BLUR_STATES.find((known) => known === raw.state);
  const tier = raw.tier === null ? null : BLUR_TIERS.find((known) => known === raw.tier);
  const attr = nullableShortString(raw.attr, MAX_BLUR_ATTR_LEN);
  const shutter = nullableShortString(raw.shutter, MAX_BLUR_ATTR_LEN);
  const movers = optionalBoundedNullableInt(raw.movers, MAX_METRIC_COUNT);
  if (
    !state ||
    tier === undefined ||
    attr === undefined ||
    shutter === undefined ||
    movers === undefined
  )
    return undefined;
  return { attr, shutter, state, tier, movers };
}

function parseFrameShape(value: unknown): PreviewFrameShape | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const canvas = boundedNonNegInt(raw.canvas, MAX_METRIC_COUNT);
  const svg = boundedNonNegInt(raw.svg, MAX_METRIC_COUNT);
  const filter = boundedNonNegInt(raw.filter, MAX_METRIC_COUNT);
  const tweens = optionalBoundedNullableInt(raw.tweens, MAX_METRIC_COUNT);
  if (canvas === undefined || svg === undefined || filter === undefined || tweens === undefined)
    return undefined;
  return { canvas, svg, filter, tweens };
}

const CLOCK_SOURCES = ["audio", "webaudio", "monotonic"] as const;
const optionalClock = (clock: unknown) => CLOCK_SOURCES.find((known) => known === clock);
function parseHeldBy(value: unknown): PlaybackHealth["heldBy"] {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { kind, readyState, networkState, fetchMs } = value as Record<string, unknown>;
  if (kind !== "audio" && kind !== "video") return undefined;
  if (typeof readyState !== "number" || typeof networkState !== "number") return undefined;
  if (typeof fetchMs !== "number" && fetchMs !== null) return undefined;
  return { kind, readyState, networkState, fetchMs };
}

export function parsePlaybackHealth(value: unknown): PlaybackHealth | null {
  if (typeof value !== "object" || value === null) return null;
  const extra = value as Record<string, unknown>;
  const { droppedShare, seconds, choppy, fps, worstFrameMs } = value as Record<string, unknown>;
  const numbers = [droppedShare, seconds, fps, worstFrameMs].every((n) => typeof n === "number");
  if (!numbers || typeof choppy !== "boolean") return null;
  return {
    droppedShare: droppedShare as number,
    seconds: seconds as number,
    choppy,
    fps: fps as number,
    worstFrameMs: worstFrameMs as number,
    skippedShare: optionalNumber(extra.skippedShare),
    waitingShare: optionalNumber(extra.waitingShare),
    frozenShare: optionalNumber(extra.frozenShare),
    gapP50Ms: optionalNumber(extra.gapP50Ms),
    gapP95Ms: optionalNumber(extra.gapP95Ms),
    clockSource: optionalClock(extra.clockSource),
    heldBy: parseHeldBy(extra.heldBy),
    mediaStepP90Ms: optionalBoundedNullableInt(extra.mediaStepP90Ms, MAX_MEDIA_STEP_MS),
    over16: boundedNonNegInt(extra.over16, MAX_METRIC_COUNT),
    over33: boundedNonNegInt(extra.over33, MAX_METRIC_COUNT),
    motionBlur: parseMotionBlur(extra.motionBlur),
    mode: "play",
  };
}

export function parsePreviewFacts(value: unknown): PreviewFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const {
    sceneCount,
    mountedElementCount,
    durationSeconds,
    videos,
    copiesReady,
    lighterAt,
    frameShape,
  } = value as Record<string, unknown>;
  const numbers = [sceneCount, mountedElementCount, durationSeconds].every(
    (n) => typeof n === "number",
  );
  if (!numbers || !isMessageList(videos) || typeof copiesReady !== "boolean") return null;
  const grouped = videos.flatMap((video: unknown) => {
    if (typeof video !== "object" || video === null) return [];
    const { codec, width, height, bitDepth, count } = video as Record<string, unknown>;
    const ok =
      typeof codec === "string" &&
      [width, height, bitDepth, count].every((n) => typeof n === "number");
    return ok
      ? [
          {
            codec,
            width: width as number,
            height: height as number,
            bitDepth: bitDepth as number,
            count: count as number,
          },
        ]
      : [];
  });
  const shape = parseFrameShape(frameShape);
  return {
    lighterAt: isMessageList(lighterAt) ? lighterAt.filter(isPreviewQuality) : [],
    sceneCount: sceneCount as number,
    mountedElementCount: mountedElementCount as number,
    durationSeconds: durationSeconds as number,
    videos: grouped,
    copiesReady,
    ...(shape ? { frameShape: shape } : {}),
  };
}
