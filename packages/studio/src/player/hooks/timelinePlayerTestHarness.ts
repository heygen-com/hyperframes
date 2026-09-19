// Shared test harness: mounts the real useTimelinePlayer and fakes an iframe
// whose window exposes a playback adapter.
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { useTimelinePlayer } from "./useTimelinePlayer";
import { usePlayerStore } from "../store/playerStore";

export type TimelinePlayerApi = ReturnType<typeof useTimelinePlayer>;

export function resetPlayerStore() {
  usePlayerStore.getState().reset();
  usePlayerStore.setState({ requestedSeekTime: null });
}

function TimelinePlayerHarness({ onValue }: { onValue: (value: TimelinePlayerApi) => void }) {
  const value = useTimelinePlayer();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

export function renderTimelinePlayerHarness() {
  let api: TimelinePlayerApi | null = null;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(React.createElement(TimelinePlayerHarness, { onValue: (value) => (api = value) }));
  });

  if (!api) throw new Error("useTimelinePlayer did not mount");
  return { api: api as TimelinePlayerApi, root };
}

function makeFakeIframe(iframeWindow: Record<string, unknown>): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { value: iframeWindow, configurable: true });
  Object.defineProperty(iframe, "contentDocument", {
    value: document.implementation.createHTMLDocument("preview"),
    configurable: true,
  });
  return iframe;
}

export function attachIframeWindow(api: TimelinePlayerApi, iframeWindow: Record<string, unknown>) {
  const iframe = makeFakeIframe(iframeWindow);
  act(() => {
    api.iframeRef.current = iframe;
    api.onIframeLoad();
  });
}

function makeAdapterWindow(
  options: {
    postMessage?: (message: unknown, targetOrigin: string) => void;
    timelines?: Record<string, unknown>;
    duration?: number;
  } = {},
) {
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
  const win = {
    __player: adapter,
    __timelines: options.timelines,
    postMessage: options.postMessage ?? (() => {}),
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { adapter, win };
}

export function attachIframeAdapter(
  api: TimelinePlayerApi,
  options: Parameters<typeof makeAdapterWindow>[0] = {},
) {
  const { adapter, win } = makeAdapterWindow(options);
  attachIframeWindow(api, win);
  return adapter;
}
