import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasMediaSyncStateForTest,
  syncRuntimeMedia as syncRuntimeMediaWithDuration,
} from "./media";
// Most cases predate the terminal rule and run with no composition end to hold at.
const syncRuntimeMedia = (
  params: Omit<Parameters<typeof syncRuntimeMediaWithDuration>[0], "getCompositionDuration"> &
    Partial<Pick<Parameters<typeof syncRuntimeMediaWithDuration>[0], "getCompositionDuration">>,
) => syncRuntimeMediaWithDuration({ getCompositionDuration: () => 0, ...params });

import {
  deriveCodecMapKey,
  handleErrorForProxy,
  describeVideoSources,
  handleMetadataForProxy,
  maybeProxyProactively,
  swapToProxy,
  type MediaCodecMapEntry,
} from "./mediaProxy";

vi.mock("./bridge", () => ({
  postRuntimeMessage: vi.fn(),
}));

import { postRuntimeMessage } from "./bridge";
import { resetSeekDispatchState, waitForSeekCompletion } from "./adapters/seek-dispatch";

const postRuntimeMessageMock = vi.mocked(postRuntimeMessage);

const HEVC_ENTRY: MediaCodecMapEntry = {
  codecName: "hevc",
  browserHostile: true,
  representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
};

const H264_ENTRY: MediaCodecMapEntry = {
  codecName: "h264",
  browserHostile: false,
  representativeMime: 'video/mp4; codecs="avc1.640028"',
};

function createVideo(src: string): HTMLVideoElement {
  const el = document.createElement("video");
  el.src = src;
  el.load = vi.fn();
  document.body.appendChild(el);
  return el;
}

function createAudio(src: string): HTMLAudioElement {
  const el = document.createElement("audio");
  el.src = src;
  el.load = vi.fn();
  document.body.appendChild(el);
  return el;
}

function stubCanPlayType(el: HTMLVideoElement, result: string): void {
  el.canPlayType = vi.fn(() => result) as unknown as HTMLVideoElement["canPlayType"];
}

function proxyVariant(el: HTMLMediaElement): string | null {
  return new URL(el.src, document.baseURI).searchParams.get("hf-proxy");
}

function isProxied(el: HTMLMediaElement): boolean {
  return proxyVariant(el) !== null;
}

/** Lets a started swap ask for its copy (the default stub serves it) and finish. */
const settle = () => new Promise((resolveSettle) => setTimeout(resolveSettle, 0));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x", { status: 206 })),
  );
});

afterEach(() => {
  resetSeekDispatchState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  delete (window as { __HF_MEDIA_CODEC_MAP__?: unknown }).__HF_MEDIA_CODEC_MAP__;
  delete (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
});

describe("maybeProxyProactively", () => {
  it("rewrites src and calls load() before first load for a hostile, undecodable asset", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(true);
    expect(el.load).toHaveBeenCalledTimes(1);
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "runtime_media_proxy_fallback" }),
    );
  });

  it("matches codec-map paths across case and Unicode normalization differences", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/assets/Caf\u00e9.MP4": HEVC_ENTRY };
    const el = createVideo("/assets/cafe\u0301.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(true);
  });

  it("does not guess when two codec-map paths collide after normalization", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/assets/CLIP.mp4": HEVC_ENTRY,
      "/assets/clip.MP4": H264_ENTRY,
    };
    const el = createVideo("/assets/Clip.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
  });

  it("does not swap when canPlayType reports probably/maybe despite a hostile map entry", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "probably");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("swaps when hostile and representativeMime is null (no canPlayType check possible)", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/video.mp4": {
        codecName: "prores",
        browserHostile: true,
        representativeMime: null,
      },
    };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "probably"); // should not even be consulted

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(true);
  });

  it("does not swap a non-hostile (browser-safe) map entry", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("is a no-op in render mode even for a hostile entry", async () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the codec map global is absent", async () => {
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
  });

  it("never swaps an <audio> element even with a hostile-container src", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createAudio("/video.mp4");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("swaps an alpha-bearing hostile entry to a VP8 proxy", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/video.mov": {
        codecName: "prores",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: true,
      },
    };
    const el = createVideo("/video.mov");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(proxyVariant(el)).toBe("vp8");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the render-frame sibling image signals render mode", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    el.id = "clip-1";
    const injected = document.createElement("img");
    injected.id = "__render_frame_clip-1__";
    document.body.appendChild(injected);
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });
});

describe("handleMetadataForProxy (reactive trigger)", () => {
  function markZeroWidth(el: HTMLVideoElement): void {
    Object.defineProperty(el, "videoWidth", { value: 0, configurable: true });
  }

  it("swaps once when videoWidth is 0 for a same-origin local video absent from the (present) map — unlisted-asset rescue", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(true);
    expect(proxyVariant(el)).toBe("auto");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("never swaps when the codec map global is absent (opt-out surface serves no proxies)", async () => {
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("swaps a mapped alpha entry to a VP8 proxy", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/video.mov": {
        codecName: "prores",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: true,
      },
    };
    const el = createVideo("/video.mov");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(proxyVariant(el)).toBe("vp8");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("does not proxy a mapped browser-safe codec on the metadata path", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "browser_safe_codec" }),
      }),
    );
  });

  it("a second zero-width metadata event does not loop (no second swap)", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();
    handleMetadataForProxy(el);
    await settle();

    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("does nothing when videoWidth is non-zero", async () => {
    const el = createVideo("/video.mp4");
    Object.defineProperty(el, "videoWidth", { value: 640, configurable: true });

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("is a no-op in render mode", async () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
  });

  it("never swaps <audio>", async () => {
    const el = createAudio("/video.mp4");
    Object.defineProperty(el, "videoWidth", { value: 0, configurable: true });

    handleMetadataForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("cross-origin src with zero videoWidth: no swap attempted, diagnostic still emitted (with its console.info line)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("https://cdn.example.com/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    await settle();

    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "cross_origin" }),
      }),
    );
    // The console line mirrors the fallback line's shape: stable code token +
    // reason + src, so checkBrowser.ts's scraper can surface it.
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line = String(infoSpy.mock.calls[0]?.[0]);
    expect(line).toContain("runtime_media_proxy_unavailable");
    expect(line).toContain("cross_origin");
    expect(line).toContain("https://cdn.example.com/video.mp4");
  });

  it("resolves a ../-traversing sub-composition src (already rewritten to an absolute, prefixed URL) via longest-suffix map matching", async () => {
    const base = document.createElement("base");
    base.href = `${window.location.origin}/api/projects/proj1/preview/`;
    document.head.appendChild(base);
    window.__HF_MEDIA_CODEC_MAP__ = { "/assets/video.mp4": HEVC_ENTRY };

    // Mirrors what compositionLoader.ts's rewriteRuntimeAssetPath produces for
    // a `../assets/video.mp4` src authored from a nested sub-composition: an
    // absolute URL resolved against the sub-composition's own (prefixed) URL.
    const el = createVideo(`${window.location.origin}/api/projects/proj1/preview/assets/video.mp4`);
    expect(deriveCodecMapKey(el)).toBe("/api/projects/proj1/preview/assets/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);
    await settle();

    expect(isProxied(el)).toBe(true);
  });
});

describe("handleErrorForProxy (tertiary trigger)", () => {
  it("swaps once on an error event for a zero-stream (video-only hostile) file unlisted in the (present) map", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(true);
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("never swaps when the codec map global is absent (opt-out surface serves no proxies)", async () => {
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("does not swap a mapped browser-SAFE entry that errors (corrupt file — proxying can't help); diagnoses instead", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "browser_safe_codec" }),
      }),
    );
  });

  it("never swaps <audio> on error", async () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createAudio("/video.mp4");

    handleErrorForProxy(el);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("the proxy URL itself erroring: no second swap, diagnostic reports the failure instead", async () => {
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();
    expect(el.load).toHaveBeenCalledTimes(1);
    postRuntimeMessageMock.mockClear();

    handleErrorForProxy(el);
    await settle();

    expect(el.load).toHaveBeenCalledTimes(1); // no second load()/swap
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "proxy_playback_failed" }),
      }),
    );
  });
});

describe("swapToProxy", () => {
  it("does not poison swap state when the source URL is malformed", async () => {
    const el = createVideo("/video.mp4");
    Object.defineProperty(el, "currentSrc", {
      value: "http://[",
      configurable: true,
    });

    swapToProxy(el, HEVC_ENTRY, "reactive");
    await settle();

    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "invalid_source_url" }),
      }),
    );
  });
  it("evicts per-source sync state so the swapped element is treated as a first tick", async () => {
    const el = createVideo("/video.mp4");
    // Populate sync state as a real active-clip tick would.
    syncRuntimeMedia({
      clips: [
        {
          el,
          start: 0,
          mediaStart: 0,
          duration: 10,
          end: 10,
          volume: null,
          playbackRate: 1,
          loop: false,
          sourceDuration: null,
        },
      ],
      timeSeconds: 1,
      playing: false,
      playbackRate: 1,
    });
    expect(hasMediaSyncStateForTest(el)).toBe(true);

    swapToProxy(el, HEVC_ENTRY, "reactive");
    await settle();

    expect(hasMediaSyncStateForTest(el)).toBe(false);
  });

  it("preserves existing query strings when appending hf-proxy", async () => {
    const el = createVideo("/video.mp4?v=2");

    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();

    const url = new URL(el.src, document.baseURI);
    expect(url.searchParams.get("v")).toBe("2");
    expect(url.searchParams.get("hf-proxy")).toBe("h264");
  });

  it("emits the diagnostic and a single console.info line exactly once per element", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = createVideo("/video.mp4");

    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();
    swapToProxy(el, HEVC_ENTRY, "proactive"); // idempotent re-call, e.g. from another trigger
    await settle();

    const fallbackCalls = postRuntimeMessageMock.mock.calls.filter(
      ([msg]) => (msg as { code?: string }).code === "runtime_media_proxy_fallback",
    );
    expect(fallbackCalls).toHaveLength(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second call for an already-swapped element does not re-swap", async () => {
    const el = createVideo("/video.mp4");

    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();
    const srcAfterFirstSwap = el.src;
    swapToProxy(el, HEVC_ENTRY, "reactive");
    await settle();

    expect(el.src).toBe(srcAfterFirstSwap);
    expect(el.load).toHaveBeenCalledTimes(1);
  });
});

describe("waiting for the proxy copy", () => {
  function stubProxyRoute(...statuses: number[]) {
    const route = vi.fn(async () => {
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      const retry = status === 202 || status === 503 ? { "Retry-After": "2" } : undefined;
      return new Response(status === 206 ? "x" : null, { status, headers: retry });
    });
    vi.stubGlobal("fetch", route);
    return route;
  }

  it("keeps the original src until the copy is served, so no reader of src gets a copy still being made", async () => {
    vi.useFakeTimers();
    const route = stubProxyRoute(202, 503, 206);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(el.getAttribute("src")).toBe("/video.mp4");
    expect(el.load).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(route).toHaveBeenCalledTimes(3);
    expect(route).toHaveBeenCalledWith(
      expect.stringContaining("hf-proxy=h264"),
      expect.objectContaining({ headers: { Range: "bytes=0-0" } }),
    );
    expect(proxyVariant(el)).toBe("h264");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("asks for its copy ahead of the rest only while the video is at the playhead", async () => {
    vi.useFakeTimers();
    const route = stubProxyRoute(202, 202, 206);
    const el = createVideo("/video.mp4");
    const tickAt = (timeSeconds: number) =>
      syncRuntimeMedia({
        clips: [
          {
            el,
            start: 0,
            mediaStart: 0,
            duration: 10,
            end: 10,
            volume: null,
            playbackRate: 1,
            loop: false,
            sourceDuration: null,
          },
        ],
        timeSeconds,
        playing: false,
        playbackRate: 1,
      });
    tickAt(1);
    swapToProxy(el, HEVC_ENTRY, "proactive");
    await vi.advanceTimersByTimeAsync(0);
    expect(route.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ headers: { Range: "bytes=0-0", "X-HF-Proxy-Priority": "1" } }),
    );

    tickAt(20);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(route.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ headers: { Range: "bytes=0-0" } }),
    );
  });

  it("ignores the original's own metadata and error while the copy is being made", async () => {
    vi.useFakeTimers();
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const route = stubProxyRoute(202, 206);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    postRuntimeMessageMock.mockClear();
    Object.defineProperty(el, "videoWidth", { value: 0 });

    handleMetadataForProxy(el);
    handleErrorForProxy(el);
    await vi.advanceTimersByTimeAsync(0);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(isProxied(el)).toBe(true);
  });

  it("diagnoses a copy that cannot be made once, after a few asks, and the element keeps its original", async () => {
    vi.useFakeTimers();
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const route = stubProxyRoute(502);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    postRuntimeMessageMock.mockClear();
    Object.defineProperty(el, "videoWidth", { value: 0 });
    handleMetadataForProxy(el);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(isProxied(el)).toBe(false);
    expect(route).toHaveBeenCalledTimes(4);
    expect(postRuntimeMessageMock).toHaveBeenCalledTimes(1);
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "proxy_playback_failed" }),
      }),
    );
  });

  it("asks again after a dropped request", async () => {
    vi.useFakeTimers();
    const route = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response("x", { status: 206 }));
    vi.stubGlobal("fetch", route);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(route).toHaveBeenCalledTimes(2);
    expect(isProxied(el)).toBe(true);
  });

  it("asks again after a transient error answer", async () => {
    vi.useFakeTimers();
    const route = stubProxyRoute(500, 206);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(route).toHaveBeenCalledTimes(2);
    expect(isProxied(el)).toBe(true);
  });

  it("holds frame captures until a served copy shows its first frame", async () => {
    vi.useFakeTimers();
    stubProxyRoute(206);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    let captured = false;
    void waitForSeekCompletion().then(() => (captured = true));

    await vi.advanceTimersByTimeAsync(100);
    expect(isProxied(el)).toBe(true);
    expect(captured).toBe(false);
    el.dispatchEvent(new Event("loadeddata"));
    await vi.advanceTimersByTimeAsync(0);
    expect(captured).toBe(true);
  });

  it("holds frame captures for a copy still being made no longer than a loading video", async () => {
    vi.useFakeTimers();
    stubProxyRoute(202);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    let captured = false;
    void waitForSeekCompletion().then(() => (captured = true));

    await vi.advanceTimersByTimeAsync(4_900);
    expect(captured).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(captured).toBe(true);
    expect(isProxied(el)).toBe(false);
  });

  it("stops waiting when the element leaves the document", async () => {
    vi.useFakeTimers();
    const route = stubProxyRoute(202);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    postRuntimeMessageMock.mockClear();
    await vi.advanceTimersByTimeAsync(0);
    el.remove();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(route).toHaveBeenCalledTimes(1);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("keeps one wait for a new file even after the dropped wait for the old one wakes", async () => {
    vi.useFakeTimers();
    const asks: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (href: string) => {
        asks.push(new URL(href).pathname);
        return new Response(null, { status: 202, headers: { "Retry-After": "2" } });
      }),
    );
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    await vi.advanceTimersByTimeAsync(0);
    el.setAttribute("src", "/other.mp4");
    swapToProxy(el, HEVC_ENTRY, "reactive");
    await vi.advanceTimersByTimeAsync(2_100);
    swapToProxy(el, HEVC_ENTRY, "reactive");
    await vi.advanceTimersByTimeAsync(0);

    expect(asks.filter((path) => path === "/other.mp4")).toHaveLength(2);
  });

  it("drops a wait whose element was pointed at another file, and can proxy the new one", async () => {
    vi.useFakeTimers();
    const route = stubProxyRoute(202);
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    await vi.advanceTimersByTimeAsync(0);
    el.setAttribute("src", "/other.mp4");
    const newFile = stubProxyRoute(206);
    swapToProxy(el, HEVC_ENTRY, "reactive");
    await vi.advanceTimersByTimeAsync(0);
    expect(newFile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(route).toHaveBeenCalledTimes(1);
    expect(newFile, "the dropped wait asks no more").toHaveBeenCalledTimes(1);
    expect(new URL(el.src).pathname).toBe("/other.mp4");
    expect(isProxied(el)).toBe(true);
  });
});

describe("deriveCodecMapKey", () => {
  it("returns the decoded, query-stripped pathname for a same-origin src", () => {
    const el = createVideo("/assets/my%20clip.mp4?foo=bar");
    expect(deriveCodecMapKey(el)).toBe("/assets/my clip.mp4");
  });

  it("returns null for a cross-origin src", () => {
    const el = createVideo("https://cdn.example.com/video.mp4");
    expect(deriveCodecMapKey(el)).toBeNull();
  });

  it("returns null when there is no src", () => {
    const el = document.createElement("video");
    document.body.appendChild(el);
    expect(deriveCodecMapKey(el)).toBeNull();
  });
});

describe("a copy sized to how large the video shows", () => {
  // A framed document learns its on-screen scale from its host; load a module that is framed.
  async function framedVideo(width: number, height: number) {
    vi.resetModules();
    vi.spyOn(window, "parent", "get").mockReturnValue({} as Window);
    const { maybeProxyProactively, setProxyDisplayScale } = await import("./mediaProxy");
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");
    el.getBoundingClientRect = () => ({ width, height }) as DOMRect;
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1080,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 1920,
    });
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    maybeProxyProactively(el);
    return { el, setProxyDisplayScale };
  }

  const boxOf = (el: HTMLMediaElement) =>
    new URL(el.src, document.baseURI).searchParams.get("hf-proxy-box");

  it("names the lower levels at which a video would get a lighter copy", async () => {
    const { setProxyDisplayScale } = await framedVideo(1080, 1920);
    const { levelsWithLighterCopies } = await import("./mediaProxy");
    const facts = { width: 1080, height: 1920, bitDepth: 8, bitrate: 0 };
    window.__HF_MEDIA_SOURCE_FACTS__ = { "/video.mp4": facts };
    expect(levelsWithLighterCopies()).toEqual([]);

    setProxyDisplayScale(1);
    expect(levelsWithLighterCopies()).toEqual([0.25, 0.125]);

    window.__HF_MEDIA_SOURCE_FACTS__ = { "/video.mp4": { ...facts, bitDepth: 10 } };
    expect(levelsWithLighterCopies()).toEqual([0.5, 0.25, 0.125]);
    delete window.__HF_MEDIA_SOURCE_FACTS__;
  });

  it("asks only once the host says how large it shows the frame, for that size", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    await settle();
    expect(fetch).not.toHaveBeenCalled();

    // A 1080x1920 stage at half size on a 2x screen is 1080x1920 device pixels.
    setProxyDisplayScale(0.5);
    await settle();
    expect(boxOf(el)).toBe("1218x2048");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(el.src);
  });

  it("measures a video scaled past the stage by its own box", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(2160, 3840);
    setProxyDisplayScale(0.5);
    await settle();
    expect(boxOf(el)).toBe("2436x4096");
  });

  it("asks for the source-size copy when the host never says", async () => {
    vi.useFakeTimers();
    const { el } = await framedVideo(1080, 1920);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(isProxied(el)).toBe(true);
    expect(boxOf(el)).toBeNull();
  });

  it("moves to a larger copy when the video shows larger, and keeps it when it shrinks", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    setProxyDisplayScale(0.5);
    await settle();

    setProxyDisplayScale(1);
    setProxyDisplayScale(1);
    await settle();
    expect(boxOf(el)).toBe("2436x4096");
    expect(el.load).toHaveBeenCalledTimes(2);

    setProxyDisplayScale(0.25);
    await settle();
    expect(boxOf(el)).toBe("2436x4096");
    expect(el.load).toHaveBeenCalledTimes(2);
  });

  it("loads the newest size asked for, even when an older, smaller copy is served first", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    setProxyDisplayScale(0.5);
    await settle();

    setProxyDisplayScale(1);
    setProxyDisplayScale(2);
    await settle();
    expect(boxOf(el)).toBe("4870x8192");
    expect(el.load).toHaveBeenCalledTimes(2);
  });

  it("grows a first copy that was made while the frame grew", async () => {
    vi.useFakeTimers();
    let made = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        made
          ? new Response("x", { status: 206 })
          : new Response(null, { status: 202, headers: { "Retry-After": "2" } }),
      ),
    );
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    setProxyDisplayScale(0.5);
    await vi.advanceTimersByTimeAsync(0);
    setProxyDisplayScale(1);
    made = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(boxOf(el)).toBe("2436x4096");
  });
});

describe("preview quality: lighter copies of heavy files", () => {
  const HEAVY = { width: 3840, height: 2160, bitDepth: 8, bitrate: 10_000_000 };
  const LIGHT = { width: 1280, height: 720, bitDepth: 8, bitrate: 10_000_000 };

  // A framed page showing a 1920x1080 stage at full size on a 1x screen: a 2048x1218 box.
  async function stage(facts: Record<string, typeof HEAVY>, codecMap?: Record<string, unknown>) {
    vi.resetModules();
    vi.spyOn(window, "parent", "get").mockReturnValue({} as Window);
    const mod = await import("./mediaProxy");
    window.__HF_MEDIA_SOURCE_FACTS__ = facts;
    if (codecMap) window.__HF_MEDIA_CODEC_MAP__ = codecMap as never;
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 1080,
    });
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1);
    const bridge = await import("./bridge");
    const video = (src = "/video.mp4") => {
      const el = createVideo(src);
      stubCanPlayType(el, "probably");
      el.getBoundingClientRect = () => ({ width: 1920, height: 1080 }) as DOMRect;
      return el;
    };
    mod.setProxyDisplayScale(1);
    return { ...mod, video, posted: vi.mocked(bridge.postRuntimeMessage) };
  }

  const params = (el: HTMLMediaElement) => new URL(el.src, document.baseURI).searchParams;

  afterEach(() => {
    delete (window as { __HF_MEDIA_SOURCE_FACTS__?: unknown }).__HF_MEDIA_SOURCE_FACTS__;
  });

  it("changes nothing at full quality", async () => {
    const { video, setPreviewQuality, maybeProxyProactively } = await stage({
      "/video.mp4": HEAVY,
    });
    const el = video();
    maybeProxyProactively(el);
    setPreviewQuality(1);
    await settle();

    expect(isProxied(el)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swaps a heavy file Chrome can play to a copy at the shown box times the level", async () => {
    const { video, setPreviewQuality } = await stage({ "/video.mp4": HEAVY });
    const el = video();

    setPreviewQuality(0.5);
    await settle();

    expect(params(el).get("hf-proxy")).toBe("auto");
    expect(params(el).get("hf-proxy-box")).toBe("1024x724");
    expect(params(el).get("hf-proxy-light")).toBe("1");
  });

  it("leaves a file alone that is not heavy at that box", async () => {
    const { video, setPreviewQuality } = await stage({ "/video.mp4": LIGHT });
    const el = video();

    setPreviewQuality(0.5);
    await settle();

    expect(isProxied(el)).toBe(false);
  });

  it("puts the original back at full quality", async () => {
    const { video, setPreviewQuality } = await stage({ "/video.mp4": HEAVY });
    const el = video();
    setPreviewQuality(0.5);
    await settle();
    expect(isProxied(el)).toBe(true);

    setPreviewQuality(1);

    expect(el.getAttribute("src")).toBe("/video.mp4");
    expect(el.load).toHaveBeenCalledTimes(2);
  });

  it("lightens a video that appears after the level was lowered", async () => {
    const { video, setPreviewQuality, maybeProxyProactively } = await stage({
      "/video.mp4": HEAVY,
    });
    setPreviewQuality(0.25);
    const el = video();

    maybeProxyProactively(el);
    await settle();

    expect(params(el).get("hf-proxy-box")).toBe("512x362");
  });

  it("sizes the copy a file cannot play without by the level too, and resizes it as the level moves", async () => {
    const { video, setPreviewQuality, maybeProxyProactively } = await stage(
      { "/video.mp4": HEAVY },
      { "/video.mp4": HEVC_ENTRY },
    );
    const el = video();
    stubCanPlayType(el, "");
    maybeProxyProactively(el);
    await settle();
    expect(params(el).get("hf-proxy-box")).toBe("2048x1218");
    expect(params(el).has("hf-proxy-light")).toBe(false);

    setPreviewQuality(0.5);
    await settle();
    expect(params(el).get("hf-proxy-box")).toBe("1024x724");
    expect(params(el).has("hf-proxy-light")).toBe(false);

    setPreviewQuality(1);
    await settle();
    expect(params(el).get("hf-proxy-box")).toBe("2048x1218");
  });

  describe("reporting the copies", () => {
    const lastCopies = (posted: typeof postRuntimeMessageMock) =>
      posted.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "preview-copies")
        .at(-1);

    it("counts the copies wanted, with how far the making has got, and says none at full quality", async () => {
      vi.useFakeTimers();
      let reply = new Response(null, {
        status: 202,
        headers: { "Retry-After": "1", "X-HF-Proxy-Progress": "0.5" },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => reply.clone()),
      );
      const { video, setPreviewQuality, posted } = await stage({ "/video.mp4": HEAVY });
      video();

      setPreviewQuality(0.5);
      await vi.advanceTimersByTimeAsync(0);
      expect(lastCopies(posted)).toMatchObject({
        copies: { total: 1, ready: 0, failed: 0, progress: 0, error: null },
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(lastCopies(posted)).toMatchObject({ copies: { total: 1, ready: 0, progress: 0.5 } });

      reply = new Response("x", { status: 206 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(lastCopies(posted)).toMatchObject({
        copies: { total: 1, ready: 1, failed: 0, progress: 1, error: null },
      });

      setPreviewQuality(1);
      expect(lastCopies(posted)).toMatchObject({ copies: null });
    });

    it("reports a copy that could not be made, and asks again with the retry flag", async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("no", { status: 502 })),
      );
      const { video, setPreviewQuality, retryPreviewCopies, posted } = await stage({
        "/video.mp4": HEAVY,
      });
      const el = video();

      setPreviewQuality(0.5);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lastCopies(posted)).toMatchObject({
        copies: { total: 1, failed: 1, error: "failed" },
      });
      expect(isProxied(el)).toBe(false);

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("x", { status: 206 })),
      );
      retryPreviewCopies();
      await vi.advanceTimersByTimeAsync(2000);

      expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("hf-proxy-retry=1");
      expect(lastCopies(posted)).toMatchObject({ copies: { total: 1, ready: 1, failed: 0 } });
      expect(isProxied(el)).toBe(true);
    });
  });

  it("sends the retry flag on the first ask only, so a copy that fails again is not remade on every poll", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("no", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const { video, setPreviewQuality, retryPreviewCopies } = await stage({ "/video.mp4": HEAVY });
    video();
    setPreviewQuality(0.5);
    await vi.advanceTimersByTimeAsync(10_000);

    fetchMock.mockClear();
    retryPreviewCopies();
    await vi.advanceTimersByTimeAsync(10_000);

    const asked = fetchMock.mock.calls.map(([href]) => String(href));
    expect(asked.length).toBeGreaterThan(1);
    expect(asked[0]).toContain("hf-proxy-retry=1");
    expect(asked.slice(1).some((href) => href.includes("hf-proxy-retry"))).toBe(false);
  });

  it("ignores a level that is not one of the four", async () => {
    const { video, setPreviewQuality } = await stage({ "/video.mp4": HEAVY });
    const el = video();

    setPreviewQuality(0.7);
    await settle();

    expect(isProxied(el)).toBe(false);
  });
});

describe("describeVideoSources", () => {
  it("groups the videos by what they are, counting repeats and never naming a file", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/a.mp4": HEVC_ENTRY,
      "/b.mp4": HEVC_ENTRY,
      "/c.mp4": H264_ENTRY,
    };
    const facts = { width: 3840, height: 2160, bitDepth: 10, bitrate: 0 };
    window.__HF_MEDIA_SOURCE_FACTS__ = {
      "/a.mp4": facts,
      "/b.mp4": facts,
      "/c.mp4": { ...facts, width: 1920, height: 1080, bitDepth: 8 },
    };
    window.__HF_MEDIA_SOURCE_FACTS__["/c.mp4"] = {
      ...window.__HF_MEDIA_SOURCE_FACTS__["/c.mp4"],
      codec: "h264",
    };
    window.__HF_MEDIA_CODEC_MAP__ = { "/a.mp4": HEVC_ENTRY, "/b.mp4": HEVC_ENTRY };
    for (const src of ["/a.mp4", "/b.mp4", "/c.mp4", "/d.mp4"]) createVideo(src);

    expect(describeVideoSources()).toEqual([
      { codec: "hevc", width: 3840, height: 2160, bitDepth: 10, count: 2 },
      { codec: "h264", width: 1920, height: 1080, bitDepth: 8, count: 1 },
      { codec: "unknown", width: 0, height: 0, bitDepth: 0, count: 1 },
    ]);
    delete window.__HF_MEDIA_SOURCE_FACTS__;
  });
});
