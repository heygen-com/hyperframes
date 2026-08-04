import { TIMELINE_VIEWPORT_BUDGETS as BUDGETS } from "./timelineViewportBudgets";

/**
 * One media resolution layer for the Studio document.
 *
 * Generalises the `peaksCache` / `decodeInFlight` pair `AudioWaveform` already
 * had: in-flight dedup keyed by normalized URL, a bounded LRU, an expiring
 * failure record, and a concurrency cap. The two thumbnail extractors gain what
 * neither had, and `mediaProbe` retires its never-expiring `failed` Set.
 *
 * Scope: this only dedups traffic issued *by the Studio document*. Requests
 * issued by `<audio src>` / `<video src>` inside the preview iframe are not
 * reachable from here and are not affected.
 */

/** Publish an intermediate value to everyone waiting on the same key. */
export type Emit<T> = (partial: T) => void;

/** Does the actual work. `emit` is optional progress; the resolved value wins. */
export type Produce<T> = (emit: Emit<T>) => Promise<T>;

export interface MediaResolverConfig {
  /** LRU bound on resolved values (and, separately, on failure records). */
  maxEntries: number;
  /** Max `produce` calls running at once. */
  concurrency: number;
  /** How long a rejected key stays rejected before it is retried. */
  failureTtlMs: number;
}

export interface MediaResolver<T> {
  resolve(key: string, produce: Produce<T>, onPartial?: Emit<T>): Promise<T>;
  /** Resolved value if cached (marks it most-recently-used), else undefined. */
  peek(key: string): T | undefined;
  /** True while a past failure for `key` is still inside the TTL. */
  hasFreshFailure(key: string): boolean;
  /** Test seam — drops every cache, failure record and partial. */
  reset(): void;
}

/** Absolute URL so `./a.mp4` and `/dir/a.mp4` share one cache entry. */
export function normalizeMediaUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

/**
 * Cache key. Extra parts matter: `VideoThumbnail` derives its timestamps from
 * the *clip's* duration, so two clips trimmed differently from one source need
 * different frames and must not share an entry.
 */
export function mediaCacheKey(src: string, ...parts: Array<string | number>): string {
  return [normalizeMediaUrl(src), ...parts].join("|");
}

function trim<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function createMediaResolver<T>(config: MediaResolverConfig): MediaResolver<T> {
  const { maxEntries, concurrency, failureTtlMs } = config;
  // Map iteration order is insertion order, so re-inserting on read gives LRU.
  const cache = new Map<string, T>();
  const failures = new Map<string, { at: number; error: unknown }>();
  const inflight = new Map<string, Promise<T>>();
  const subscribers = new Map<string, Set<Emit<T>>>();
  const partials = new Map<string, T>();

  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active++;
      return;
    }
    // The releasing slot is handed straight over, so `active` stays capped.
    await new Promise<void>((r) => waiters.push(r));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };

  function peek(key: string): T | undefined {
    const value = cache.get(key);
    if (value === undefined) return undefined;
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function hasFreshFailure(key: string): boolean {
    const failure = failures.get(key);
    if (!failure) return false;
    if (Date.now() - failure.at < failureTtlMs) return true;
    failures.delete(key);
    return false;
  }

  function resolve(key: string, produce: Produce<T>, onPartial?: Emit<T>): Promise<T> {
    const cached = peek(key);
    if (cached !== undefined) return Promise.resolve(cached);

    if (hasFreshFailure(key)) return Promise.reject(failures.get(key)?.error);

    const pending = inflight.get(key);
    if (pending) {
      if (onPartial) {
        subscribers.get(key)?.add(onPartial);
        const partial = partials.get(key);
        if (partial !== undefined) onPartial(partial);
      }
      return pending;
    }

    const listeners = new Set<Emit<T>>();
    if (onPartial) listeners.add(onPartial);
    subscribers.set(key, listeners);

    const emit: Emit<T> = (partial) => {
      partials.set(key, partial);
      for (const listener of listeners) listener(partial);
    };

    const promise = (async () => {
      await acquire();
      try {
        const value = await produce(emit);
        cache.delete(key);
        cache.set(key, value);
        trim(cache, maxEntries);
        return value;
      } catch (error) {
        failures.set(key, { at: Date.now(), error });
        trim(failures, maxEntries);
        throw error;
      } finally {
        release();
        inflight.delete(key);
        subscribers.delete(key);
        partials.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  return {
    resolve,
    peek,
    hasFreshFailure,
    reset() {
      cache.clear();
      failures.clear();
      inflight.clear();
      subscribers.clear();
      partials.clear();
      // Also free the concurrency slots — abandoned in-flight work from a
      // previous test would otherwise hold them forever.
      active = 0;
      waiters.length = 0;
    },
  };
}

export interface VideoFrames {
  /** JPEG data URLs, one per requested timestamp, in order. */
  frames: string[];
  /** Source display aspect ratio (width / height). */
  aspect: number;
}

interface ExtractOptions {
  /** Canvas height in px. Omit to capture at the source's native height. */
  frameHeight?: number;
  /** JPEG quality passed to `toDataURL`. */
  quality: number;
}

const DEFAULT_ASPECT = 16 / 9;

/**
 * The single client-side frame extractor: one hidden `<video>` + `<canvas>`,
 * seeked to each timestamp in turn. `timestamps` may be a function when the
 * choice depends on the source's own duration (known only after metadata).
 *
 * Rejects on a load error or a tainted canvas so the caller's resolver records
 * an expiring failure instead of retrying forever.
 */
export function extractVideoFrames(
  src: string,
  timestamps: number[] | ((sourceDuration: number) => number[]),
  options: ExtractOptions,
  emit?: Emit<VideoFrames>,
): Promise<VideoFrames> {
  return new Promise<VideoFrames>((resolveFrames, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("mediaResolver: no 2d canvas context"));
      return;
    }

    const frames: string[] = [];
    let stops: number[] = Array.isArray(timestamps) ? timestamps : [];
    let aspect = DEFAULT_ASPECT;
    let index = 0;
    let settled = false;

    const teardown = () => {
      video.src = "";
      video.load();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      teardown();
      resolveFrames({ frames, aspect });
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      teardown();
      reject(error);
    };
    const seekNext = () => {
      if (settled) return;
      const next = stops[index];
      if (next === undefined) {
        finish();
        return;
      }
      video.currentTime = next;
    };

    video.addEventListener("loadedmetadata", () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        aspect = video.videoWidth / video.videoHeight;
        canvas.height = options.frameHeight ?? video.videoHeight;
        canvas.width = Math.round(canvas.height * aspect);
      }
      if (!Array.isArray(timestamps)) stops = timestamps(video.duration);
      seekNext();
    });

    video.addEventListener("seeked", () => {
      if (settled) return;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", options.quality));
      } catch (error) {
        // An external video served without CORS headers taints the canvas and
        // toDataURL throws SecurityError. Stop rather than spin.
        fail(error);
        return;
      }
      emit?.({ frames: [...frames], aspect });
      index++;
      seekNext();
    });

    video.addEventListener("error", () => {
      fail(new Error(`mediaResolver: video load failed for ${src}`));
    });

    video.src = src;
    video.load();
  });
}

/** Frame strips and posters — one entry per `(source, timestamps)` pair. */
export const thumbnailResolver = createMediaResolver<VideoFrames>({
  maxEntries: BUDGETS.thumbnailCacheEntries,
  concurrency: BUDGETS.concurrentVideoDecodes,
  failureTtlMs: BUDGETS.metadataFailureTtlMs,
});

/** Decoded audio peaks. */
export const waveformResolver = createMediaResolver<number[]>({
  maxEntries: BUDGETS.waveformCacheEntries,
  concurrency: BUDGETS.concurrentVideoDecodes,
  failureTtlMs: BUDGETS.metadataFailureTtlMs,
});

export interface MediaProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Container/track metadata probes — header reads, so a wider lane. */
export const metadataResolver = createMediaResolver<MediaProbeResult>({
  maxEntries: BUDGETS.metadataRegistryEntries,
  concurrency: BUDGETS.concurrentMetadataJobs,
  failureTtlMs: BUDGETS.metadataFailureTtlMs,
});
