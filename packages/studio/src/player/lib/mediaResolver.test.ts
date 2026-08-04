// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMediaResolver,
  extractVideoFrames,
  fetchMediaBytes,
  mediaBytesResolver,
  mediaCacheKey,
  type MediaResolver,
} from "./mediaResolver";
import { stubVideoExtraction } from "./mediaResolver.testHelpers";

/** Drain the microtask queue so queued `produce` calls have actually started. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A produce fn that counts calls and resolves only when told to. */
function deferredProducer<T>() {
  let calls = 0;
  const settlers: Array<{ resolve: (v: T) => void; reject: (e: unknown) => void }> = [];
  const produce = () => {
    calls++;
    return new Promise<T>((resolve, reject) => settlers.push({ resolve, reject }));
  };
  return {
    produce,
    settlers,
    get calls() {
      return calls;
    },
  };
}

interface ResolverOverrides<T> {
  maxEntries?: number;
  concurrency?: number;
  failureTtlMs?: number;
  maxBytes?: number;
  sizeOf?: (value: T) => number;
}

function makeResolver<T>(overrides: ResolverOverrides<T> = {}) {
  return createMediaResolver<T>({
    maxEntries: 64,
    concurrency: 8,
    failureTtlMs: 30_000,
    maxBytes: Number.POSITIVE_INFINITY,
    sizeOf: () => 0,
    ...overrides,
  });
}

describe("mediaCacheKey", () => {
  it("normalizes relative and absolute forms of one source to one key", () => {
    expect(mediaCacheKey("/a/clip.mp4")).toBe(mediaCacheKey(`${location.origin}/a/clip.mp4`));
  });

  it("keys on (src, duration), not src alone", () => {
    expect(mediaCacheKey("/a/clip.mp4", "strip", 5)).not.toBe(
      mediaCacheKey("/a/clip.mp4", "strip", 12),
    );
  });
});

describe("createMediaResolver", () => {
  let resolver: MediaResolver<string>;

  beforeEach(() => {
    resolver = makeResolver<string>();
  });

  it("seven consumers of one source at one duration produce ONE fetch", async () => {
    const src = deferredProducer<string>();
    const key = mediaCacheKey("/a/clip.mp4", "strip", 5);

    const results = Array.from({ length: 7 }, () => resolver.resolve(key, src.produce));
    expect(src.calls).toBe(0); // not started until the concurrency slot is taken
    await flush();
    expect(src.calls).toBe(1);

    src.settlers[0].resolve("frames");
    expect(await Promise.all(results)).toEqual(Array(7).fill("frames"));
    expect(src.calls).toBe(1);

    // An eighth consumer arriving after the fact is served from cache.
    expect(await resolver.resolve(key, src.produce)).toBe("frames");
    expect(src.calls).toBe(1);
  });

  it("two consumers at DIFFERENT durations get different frame sets", async () => {
    const calls: string[] = [];
    const produceFor = (label: string) => async () => {
      calls.push(label);
      return `frames:${label}`;
    };

    const short = await resolver.resolve(
      mediaCacheKey("/a/clip.mp4", "strip", 5),
      produceFor("5s"),
    );
    const long = await resolver.resolve(
      mediaCacheKey("/a/clip.mp4", "strip", 12),
      produceFor("12s"),
    );

    expect(short).toBe("frames:5s");
    expect(long).toBe("frames:12s");
    expect(calls).toEqual(["5s", "12s"]);
  });

  it("a request arriving mid-flight joins it and receives its partials", async () => {
    const key = mediaCacheKey("/a/clip.mp4", "strip", 5);
    let emitPartial: ((v: string) => void) | undefined;
    const src = deferredProducer<string>();

    const first: string[] = [];
    const firstPromise = resolver.resolve(
      key,
      (emit) => {
        emitPartial = emit;
        return src.produce();
      },
      (p) => first.push(p),
    );
    await flush();
    emitPartial!("frame-1");

    // Joiner: no second produce, and it is handed the latest partial at once.
    const late: string[] = [];
    const latePromise = resolver.resolve(key, src.produce, (p) => late.push(p));
    expect(src.calls).toBe(1);
    expect(late).toEqual(["frame-1"]);

    emitPartial!("frame-2");
    src.settlers[0].resolve("frame-final");

    expect(await firstPromise).toBe("frame-final");
    expect(await latePromise).toBe("frame-final");
    expect(first).toEqual(["frame-1", "frame-2"]);
    expect(late).toEqual(["frame-1", "frame-2"]);
  });

  it("does not break a later request after every consumer has gone away", async () => {
    const key = mediaCacheKey("/a/clip.mp4", "strip", 5);
    const src = deferredProducer<string>();

    // Consumers mount, then unmount without ever awaiting the result.
    void resolver.resolve(key, src.produce, () => {}).catch(() => {});
    void resolver.resolve(key, src.produce, () => {}).catch(() => {});
    await flush();
    src.settlers[0].resolve("frames");
    await flush();

    // A fresh consumer later gets the value with no extra work.
    expect(await resolver.resolve(key, src.produce)).toBe("frames");
    expect(src.calls).toBe(1);
  });

  describe("failure TTL", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries a failed resolution after the TTL rather than caching it forever", async () => {
      const ttlResolver = makeResolver<string>({ failureTtlMs: 30_000 });
      const key = mediaCacheKey("/a/broken.mp4");
      let calls = 0;
      const produce = async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return "recovered";
      };

      await expect(ttlResolver.resolve(key, produce)).rejects.toThrow("boom");
      expect(ttlResolver.hasFreshFailure(key)).toBe(true);

      // Inside the TTL: rejected without touching the network again.
      vi.advanceTimersByTime(29_000);
      await expect(ttlResolver.resolve(key, produce)).rejects.toThrow("boom");
      expect(calls).toBe(1);

      // Past the TTL: retried, and it succeeds.
      vi.advanceTimersByTime(2_000);
      expect(ttlResolver.hasFreshFailure(key)).toBe(false);
      await expect(ttlResolver.resolve(key, produce)).resolves.toBe("recovered");
      expect(calls).toBe(2);
    });
  });

  it("evicts the least-recently-used entry past the bound and refetches it later", async () => {
    const lru = makeResolver<string>({ maxEntries: 2 });
    const calls: string[] = [];
    const produceFor = (label: string) => async () => {
      calls.push(label);
      return label;
    };

    await lru.resolve("a", produceFor("a"));
    await lru.resolve("b", produceFor("b"));
    // Touch "a" so "b" becomes the least-recently-used of the two.
    expect(lru.peek("a")).toBe("a");
    await lru.resolve("c", produceFor("c"));

    expect(lru.peek("b")).toBeUndefined();
    expect(lru.peek("a")).toBe("a");
    expect(lru.peek("c")).toBe("c");

    // The evicted entry is refetched on the next request; the kept one is not.
    await lru.resolve("b", produceFor("b"));
    await lru.resolve("c", produceFor("c"));
    expect(calls).toEqual(["a", "b", "c", "b"]);
  });

  it("evicts past the byte bound even when the entry count is nowhere near it", async () => {
    // 100 entries allowed, but only ~3 of these fit in the byte bound.
    const bounded = makeResolver<string>({
      maxEntries: 100,
      maxBytes: 30,
      sizeOf: (value) => value.length,
    });
    const produceFor = (label: string) => async () => label.repeat(10); // 10 bytes

    await bounded.resolve("a", produceFor("a"));
    await bounded.resolve("b", produceFor("b"));
    await bounded.resolve("c", produceFor("c"));
    expect(bounded.peek("a")).toBe("a".repeat(10));

    // Fourth entry pushes bytes to 40 > 30: the least-recently-used goes, and
    // "a" survives despite being inserted first, because it was just touched.
    await bounded.resolve("d", produceFor("d"));
    expect(bounded.peek("b")).toBeUndefined();
    expect(bounded.peek("a")).toBe("a".repeat(10));
    expect(bounded.peek("c")).toBe("c".repeat(10));
    expect(bounded.peek("d")).toBe("d".repeat(10));
  });

  it("runs at most `concurrency` producers at once", async () => {
    const capped = makeResolver<string>({ concurrency: 2 });
    const src = deferredProducer<string>();

    const pending = ["k1", "k2", "k3", "k4", "k5"].map((k) => capped.resolve(k, src.produce));
    await flush();
    expect(src.calls).toBe(2);

    // Draining one slot admits exactly one more.
    src.settlers[0].resolve("one");
    await flush();
    expect(src.calls).toBe(3);

    src.settlers[1].resolve("two");
    src.settlers[2].resolve("three");
    await flush();
    expect(src.calls).toBe(5);

    src.settlers[3].resolve("four");
    src.settlers[4].resolve("five");
    await Promise.all(pending);
  });
});

describe("extractVideoFrames", () => {
  let createdVideos: HTMLVideoElement[];

  beforeEach(() => {
    createdVideos = stubVideoExtraction();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,A");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a partial per seek and resolves with every requested frame", async () => {
    const partials: number[] = [];
    const done = extractVideoFrames("/a/clip.mp4", [0.4, 1, 2], { quality: 0.6 }, (p) =>
      partials.push(p.frames.length),
    );
    const video = createdVideos.at(-1)!;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("seeked"));
    video.dispatchEvent(new Event("seeked"));

    const result = await done;
    expect(result.frames).toHaveLength(3);
    expect(partials).toEqual([1, 2, 3]);
  });

  it("derives timestamps from the source duration when given a function", async () => {
    const seeks: number[] = [];
    const done = extractVideoFrames("/a/clip.mp4", (d) => [d * 0.1], { quality: 0.7 });
    const video = createdVideos.at(-1)!;
    Object.defineProperty(video, "duration", { value: 30, configurable: true });
    let assigned = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => assigned,
      set: (v: number) => {
        assigned = v;
        seeks.push(v);
      },
    });

    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("seeked"));
    await done;
    expect(seeks).toEqual([3]);
  });

  it("rejects when the load errors so the caller records an expiring failure", async () => {
    const done = extractVideoFrames("/a/no-cors.mp4", [0.4], { quality: 0.6 });
    createdVideos.at(-1)!.dispatchEvent(new Event("error"));
    await expect(done).rejects.toThrow(/video load failed/);
  });

  it("rejects when the canvas is tainted", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
    });
    const done = extractVideoFrames("/a/no-cors.mp4", [0.4], { quality: 0.6 });
    const video = createdVideos.at(-1)!;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("seeked"));
    await expect(done).rejects.toThrow(/Tainted/);
  });
});

describe("fetchMediaBytes", () => {
  let fetches: string[];

  beforeEach(() => {
    mediaBytesResolver.reset();
    fetches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetches.push(String(url));
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mediaBytesResolver.reset();
  });

  it("downloads a source once however many consumers want its bytes", async () => {
    // The waveform decoder and the beat analyzer, on the same track.
    const [waveform, beats] = await Promise.all([
      fetchMediaBytes("/assets/track.mp3"),
      fetchMediaBytes("/assets/track.mp3"),
    ]);

    expect(fetches).toHaveLength(1);
    expect(waveform).toBe(beats);
  });

  it("shares the download across consumers that arrive later", async () => {
    await fetchMediaBytes("/assets/track.mp3");
    await fetchMediaBytes("/assets/track.mp3");

    expect(fetches).toHaveLength(1);
  });

  it("treats the same file spelled differently as one source", async () => {
    await fetchMediaBytes("/assets/track.mp3");
    await fetchMediaBytes("./assets/track.mp3");

    expect(fetches).toHaveLength(1);
  });

  it("keeps different sources apart", async () => {
    await fetchMediaBytes("/assets/a.mp3");
    await fetchMediaBytes("/assets/b.mp3");

    expect(fetches).toHaveLength(2);
  });

  it("rejects a non-2xx instead of caching an error page as media", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 404 })),
    );

    await expect(fetchMediaBytes("/assets/missing.mp3")).rejects.toThrow(/404/);
  });
});
