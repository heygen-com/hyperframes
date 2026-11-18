// @vitest-environment happy-dom

import { gsap } from "gsap";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import {
  attachIframeAdapter,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";
import { usePlayerStore } from "../store/playerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetPlayerStore();
});

// fails without the fix: Studio also set the rate on each timeline the runtime had nested, so a scene played at 4x.
it("plays a scene nested in the root timeline at the chosen rate, not the rate squared", () => {
  const main = gsap.timeline({ paused: true });
  const scene = gsap.timeline({ paused: true });
  main.add(scene, 1);
  const { api, root } = renderTimelinePlayerHarness();
  attachIframeAdapter(api, {
    // The runtime applies a posted rate to the root timeline it captured.
    postMessage: (message) => {
      const control = message as { action?: string; playbackRate?: number };
      if (control.action === "set-playback-rate") main.timeScale(control.playbackRate ?? 1);
    },
    timelines: { main, scene },
  });

  act(() => usePlayerStore.getState().setPlaybackRate(2));

  expect(main.timeScale() * scene.timeScale()).toBe(2);
  act(() => root.unmount());
});
