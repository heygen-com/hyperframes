// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});

it("reads a far clip's start once while playing, not on every frame", () => {
  resetRuntimeFixtureDom();
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => {
    callbacks.delete(key);
  });
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      now += 33;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    }
  };
  const words = Array.from(
    { length: 300 },
    (_, i) => `<span id="w${i}" class="clip" data-start="${5 + i * 0.1}" data-duration="1"></span>`,
  );
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="60">${words.join("")}</div>`;
  window.__timelines = { main: createMockTimeline(60) };
  initSandboxRuntimeModular();
  const player = window.__player!;
  const far = document.getElementById("w299")!;
  const startReads = vi.fn();
  const getAttribute = far.getAttribute.bind(far);
  far.getAttribute = (name: string) => {
    if (name === "data-start") startReads();
    return getAttribute(name);
  };

  player.play();
  step(5);
  const afterWarmUp = startReads.mock.calls.length;
  step(60);

  expect(player.isPlaying()).toBe(true);
  expect(startReads.mock.calls.length - afterWarmUp).toBe(0);
});
