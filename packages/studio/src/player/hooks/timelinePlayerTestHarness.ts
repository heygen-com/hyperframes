// Shared test harness: mounts the real useTimelinePlayer and fakes an iframe
// whose window exposes a playback adapter.
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { useTimelinePlayer, type UseTimelinePlayerOptions } from "./useTimelinePlayer";
import { usePlayerStore } from "../store/playerStore";
import { setPreviewFrame } from "../store/previewFrameStore";

export type TimelinePlayerApi = ReturnType<typeof useTimelinePlayer>;

export function resetPlayerStore() {
  usePlayerStore.getState().reset();
  usePlayerStore.setState({ requestedSeekTime: null });
  setPreviewFrame(null);
}

function TimelinePlayerHarness({
  onValue,
  options,
}: {
  onValue: (value: TimelinePlayerApi) => void;
  options?: UseTimelinePlayerOptions;
}) {
  const value = useTimelinePlayer(options);
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
}

/** `api` is the first render's snapshot; `getApi()` returns the latest render's value. */
export function renderTimelinePlayerHarness(options?: UseTimelinePlayerOptions) {
  let latest: TimelinePlayerApi | null = null;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      React.createElement(TimelinePlayerHarness, { onValue: (value) => (latest = value), options }),
    );
  });

  if (!latest) throw new Error("useTimelinePlayer did not mount");
  const rerender = (next?: UseTimelinePlayerOptions) =>
    act(() => {
      root.render(
        React.createElement(TimelinePlayerHarness, {
          onValue: (value) => (latest = value),
          options: next,
        }),
      );
    });
  return {
    api: latest as TimelinePlayerApi,
    getApi: () => latest as TimelinePlayerApi,
    root,
    rerender,
  };
}

export function detachedFakeIframe(iframeWindow: Record<string, unknown>): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { value: iframeWindow, configurable: true });
  Object.defineProperty(iframe, "contentDocument", {
    value: document.implementation.createHTMLDocument("preview"),
    configurable: true,
  });
  return iframe;
}

export function makeFakeIframe(iframeWindow: Record<string, unknown>): HTMLIFrameElement {
  const iframe = detachedFakeIframe(iframeWindow);
  document.body.appendChild(iframe);
  return iframe;
}

export function attachIframeWindow(api: TimelinePlayerApi, iframeWindow: Record<string, unknown>) {
  const iframe = makeFakeIframe(iframeWindow);
  act(() => {
    api.iframeRef.current = iframe;
    api.onIframeLoad();
  });
}

export function makeAdapterWindow(
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

export function makePreview(body: string, query = ""): HTMLIFrameElement {
  const iframe = makeFakeIframe(makeAdapterWindow().win);
  iframe.src = `http://localhost/api/projects/demo/preview${query}`;
  iframe.contentDocument!.body.innerHTML = body;
  return iframe;
}

export function mountPlayerWithPreview(live: HTMLIFrameElement) {
  const harness = renderTimelinePlayerHarness();
  act(() => {
    harness.getApi().iframeRef.current = live;
    harness.getApi().onIframeLoad();
  });
  return harness;
}

export async function paintShadow(getApi: () => TimelinePlayerApi, shadow: HTMLIFrameElement) {
  const slot = getApi().previewSlots.find((s) => s.role === "shadow");
  if (!slot) throw new Error("no shadow reload is pending");
  act(() => getApi().setShadowIframeNode(shadow));
  await act(async () => {
    getApi().onShadowIframeLoad(slot.gen);
    getApi().onShadowReadyChange(slot.gen, true);
  });
  return slot.gen;
}

export function serveEditingRequests(
  frame: Record<string, unknown>,
  answer: (kind: string, params: unknown) => unknown,
): () => void {
  const ports: MessagePort[] = [];
  frame.postMessage = (message: { type?: string } | null) => {
    if (message?.type !== "editing-connect") return;
    const { port1, port2 } = new MessageChannel();
    ports.push(port1);
    port1.onmessage = (event: MessageEvent<{ id: number; kind: string; params: unknown }>) => {
      const { id, kind, params } = event.data;
      port1.postMessage({ v: 1, id, ok: true, result: answer(kind, params) });
    };
    const handoff = { source: "hf-preview", type: "editing-port", v: 1 };
    const source = frame as unknown as Window;
    window.dispatchEvent(new MessageEvent("message", { source, data: handoff, ports: [port2] }));
  };
  return () => ports.forEach((port) => port.close());
}
