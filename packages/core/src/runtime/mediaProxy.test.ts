// fallow-ignore-file code-duplication
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

  it("marks a capture page's copy request, and only a capture page's", async () => {
    const page = createVideo("/page.mp4");
    swapToProxy(page, HEVC_ENTRY, "proactive");
    await settle();
    const path = window.location.pathname;
    window.history.replaceState(null, "", `${path}?hf-capture=1`);
    try {
      const capture = createVideo("/capture.mp4");
      swapToProxy(capture, HEVC_ENTRY, "proactive");
      await settle();
      expect(new URL(capture.src).searchParams.get("hf-capture")).toBe("1");
      expect(new URL(page.src).searchParams.has("hf-capture")).toBe(false);
      expect(isProxied(page)).toBe(true);
    } finally {
      window.history.replaceState(null, "", path);
    }
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

function showingFrames(el: HTMLVideoElement, playing: boolean): void {
  Object.defineProperty(el, "videoWidth", { value: 1080, configurable: true });
  Object.defineProperty(el, "readyState", { value: 4, configurable: true });
  Object.defineProperty(el, "paused", { value: !playing, configurable: true });
}

describe("when a served copy replaces what the element plays", () => {
  it("waits for the next pause while the original plays its own frames", async () => {
    const el = createVideo("/video.mp4");
    showingFrames(el, true);

    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();
    expect(el.getAttribute("src")).toBe("/video.mp4");

    showingFrames(el, false);
    el.dispatchEvent(new Event("pause"));
    expect(proxyVariant(el)).toBe("h264");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("swaps at once when the playing element shows nothing", async () => {
    const el = createVideo("/video.mp4");
    Object.defineProperty(el, "paused", { value: false, configurable: true });

    swapToProxy(el, HEVC_ENTRY, "proactive");
    await settle();

    expect(proxyVariant(el)).toBe("h264");
  });

  it("holds no jump once the original shows its own frames", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202, headers: { "Retry-After": "2" } })),
    );
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    let jumped = false;
    void waitForSeekCompletion().then(() => (jumped = true));

    await vi.advanceTimersByTimeAsync(100);
    expect(jumped).toBe(false);
    showingFrames(el, true);
    el.dispatchEvent(new Event("loadeddata"));
    await vi.advanceTimersByTimeAsync(0);
    expect(jumped).toBe(true);
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

  it("asks only once the host says how large it shows the frame, for that size", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    await settle();
    expect(fetch).not.toHaveBeenCalled();

    // A 1080x1920 stage at half size on a 2x screen is 1080x1920 device pixels.
    setProxyDisplayScale(0.5);
    await settle();
    expect(boxOf(el)).toBe("1448x2048");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(el.src);
  });

  it("measures a video scaled past the stage by its own box", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(2160, 3840);
    setProxyDisplayScale(0.5);
    await settle();
    expect(boxOf(el)).toBe("2896x4096");
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
    expect(boxOf(el)).toBe("2896x4096");
    expect(el.load).toHaveBeenCalledTimes(2);

    setProxyDisplayScale(0.25);
    await settle();
    expect(boxOf(el)).toBe("2896x4096");
    expect(el.load).toHaveBeenCalledTimes(2);
  });

  it("moves a playing copy to a larger one only at the next pause", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    setProxyDisplayScale(0.5);
    await settle();
    showingFrames(el, true);

    setProxyDisplayScale(1);
    await settle();
    expect(boxOf(el)).toBe("1448x2048");

    showingFrames(el, false);
    el.dispatchEvent(new Event("pause"));
    expect(boxOf(el)).toBe("2896x4096");
  });

  it("loads the newest size asked for, even when an older, smaller copy is served first", async () => {
    const { el, setProxyDisplayScale } = await framedVideo(1080, 1920);
    setProxyDisplayScale(0.5);
    await settle();

    setProxyDisplayScale(1);
    setProxyDisplayScale(2);
    await settle();
    expect(boxOf(el)).toBe("5792x8192");
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
    expect(boxOf(el)).toBe("2896x4096");
  });
});

describe("seek copies for videos whose keyframes are far apart", () => {
  const SOURCE_4K = { width: 3840, height: 2160 };
  // Fresh modules: the copy queue and the playback state are module state.
  let runtime: typeof import("./mediaProxy");
  let dispatch: typeof import("./adapters/seek-dispatch");
  let playhead = 0;
  let playing = false;
  let clips: Array<{ el: HTMLMediaElement; start: number; end: number }> = [];
  const host = { playhead: () => playhead, playing: () => playing, clips: () => clips };

  beforeEach(async () => {
    vi.resetModules();
    runtime = await import("./mediaProxy");
    dispatch = await import("./adapters/seek-dispatch");
    playhead = 0;
    playing = false;
    clips = [];
    window.__HF_MEDIA_CODEC_MAP__ = {};
    for (const [side, value] of [
      ["clientWidth", 640],
      ["clientHeight", 360],
    ] as const) {
      Object.defineProperty(document.documentElement, side, { configurable: true, value });
    }
  });

  function sparseClip(src: string, start: number, source = SOURCE_4K): HTMLVideoElement {
    window.__HF_MEDIA_CODEC_MAP__![src] = { ...H264_ENTRY, seekHostile: true, ...source };
    const el = createVideo(src);
    el.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
    clips.push({ el, start, end: start + 10 });
    return el;
  }

  const copiesAskedFor = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([href]) => new URL(String(href)))
      .filter((url) => url.searchParams.has("hf-proxy"))
      .map((url) => `${url.pathname} ${url.searchParams.get("hf-proxy-box")}`);

  const playbackPosts = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([href]) => String(href).endsWith("/playback"))
      .map(([, init]) => JSON.parse(String(init?.body)).playing);

  it("copies every sparse video one at a time, nearest the playhead first, at min(source, shown)", async () => {
    sparseClip("/far.mp4", 0, { width: 320, height: 180 });
    const near = sparseClip("/near.mp4", 30);
    sparseClip("/next.mp4", 50);
    playhead = 35;

    runtime.startSeekCopies(host);
    await settle();

    expect(copiesAskedFor()).toEqual([
      "/near.mp4 724x362",
      "/next.mp4 724x362",
      "/far.mp4 362x256",
    ]);
    expect(isProxied(near)).toBe(true);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("re-picks the nearest clip before each copy, so a jump re-orders the rest", async () => {
    sparseClip("/start.mp4", 0);
    sparseClip("/middle.mp4", 30);
    sparseClip("/end.mp4", 60);
    playhead = 32;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        playhead = 65;
        return new Response("x", { status: 206 });
      }),
    );

    runtime.startSeekCopies(host);
    await settle();

    expect(copiesAskedFor().map((ask) => ask.split(" ")[0])).toEqual([
      "/middle.mp4",
      "/end.mp4",
      "/start.mp4",
    ]);
  });

  it("starts no copy while playing, tells the server, and resumes on pause", async () => {
    sparseClip("/sparse.mp4", 0);
    playing = true;

    runtime.startSeekCopies(host);
    runtime.noteSeekCopyPlayback(true);
    await settle();
    expect(copiesAskedFor()).toEqual([]);
    expect(playbackPosts()).toEqual([true]);

    playing = false;
    runtime.noteSeekCopyPlayback(false);
    await settle();
    expect(playbackPosts()).toEqual([true, false]);
    expect(copiesAskedFor()).toEqual(["/sparse.mp4 724x362"]);
  });

  it("drops a copy picked just before playback started, and asks for it after the pause", async () => {
    sparseClip("/sparse.mp4", 0);

    runtime.startSeekCopies(host);
    playing = true;
    runtime.noteSeekCopyPlayback(true);
    await settle();
    expect(copiesAskedFor()).toEqual([]);

    playing = false;
    runtime.noteSeekCopyPlayback(false);
    await settle();
    expect(copiesAskedFor()).toEqual(["/sparse.mp4 724x362"]);
  });

  it("keeps telling the server it plays, so a closed preview cannot hold copies forever", async () => {
    vi.useFakeTimers();
    sparseClip("/sparse.mp4", 0);
    playing = true;
    runtime.startSeekCopies(host);

    runtime.noteSeekCopyPlayback(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playbackPosts()).toEqual([true, true, true]);

    playing = false;
    runtime.noteSeekCopyPlayback(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(playbackPosts()).toEqual([true, true, true, false]);
  });

  it("never holds a jump while a copy is being made", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202, headers: { "Retry-After": "2" } })),
    );
    const el = sparseClip("/sparse.mp4", 0);
    runtime.startSeekCopies(host);
    let jumped = false;
    void dispatch.waitForSeekCompletion().then(() => (jumped = true));

    await vi.advanceTimersByTimeAsync(0);
    expect(copiesAskedFor()).toHaveLength(1);
    expect(jumped).toBe(true);
    expect(el.getAttribute("src")).toBe("/sparse.mp4");
  });

  it("keeps a playing original until it pauses", async () => {
    const el = sparseClip("/sparse.mp4", 0);
    showingFrames(el, true);

    runtime.startSeekCopies(host);
    await settle();
    expect(copiesAskedFor()).toHaveLength(1);
    expect(isProxied(el)).toBe(false);

    Object.defineProperty(el, "paused", { value: true, configurable: true });
    el.dispatchEvent(new Event("pause"));
    expect(isProxied(el)).toBe(true);
  });

  it("copies a video that joins later once its metadata arrives", async () => {
    sparseClip("/first.mp4", 0);
    runtime.startSeekCopies(host);
    await settle();
    expect(copiesAskedFor()).toHaveLength(1);
    const late = sparseClip("/late.mp4", 20);
    Object.defineProperty(late, "videoWidth", { value: 3840, configurable: true });

    runtime.handleMetadataForProxy(late);
    await settle();

    expect(copiesAskedFor().map((ask) => ask.split(" ")[0])).toEqual(["/first.mp4", "/late.mp4"]);
  });

  it("does nothing while exporting", async () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    sparseClip("/sparse.mp4", 0);

    runtime.startSeekCopies(host);
    runtime.noteSeekCopyPlayback(true);
    await settle();

    expect(fetch).not.toHaveBeenCalled();
  });
});
