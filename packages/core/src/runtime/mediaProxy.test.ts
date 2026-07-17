import { afterEach, describe, expect, it, vi } from "vitest";
import { hasMediaSyncStateForTest, syncRuntimeMedia } from "./media";
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

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  delete (window as { __HF_MEDIA_CODEC_MAP__?: unknown }).__HF_MEDIA_CODEC_MAP__;
  delete (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
  vi.restoreAllMocks();
});

describe("maybeProxyProactively", () => {
  it("rewrites src and calls load() before first load for a hostile, undecodable asset", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(true);
    expect(el.load).toHaveBeenCalledTimes(1);
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "runtime_media_proxy_fallback" }),
    );
  });

  it("matches codec-map paths across case and Unicode normalization differences", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/assets/Caf\u00e9.MP4": HEVC_ENTRY };
    const el = createVideo("/assets/cafe\u0301.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(true);
  });

  it("does not guess when two codec-map paths collide after normalization", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {
      "/assets/CLIP.mp4": HEVC_ENTRY,
      "/assets/clip.MP4": H264_ENTRY,
    };
    const el = createVideo("/assets/Clip.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
  });

  it("does not swap when canPlayType reports probably/maybe despite a hostile map entry", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "probably");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("swaps when hostile and representativeMime is null (no canPlayType check possible)", () => {
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

    expect(isProxied(el)).toBe(true);
  });

  it("does not swap a non-hostile (browser-safe) map entry", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("is a no-op in render mode even for a hostile entry", () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the codec map global is absent", () => {
    const el = createVideo("/video.mp4");
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
  });

  it("never swaps an <audio> element even with a hostile-container src", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createAudio("/video.mp4");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("swaps an alpha-bearing hostile entry to a VP9 proxy", () => {
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

    expect(proxyVariant(el)).toBe("vp9");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the render-frame sibling image signals render mode", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": HEVC_ENTRY };
    const el = createVideo("/video.mp4");
    el.id = "clip-1";
    const injected = document.createElement("img");
    injected.id = "__render_frame_clip-1__";
    document.body.appendChild(injected);
    stubCanPlayType(el, "");

    maybeProxyProactively(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });
});

describe("handleMetadataForProxy (reactive trigger)", () => {
  function markZeroWidth(el: HTMLVideoElement): void {
    Object.defineProperty(el, "videoWidth", { value: 0, configurable: true });
  }

  it("swaps once when videoWidth is 0 for a same-origin local video absent from the (present) map — unlisted-asset rescue", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(true);
    expect(proxyVariant(el)).toBe("auto");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("never swaps when the codec map global is absent (opt-out surface serves no proxies)", () => {
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("swaps a mapped alpha entry to a VP9 proxy", () => {
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

    expect(proxyVariant(el)).toBe("vp9");
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("does not proxy a mapped browser-safe codec on the metadata path", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "browser_safe_codec" }),
      }),
    );
  });

  it("a second zero-width metadata event does not loop (no second swap)", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);
    handleMetadataForProxy(el);

    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("does nothing when videoWidth is non-zero", () => {
    const el = createVideo("/video.mp4");
    Object.defineProperty(el, "videoWidth", { value: 640, configurable: true });

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
  });

  it("is a no-op in render mode", () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    const el = createVideo("/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(false);
  });

  it("never swaps <audio>", () => {
    const el = createAudio("/video.mp4");
    Object.defineProperty(el, "videoWidth", { value: 0, configurable: true });

    handleMetadataForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("cross-origin src with zero videoWidth: no swap attempted, diagnostic still emitted (with its console.info line)", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("https://cdn.example.com/video.mp4");
    markZeroWidth(el);

    handleMetadataForProxy(el);

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

  it("resolves a ../-traversing sub-composition src (already rewritten to an absolute, prefixed URL) via longest-suffix map matching", () => {
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

    expect(isProxied(el)).toBe(true);
  });
});

describe("handleErrorForProxy (tertiary trigger)", () => {
  it("swaps once on an error event for a zero-stream (video-only hostile) file unlisted in the (present) map", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);

    expect(isProxied(el)).toBe(true);
    expect(el.load).toHaveBeenCalledTimes(1);
  });

  it("never swaps when the codec map global is absent (opt-out surface serves no proxies)", () => {
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("does not swap a mapped browser-SAFE entry that errors (corrupt file — proxying can't help); diagnoses instead", () => {
    window.__HF_MEDIA_CODEC_MAP__ = { "/video.mp4": H264_ENTRY };
    const el = createVideo("/video.mp4");

    handleErrorForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "browser_safe_codec" }),
      }),
    );
  });

  it("never swaps <audio> on error", () => {
    window.__HF_MEDIA_CODEC_MAP__ = {};
    const el = createAudio("/video.mp4");

    handleErrorForProxy(el);

    expect(isProxied(el)).toBe(false);
    expect(postRuntimeMessageMock).not.toHaveBeenCalled();
  });

  it("the proxy URL itself erroring: no second swap, diagnostic reports the failure instead", () => {
    const el = createVideo("/video.mp4");
    swapToProxy(el, HEVC_ENTRY, "proactive");
    expect(el.load).toHaveBeenCalledTimes(1);
    postRuntimeMessageMock.mockClear();

    handleErrorForProxy(el);

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
  it("does not poison swap state when the source URL is malformed", () => {
    const el = createVideo("/video.mp4");
    Object.defineProperty(el, "currentSrc", {
      value: "http://[",
      configurable: true,
    });

    swapToProxy(el, HEVC_ENTRY, "reactive");

    expect(el.load).not.toHaveBeenCalled();
    expect(postRuntimeMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "runtime_media_proxy_unavailable",
        details: expect.objectContaining({ reason: "invalid_source_url" }),
      }),
    );
  });
  it("evicts per-source sync state so the swapped element is treated as a first tick", () => {
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

    expect(hasMediaSyncStateForTest(el)).toBe(false);
  });

  it("preserves existing query strings when appending hf-proxy", () => {
    const el = createVideo("/video.mp4?v=2");

    swapToProxy(el, HEVC_ENTRY, "proactive");

    const url = new URL(el.src, document.baseURI);
    expect(url.searchParams.get("v")).toBe("2");
    expect(url.searchParams.get("hf-proxy")).toBe("h264");
  });

  it("emits the diagnostic and a single console.info line exactly once per element", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const el = createVideo("/video.mp4");

    swapToProxy(el, HEVC_ENTRY, "proactive");
    swapToProxy(el, HEVC_ENTRY, "proactive"); // idempotent re-call, e.g. from another trigger

    const fallbackCalls = postRuntimeMessageMock.mock.calls.filter(
      ([msg]) => (msg as { code?: string }).code === "runtime_media_proxy_fallback",
    );
    expect(fallbackCalls).toHaveLength(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second call for an already-swapped element does not re-swap", () => {
    const el = createVideo("/video.mp4");

    swapToProxy(el, HEVC_ENTRY, "proactive");
    const srcAfterFirstSwap = el.src;
    swapToProxy(el, HEVC_ENTRY, "reactive");

    expect(el.src).toBe(srcAfterFirstSwap);
    expect(el.load).toHaveBeenCalledTimes(1);
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
