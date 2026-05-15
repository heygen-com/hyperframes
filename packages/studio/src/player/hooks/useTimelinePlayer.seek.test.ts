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

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

function attachIframeAdapter(
  api: ReturnType<typeof useTimelinePlayer>,
  options: {
    postMessage?: (message: unknown, targetOrigin: string) => void;
    timelines?: Record<string, unknown>;
  } = {},
) {
  const iframe = document.createElement("iframe");
  let currentTime = 0;
  const adapter = {
    play: () => {},
    pause: () => {},
    seek: (time: number) => {
      currentTime = time;
    },
    getTime: () => currentTime,
    getDuration: () => 30,
    isPlaying: () => false,
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

describe("useTimelinePlayer seek hydration", () => {
  it("keeps an external seek request until the iframe adapter is ready", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const observedTimes: number[] = [];
    const unsubscribe = liveTime.subscribe((time) => {
      observedTimes.push(time);
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });

    act(() => {
      usePlayerStore.getState().requestSeek(4.2);
    });

    expect(api).not.toBeNull();
    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(usePlayerStore.getState().requestedSeekTime).toBeNull();

    const iframe = document.createElement("iframe");
    let currentTime = 0;
    const adapter = {
      play: () => {},
      pause: () => {},
      seek: (time: number) => {
        currentTime = time;
      },
      getTime: () => currentTime,
      getDuration: () => 30,
      isPlaying: () => false,
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
      api!.iframeRef.current = iframe;
      api!.onIframeLoad();
    });

    expect(currentTime).toBe(4.2);
    expect(usePlayerStore.getState().currentTime).toBe(4.2);
    expect(usePlayerStore.getState().timelineReady).toBe(true);
    expect(observedTimes).toContain(4.2);

    act(() => {
      root.unmount();
    });
    unsubscribe();
  });
});

describe("useTimelinePlayer audio controls (#835)", () => {
  it("applies playback-rate changes immediately and auto-mutes audio above 1x", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const postMessage = vi.fn();
    const timeScale = vi.fn();

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });
    attachIframeAdapter(api!, {
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

    act(() => {
      root.unmount();
    });
  });

  it("keeps explicit Studio mute active at 1x", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const postMessage = vi.fn();

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });
    attachIframeAdapter(api!, { postMessage });
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

    act(() => {
      root.unmount();
    });
  });
});

describe("useTimelinePlayer seek keepPlaying option (#834)", () => {
  it("default seek() clears isPlaying when the store reports playing", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });
    attachIframeAdapter(api!);

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });

    act(() => {
      api!.seek(5);
    });

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentTime).toBe(5);

    act(() => {
      root.unmount();
    });
  });

  it("seek(time, { keepPlaying: true }) preserves isPlaying=true so A/E shortcuts don't pause the timeline", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });
    attachIframeAdapter(api!);

    act(() => {
      usePlayerStore.setState({ isPlaying: true });
    });

    act(() => {
      api!.seek(5, { keepPlaying: true });
    });

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().currentTime).toBe(5);

    act(() => {
      root.unmount();
    });
  });

  it("seek(time, { keepPlaying: true }) from paused state stays paused (no spurious resume)", () => {
    let api: ReturnType<typeof useTimelinePlayer> | null = null;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }),
      );
    });
    attachIframeAdapter(api!);

    expect(usePlayerStore.getState().isPlaying).toBe(false);

    act(() => {
      api!.seek(5, { keepPlaying: true });
    });

    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().currentTime).toBe(5);

    act(() => {
      root.unmount();
    });
  });
});
