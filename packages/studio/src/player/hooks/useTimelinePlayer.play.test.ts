// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, expect, it } from "vitest";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";
import { usePlayerStore } from "../store/playerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

it("does not start playback before the timeline is ready, so iframe load cannot swallow it", () => {
  const { api, root } = renderTimelinePlayerHarness();
  const { adapter, win } = makeAdapterWindow();
  // The runtime has booted (adapter exists) but the iframe's load event has not fired yet.
  act(() => {
    api.iframeRef.current = makeFakeIframe(win);
  });

  act(() => api.play());
  expect(adapter.play).not.toHaveBeenCalled();
  expect(usePlayerStore.getState().isPlaying).toBe(false);

  act(() => {
    api.onIframeLoad();
    usePlayerStore.setState({ timelineReady: true });
  });
  act(() => api.play());
  expect(adapter.play).toHaveBeenCalledTimes(1);
  expect(usePlayerStore.getState().isPlaying).toBe(true);
  act(() => root.unmount());
});
