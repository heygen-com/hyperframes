/**
 * Types and type-guards for the two playback adapter paths the player supports:
 *
 *  - `RuntimeDurationAdapter` — the HyperFrames runtime exposes `window.__player`
 *    with a `getDuration()` method. This is the standard path for compositions
 *    served through the runtime bridge.
 *
 *  - `DirectTimelineAdapter` — same-origin standalone compositions can expose
 *    their GSAP master timeline at `window.__timelines` without installing the
 *    full runtime. The player drives play/pause/seek directly against the
 *    timeline object, bypassing the postMessage bridge.
 *
 *  `PlaybackDurationAdapter` is the discriminated union the probe interval
 *  returns after deciding which path is available.
 */

export interface RuntimeDurationAdapter {
  getDuration: () => number;
}

export interface DirectTimelineAdapter {
  duration: () => number;
  time: () => number;
  // suppressEvents mirrors GSAP's timeline.seek(position, suppressEvents); pass
  // false to fire onUpdate (so imperative-visibility compositions repaint on seek).
  seek: (timeInSeconds: number, suppressEvents?: boolean) => unknown;
  play: () => unknown;
  pause: () => unknown;
  /** Optional: set playback rate (e.g. GSAP's timeScale). Called when the player's playbackRate changes. */
  timeScale?: (scale: number) => unknown;
}

export type PlaybackDurationAdapter =
  | { kind: "runtime"; getDuration: () => number }
  | { kind: "direct-timeline"; timeline: DirectTimelineAdapter; getDuration: () => number };

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRuntimeDurationAdapter(value: unknown): value is RuntimeDurationAdapter {
  return isObjectRecord(value) && typeof value.getDuration === "function";
}

export function isDirectTimelineAdapter(value: unknown): value is DirectTimelineAdapter {
  return (
    isObjectRecord(value) &&
    typeof value.duration === "function" &&
    typeof value.time === "function" &&
    typeof value.seek === "function" &&
    typeof value.play === "function" &&
    typeof value.pause === "function"
  );
}

interface AnimeInstanceLike {
  seek?: (timeMs: number) => unknown;
  pause?: () => unknown;
  play?: () => unknown;
  duration?: number | (() => number);
  totalDuration?: number | (() => number);
}

interface AnimeRegistryEntryLike {
  id: string;
  instance: AnimeInstanceLike;
}

export type AnimeRegistryLike = Record<string, unknown> | unknown[];

function isAnimeInstanceLike(value: unknown): value is AnimeInstanceLike {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.seek === "function" ||
    typeof value.pause === "function" ||
    typeof value.play === "function" ||
    "duration" in value ||
    "totalDuration" in value
  );
}

function isAnimeRegistrationLike(value: unknown): value is AnimeRegistryEntryLike {
  return (
    isObjectRecord(value) && typeof value.id === "string" && isAnimeInstanceLike(value.instance)
  );
}

function normalizeAnimeEntry(fallbackId: string, value: unknown): AnimeRegistryEntryLike | null {
  if (isAnimeRegistrationLike(value)) {
    return {
      id: value.id || fallbackId,
      instance: value.instance,
    };
  }
  if (isAnimeInstanceLike(value)) {
    return {
      id: fallbackId,
      instance: value,
    };
  }
  return null;
}

function isArrayIndexKey(value: string): boolean {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && String(index) === value;
}

function collectAnimeEntriesFromObject(registry: AnimeRegistryLike): AnimeRegistryEntryLike[] {
  const entries: AnimeRegistryEntryLike[] = [];
  for (const [id, value] of Object.entries(registry)) {
    const fallbackId = Array.isArray(registry) && isArrayIndexKey(id) ? `legacy-${id}` : id;
    const normalized = normalizeAnimeEntry(fallbackId, value);
    if (normalized) entries.push(normalized);
  }
  return entries;
}

// fallow-ignore-next-line complexity
function collectAnimeEntries(source: unknown): AnimeRegistryEntryLike[] {
  if (!isObjectRecord(source)) return [];

  const entriesFn = Reflect.get(source, "entries");
  if (typeof entriesFn === "function") {
    try {
      const rawEntries = entriesFn.call(source);
      if (Array.isArray(rawEntries)) {
        const normalizedEntries: AnimeRegistryEntryLike[] = [];
        for (const [index, value] of rawEntries.entries()) {
          const normalized = normalizeAnimeEntry(`entry-${index}`, value);
          if (normalized) normalizedEntries.push(normalized);
        }
        if (normalizedEntries.length > 0) return normalizedEntries;
      }
    } catch {
      return [];
    }
  }

  return collectAnimeEntriesFromObject(source);
}

export function isAnimeRegistryLike(value: unknown): value is AnimeRegistryLike {
  return collectAnimeEntries(value).length > 0;
}

function readAnimeDurationMs(instance: AnimeInstanceLike): number | null {
  const totalDuration = readAnimeNumericProperty(instance, "totalDuration");
  const duration = totalDuration ?? readAnimeNumericProperty(instance, "duration");
  return duration != null && duration > 0 ? duration : null;
}

function readAnimeNumericProperty(
  instance: AnimeInstanceLike,
  key: "duration" | "totalDuration",
): number | null {
  // fallow-ignore-next-line code-duplication
  const value = instance[key];
  try {
    const raw = typeof value === "function" ? value.call(instance) : value;
    const numberValue = Number(raw);
    return Number.isFinite(numberValue) ? numberValue : null;
  } catch {
    return null;
  }
}

export function buildAnimeDirectTimelineAdapter(
  registry: unknown,
  rootId?: string | null,
): DirectTimelineAdapter | null {
  const entries = collectAnimeEntries(registry);
  if (entries.length === 0) return null;

  const selected =
    rootId != null
      ? (entries.find((entry) => entry.id === rootId) ?? entries[entries.length - 1])
      : entries[entries.length - 1];
  if (!selected) return null;

  const instance = selected.instance;
  let lastSeconds = 0;
  return {
    duration: () => {
      const durationMs = readAnimeDurationMs(instance);
      return durationMs == null ? 0 : durationMs / 1000;
    },
    time: () => lastSeconds,
    seek: (timeInSeconds: number) => {
      lastSeconds = Math.max(0, Number(timeInSeconds) || 0);
      const seek = instance.seek;
      return typeof seek === "function" ? seek.call(instance, lastSeconds * 1000) : undefined;
    },
    play: () => {
      const play = instance.play;
      return typeof play === "function" ? play.call(instance) : undefined;
    },
    pause: () => {
      const pause = instance.pause;
      return typeof pause === "function" ? pause.call(instance) : undefined;
    },
  };
}
