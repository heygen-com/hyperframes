// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { detachedFakeIframe } from "./timelinePlayerTestHarness";

/** A preview frame and a post from its window, from the origin it loads at. */
function previewFrame(frame: Record<string, unknown> = {}) {
  const iframe = detachedFakeIframe(frame);
  const post = (data: unknown) =>
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data,
    });
  return { iframe, post };
}

function route(isPlaying: boolean) {
  const enrich = vi.fn();
  const { iframe, post } = previewFrame();
  const handle = createPreviewMessageHandler({
    iframeRef: { current: iframe },
    processTimelineMessageRef: { current: vi.fn() },
    enrichMissingCompositionsRef: { current: enrich },
    lastTimelineMessageRef: { current: 0 },
    getAdapter: () => null,
    syncTimelineElements: vi.fn(),
  });
  handle(post({ source: "hf-preview", type: "state", isPlaying }));
  return enrich;
}

describe("preview state messages", () => {
  it("re-reads the preview for missing compositions only while it is stopped", () => {
    expect(route(true)).not.toHaveBeenCalled();
    expect(route(false)).toHaveBeenCalledTimes(1);
  });
});

describe("preview state messages while a scrub posts them", () => {
  it("re-reads the preview for missing compositions at most every 500 ms", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const enrich = vi.fn();
      const { iframe, post } = previewFrame();
      const handle = createPreviewMessageHandler({
        iframeRef: { current: iframe },
        processTimelineMessageRef: { current: vi.fn() },
        enrichMissingCompositionsRef: { current: enrich },
        lastTimelineMessageRef: { current: 0 },
        getAdapter: () => null,
        syncTimelineElements: vi.fn(),
      });
      const state = () => handle(post({ source: "hf-preview", type: "state", isPlaying: false }));
      state();
      vi.advanceTimersByTime(100);
      state();
      state();
      expect(enrich).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(500);
      state();
      expect(enrich).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("preview quality messages", () => {
  function routeMessage(data: unknown, frame: Record<string, unknown> = {}) {
    const { iframe, post } = previewFrame(frame);
    createPreviewMessageHandler({
      iframeRef: { current: iframe },
      processTimelineMessageRef: { current: vi.fn() },
      enrichMissingCompositionsRef: { current: vi.fn() },
      lastTimelineMessageRef: { current: 0 },
      getAdapter: () => null,
      syncTimelineElements: vi.fn(),
    })(post(data));
  }

  it("keeps what the preview says about its lighter copies, and clears it when it says none", () => {
    routeMessage({
      source: "hf-preview",
      type: "preview-copies",
      copies: { total: 3, ready: 1, failed: 0, progress: 0.5, error: null },
    });
    expect(usePlayerStore.getState().previewCopies).toEqual({
      total: 3,
      ready: 1,
      failed: 0,
      progress: 0.5,
      error: null,
    });

    routeMessage({ source: "hf-preview", type: "preview-copies", copies: null });
    expect(usePlayerStore.getState().previewCopies).toBeNull();
  });

  it("keeps the preview's playback health, and clears it when the preview says none", () => {
    const health = {
      droppedShare: 0.4,
      seconds: 3,
      choppy: true,
      fps: 18,
      worstFrameMs: 90,
      skippedShare: 0.1,
      waitingShare: 0.4,
      frozenShare: 0.2,
      gapP50Ms: 17,
      gapP95Ms: 66,
      mode: "play",
    };
    routeMessage({ source: "hf-preview", type: "preview-health", health });
    expect(usePlayerStore.getState().playbackHealth).toEqual(health);

    routeMessage({ source: "hf-preview", type: "preview-health", health: null });
    expect(usePlayerStore.getState().playbackHealth).toBeNull();
  });

  it("keeps the preview's facts and drops a malformed answer", () => {
    const facts = {
      sceneCount: 2,
      mountedElementCount: 120,
      durationSeconds: 30,
      videos: [{ codec: "hevc", width: 3840, height: 2160, bitDepth: 10, count: 2 }],
      lighterAt: [0.25, 0.125],
      copiesReady: true,
    };
    routeMessage({ source: "hf-preview", type: "preview-facts", facts });
    expect(usePlayerStore.getState().previewFacts).toEqual(facts);

    routeMessage({
      source: "hf-preview",
      type: "preview-facts",
      facts: { ...facts, sceneCount: "2" },
    });
    expect(usePlayerStore.getState().previewFacts).toBeNull();
  });

  it("keeps each failed media load the preview reports, and ignores other diagnostics", () => {
    const details = {
      asset: "assets/x.mp3",
      elementId: "music",
      kind: "audio",
      stage: "decode",
      code: null,
      bytes: 8,
      extension: "mp3",
    };
    routeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code: "runtime_media_load_failed",
      details,
    });
    expect(usePlayerStore.getState().mediaLoadFailure).toEqual({
      elementId: "music",
      kind: "audio",
      stage: "decode",
      code: null,
      bytes: 8,
      extension: "mp3",
    });
    const kept = usePlayerStore.getState().mediaLoadFailure;
    routeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code: "runtime_web_audio_bypass",
      details,
    });
    routeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code: "runtime_media_load_failed",
      details: { ...details, stage: "?" },
    });
    expect(usePlayerStore.getState().mediaLoadFailure).toBe(kept);
  });

  it("sends the chosen quality to a preview that has just loaded", () => {
    usePlayerStore.getState().setPreviewQuality(0.25);
    const postMessage = vi.fn();

    routeMessage({ source: "hf-preview", type: "ready" }, { postMessage });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: "set-preview-quality", level: 0.25 }),
      "*",
    );
    usePlayerStore.getState().setPreviewQuality(1);
  });
});

describe("messages that do not come from the preview frame", () => {
  const facts = {
    sceneCount: 1,
    mountedElementCount: 1,
    durationSeconds: 1,
    videos: [],
    lighterAt: [],
    copiesReady: true,
  };
  const report = { source: "hf-preview", type: "preview-facts", facts };

  function deliver(iframe: HTMLIFrameElement | null, event: MessageEvent) {
    usePlayerStore.getState().setPreviewFacts(null);
    createPreviewMessageHandler({
      iframeRef: { current: iframe },
      processTimelineMessageRef: { current: vi.fn() },
      enrichMissingCompositionsRef: { current: vi.fn() },
      lastTimelineMessageRef: { current: 0 },
      getAdapter: () => null,
      syncTimelineElements: vi.fn(),
    })(event);
    return usePlayerStore.getState().previewFacts;
  }

  const from = (source: unknown, origin: string) =>
    new MessageEvent("message", {
      source: source as Window,
      origin,
      data: report,
    });

  it("ignores a report with no sender window", () => {
    const { iframe } = previewFrame();
    expect(deliver(iframe, from(null, window.location.origin))).toBeNull();
  });

  it("ignores a report that arrives before the preview frame exists", () => {
    expect(deliver(null, from({}, window.location.origin))).toBeNull();
  });

  it("ignores a report from a window that is not the preview frame", () => {
    const { iframe } = previewFrame();
    expect(deliver(iframe, from({}, window.location.origin))).toBeNull();
  });

  it("ignores a report from the preview frame's window at an origin that frame cannot have", () => {
    const frame = {};
    const { iframe } = previewFrame(frame);
    expect(deliver(iframe, from(frame, "https://another.example"))).toBeNull();
  });

  it("accepts a sealed preview frame's report only from its opaque origin", () => {
    const frame = {};
    const { iframe } = previewFrame(frame);
    iframe.setAttribute("sandbox", "allow-scripts");
    expect(deliver(iframe, from(frame, window.location.origin))).toBeNull();
    expect(deliver(iframe, from(frame, "null"))).toEqual(facts);
  });

  it("accepts the preview frame's report from the origin it loads at", () => {
    const frame = {};
    const { iframe } = previewFrame(frame);
    expect(deliver(iframe, from(frame, window.location.origin))).toEqual(facts);
  });
});
