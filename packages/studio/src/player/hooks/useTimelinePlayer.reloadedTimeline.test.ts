// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import {
  detachedFakeIframe,
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
  serveEditingRequests,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
  resetPlayerStore();
});

const FILM = `<div data-composition-id="main"><p id="a"></p><video id="dropped"></video></div>`;
const clip = (id: string, tagName: string, track: number) => ({
  id,
  label: id,
  start: 0,
  duration: 2,
  track,
  kind: "element",
  tagName,
});
const RELOADED = {
  source: "hf-preview",
  type: "timeline",
  durationInFrames: 60,
  clips: [clip("a", "p", 0), clip("dropped", "video", 1)],
};

/** A reloaded film whose runtime holds RELOADED: on its window, and over its editing port once sealed. */
function reloadedFilm() {
  const { win } = makeAdapterWindow({ duration: 2 });
  const frame = win as unknown as Record<string, unknown>;
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "isConnected", { value: true });
  iframe.contentDocument!.body.innerHTML = FILM;
  frame.__clipManifest = RELOADED;
  const markup = {
    html: `<!doctype html><html><body>${FILM}</body></html>`,
    baseURI: "http://localhost/",
  };
  closers.push(
    serveEditingRequests(frame, (kind) =>
      kind === "runtime-snapshot" ? { clipManifest: RELOADED, clipParents: [] } : markup,
    ),
  );
  // A cross-origin window: reading its document or globals throws.
  const seal = () => {
    for (const key of ["document", "__clipManifest"])
      Object.defineProperty(frame, key, {
        get: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });
  };
  return { frame, iframe, seal };
}

it.each(["scriptable", "sealed"] as const)(
  "a %s preview reloaded after a drop puts the dropped clip on the timeline",
  async (mode) => {
    const { getApi, root } = renderTimelinePlayerHarness();
    const live = makeFakeIframe(makeAdapterWindow({ duration: 2 }).win);
    act(() => {
      getApi().iframeRef.current = live;
      getApi().onIframeLoad();
    });
    act(() =>
      usePlayerStore
        .getState()
        .setElements([{ id: "a", domId: "a", tag: "p", start: 0, duration: 2, track: 0 }]),
    );
    act(() => getApi().refreshPlayer());
    const gen = getApi().previewSlots.find((slot) => slot.role === "shadow")!.gen;
    const shadow = reloadedFilm();
    act(() => {
      getApi().setShadowIframeNode(shadow.iframe);
      getApi().onShadowIframeLoad(gen);
    });
    // Sealed after its load, as useTimelinePlayer.sealedGestureHold.test.ts seals its frame: the harness has no
    // playback bridge for an opaque load.
    if (mode === "sealed") shadow.seal();
    act(() => getApi().onShadowReadyChange(gen, true));
    expect(getApi().iframeRef.current).toBe(shadow.iframe);
    // On screen, a film ticks its state; its clip list went out while it loaded hidden.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: shadow.frame as unknown as Window,
          origin: window.location.origin,
          data: { source: "hf-preview", type: "state", isPlaying: false },
        }),
      );
    });
    await vi.waitFor(() =>
      expect(usePlayerStore.getState().elements.map((element) => element.id)).toContain("dropped"),
    );
    act(() => root.unmount());
  },
);
