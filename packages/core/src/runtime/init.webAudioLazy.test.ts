import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

// Opening an AudioContext opens the audio device on the page's thread; on Windows that took up to 7 s.
describe("the audio context opens at the first clip that needs it", () => {
  let built = 0;
  const original = (globalThis as Record<string, unknown>).AudioContext;

  beforeEach(() => {
    resetRuntimeFixtureDom();
    built = 0;
    (globalThis as Record<string, unknown>).AudioContext = class {
      state = "running";
      destination = {};
      currentTime = 0;
      constructor() {
        built += 1;
      }
      resume = () => Promise.resolve();
      suspend = () => Promise.resolve();
      close = () => Promise.resolve();
      createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
      createMediaElementSource = () => ({ connect() {}, disconnect() {} });
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).AudioContext = original;
    vi.restoreAllMocks();
  });

  const mount = (withClip: boolean) => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "10");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    if (withClip) {
      const audio = document.createElement("audio");
      audio.setAttribute("data-start", "0");
      audio.setAttribute("data-duration", "10");
      audio.setAttribute("src", "/assets/track.mp3");
      audio.load = () => {};
      audio.play = vi.fn(() => Promise.resolve());
      root.appendChild(audio);
    }
    window.__timelines = { main: createMockTimeline(10) };
  };

  const flush = async () => {
    for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  };

  it("builds none while a page with sound only loads", async () => {
    mount(true);
    initSandboxRuntimeModular();
    await flush();
    expect(built, "a paused page built an AudioContext").toBe(0);
  });

  it("builds none when a page with no sound plays", async () => {
    mount(false);
    initSandboxRuntimeModular();
    window.__player?.play();
    await flush();
    expect(built, "a page with no clips built an AudioContext").toBe(0);
  });

  it("builds one when a page with sound plays, however often it plays", async () => {
    mount(true);
    initSandboxRuntimeModular();
    window.__player?.play();
    await flush();
    window.__player?.pause();
    window.__player?.play();
    await flush();
    expect(built).toBe(1);
  });
});
