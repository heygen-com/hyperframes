// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelinePlayer } from "./useTimelinePlayer";
import { liveTime, usePlayerStore } from "../store/playerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetPlayerStore() {
  usePlayerStore.getState().reset();
  usePlayerStore.setState({ requestedSeekTime: null });
}

function TimelinePlayerHarness({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useTimelinePlayer>) => void;
}) {
  const value = useTimelinePlayer();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

function renderTimelinePlayerHarness() {
  let api: ReturnType<typeof useTimelinePlayer> | null = null;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }));
  });

  if (!api) throw new Error("useTimelinePlayer did not mount");
  return { api, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

function attachIframeAdapter(
  api: ReturnType<typeof useTimelinePlayer>,
  options: {
    postMessage?: (message: unknown, targetOrigin: string) => void;
    timelines?: Record<string, unknown>;
    duration?: number;
  } = {},
) {
  const iframe = document.createElement("iframe");
  let currentTime = 0;
  let playing = false;
  const adapter = {
    play: vi.fn(() => {
      playing = true;
    }),
    pause: vi.fn(() => {
      playing = false;
    }),
    seek: (time: number) => {
      currentTime = time;
    },
    getTime: () => currentTime,
    getDuration: () => options.duration ?? 30,
    isPlaying: () => playing,
  };
  Object.defineProperty(iframe, "contentWindow", {
    value: {
      __player: adapter,
      __timelines: options.timelines,
      postMessage: options.postMessage ?? (() => {}),
      scrollTo: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    configurable: true,
  });
  Object.defineProperty(iframe, "contentDocument", {
    value: document.implementation.createHTMLDocument("preview"),
    configurable: true,
  });
  act(() => {
    api.iframeRef.current = iframe;
    api.onIframeLoad();
  });
  return adapter;
}

function renderAttachedTimelinePlayer() {
  const { api, root } = renderTimelinePlayerHarness();
  const adapter = attachIframeAdapter(api);
  return { api, root, adapter };
}

function setStorePlaying() {
  act(() => {
    usePlayerStore.setState({ isPlaying: true });
  });
}

function seekWithAct(
  api: ReturnType<typeof useTimelinePlayer>,
  time: number,
  options?: { keepPlaying?: boolean },
) {
  act(() => {
    api.seek(time, options);
  });
}

function unmountWithAct(root: ReturnType<typeof createRoot>) {
  act(() => {
    root.unmount();
  });
}

function expectStorePlaybackState(
  root: ReturnType<typeof createRoot>,
  expected: { isPlaying: boolean; currentTime: number },
) {
  expect(usePlayerStore.getState().isPlaying).toBe(expected.isPlaying);
  expect(usePlayerStore.getState().currentTime).toBe(expected.currentTime);
  unmountWithAct(root);
}

describe("useTimelinePlayer seek hydration", () => {
  it("keeps an external seek request until the iframe adapter is ready", () => {
    const observedTimes: number[] = [];
    const unsubscribe = liveTime.subscribe((time) => {
      observedTimes.push(time);
    });
    const { api, root } = renderTimelinePlayerHarness();

    act(() => {
      usePlayerStore.getState().requestSeek(4.2);
    });

    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(usePlayerStore.getState().requestedSeekTime).toBeNull();

    const adapter = attachIframeAdapter(api);

    expect(adapter.getTime()).toBe(4.2);
    expect(usePlayerStore.getState().currentTime).toBe(4.2);
    expect(usePlayerStore.getState().timelineReady).toBe(true);
    expect(observedTimes).toContain(4.2);

    unmountWithAct(root);
    unsubscribe();
  });
});

describe("useTimelinePlayer audio controls (#835)", () => {
  it("applies playback-rate changes immediately and auto-mutes audio above 1x", () => {
    const { api, root } = renderTimelinePlayerHarness();
    const postMessage = vi.fn();
    const timeScale = vi.fn();

    attachIframeAdapter(api, {
      postMessage,
      timelines: {
        root: { timeScale },
      },
    });
    postMessage.mockClear();
    timeScale.mockClear();

    act(() => {
      usePlayerStore.getState().setAudioMuted(false);
      usePlayerStore.getState().setPlaybackRate(2);
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hf-parent",
        type: "control",
        action: "set-playback-rate",
        playbackRate: 2,
      }),
      "*",
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hf-parent",
        type: "control",
        action: "set-muted",
        muted: true,
      }),
      "*",
    );
    expect(timeScale).toHaveBeenCalledWith(2);

    postMessage.mockClear();

    act(() => {
      usePlayerStore.getState().setPlaybackRate(1);
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "set-muted",
        muted: false,
      }),
      "*",
    );

    unmountWithAct(root);
  });

  it("keeps explicit Studio mute active at 1x", () => {
    const { api, root } = renderTimelinePlayerHarness();
    const postMessage = vi.fn();

    attachIframeAdapter(api, { postMessage });
    postMessage.mockClear();

    act(() => {
      usePlayerStore.getState().setPlaybackRate(1);
      usePlayerStore.getState().setAudioMuted(true);
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "set-muted",
        muted: true,
      }),
      "*",
    );

    unmountWithAct(root);
  });
});

describe("useTimelinePlayer seek keepPlaying option (#834)", () => {
  it("default seek() clears isPlaying when the store reports playing", () => {
    const { api, root } = renderAttachedTimelinePlayer();
    setStorePlaying();

    seekWithAct(api, 5);

    expectStorePlaybackState(root, { isPlaying: false, currentTime: 5 });
  });

  it("seek(time, { keepPlaying: true }) preserves isPlaying=true so A/E shortcuts don't pause the timeline", () => {
    const { api, root, adapter } = renderAttachedTimelinePlayer();
    setStorePlaying();

    seekWithAct(api, 5, { keepPlaying: true });

    expect(adapter.play).toHaveBeenCalledTimes(1);
    expectStorePlaybackState(root, { isPlaying: true, currentTime: 5 });
  });

  it("seek(time, { keepPlaying: true }) from paused state stays paused (no spurious resume)", () => {
    const { api, root } = renderAttachedTimelinePlayer();

    expect(usePlayerStore.getState().isPlaying).toBe(false);

    seekWithAct(api, 5, { keepPlaying: true });

    expectStorePlaybackState(root, { isPlaying: false, currentTime: 5 });
  });

  it("seek(time, { keepPlaying: true }) restarts playback when the iframe adapter was paused", () => {
    const { api, root, adapter } = renderAttachedTimelinePlayer();
    setStorePlaying();

    expect(adapter.isPlaying()).toBe(false);

    seekWithAct(api, 0, { keepPlaying: true });

    expect(adapter.play).toHaveBeenCalledTimes(1);
    expect(adapter.isPlaying()).toBe(true);
    expectStorePlaybackState(root, { isPlaying: true, currentTime: 0 });
  });
});

describe("useTimelinePlayer RAF loop wrap-around", () => {
  type SeekCall = { time: number; options?: { keepPlaying?: boolean } };

  function attachInstrumentedAdapter(api: ReturnType<typeof useTimelinePlayer>, duration = 30) {
    const iframe = document.createElement("iframe");
    let currentTime = 0;
    let playing = false;
    const seekCalls: SeekCall[] = [];
    const adapter = {
      play: vi.fn(() => {
        playing = true;
      }),
      pause: vi.fn(() => {
        playing = false;
      }),
      seek: vi.fn((time: number, options?: { keepPlaying?: boolean }) => {
        currentTime = time;
        seekCalls.push({ time, options });
      }),
      getTime: () => currentTime,
      getDuration: () => duration,
      isPlaying: () => playing,
      setTime: (t: number) => {
        currentTime = t;
      },
    };
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        __player: adapter,
        postMessage: () => {},
        scrollTo: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      configurable: true,
    });
    Object.defineProperty(iframe, "contentDocument", {
      value: document.implementation.createHTMLDocument("preview"),
      configurable: true,
    });
    act(() => {
      api.iframeRef.current = iframe;
      api.onIframeLoad();
    });
    return { adapter, seekCalls };
  }

  function installRafCapture(): {
    flushOne: () => boolean;
    restore: () => void;
  } {
    const callbacks: FrameRequestCallback[] = [];
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    return {
      flushOne: () => {
        const next = callbacks.shift();
        if (!next) return false;
        next(performance.now());
        return true;
      },
      restore: () => {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCancel;
      },
    };
  }

  it("passes { keepPlaying: true } when forward playback wraps around loopEnd", () => {
    const raf = installRafCapture();
    try {
      const { api, root } = renderTimelinePlayerHarness();
      const { adapter, seekCalls } = attachInstrumentedAdapter(api);

      act(() => {
        usePlayerStore.getState().setInPoint(2);
        usePlayerStore.getState().setOutPoint(5);
      });
      expect(usePlayerStore.getState().loopEnabled).toBe(true);

      act(() => {
        api.play();
      });
      adapter.seek.mockClear();
      seekCalls.length = 0;

      adapter.setTime(6); // past outPoint=5
      act(() => {
        raf.flushOne();
      });

      const wrapSeek = seekCalls.find((call) => call.time === 2);
      expect(wrapSeek).toBeDefined();
      expect(wrapSeek?.options).toEqual({ keepPlaying: true });
      expect(adapter.play).toHaveBeenCalled();
      expect(usePlayerStore.getState().isPlaying).toBe(true);

      unmountWithAct(root);
    } finally {
      raf.restore();
    }
  });

  it("does not seek and pauses cleanly when forward playback reaches the end without loop", () => {
    const raf = installRafCapture();
    try {
      const { api, root } = renderTimelinePlayerHarness();
      const { adapter, seekCalls } = attachInstrumentedAdapter(api);

      act(() => {
        usePlayerStore.getState().setLoopEnabled(false);
      });

      act(() => {
        api.play();
      });
      adapter.seek.mockClear();
      seekCalls.length = 0;
      adapter.play.mockClear();
      adapter.pause.mockClear();

      adapter.setTime(adapter.getDuration() + 1); // past end
      act(() => {
        raf.flushOne();
      });

      expect(seekCalls).toHaveLength(0);
      expect(adapter.pause).toHaveBeenCalled();
      expect(usePlayerStore.getState().isPlaying).toBe(false);

      unmountWithAct(root);
    } finally {
      raf.restore();
    }
  });
});
