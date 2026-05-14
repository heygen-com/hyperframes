// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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
