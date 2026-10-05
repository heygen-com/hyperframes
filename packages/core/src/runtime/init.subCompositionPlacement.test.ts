import gsap from "gsap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

// Pins where a running runtime places a sub-composition's timeline, against what a fresh load does.
describe("runtime sub-composition placement", () => {
  beforeEach(() => {
    resetRuntimeFixtureDom();
    window.gsap = gsap as unknown as typeof window.gsap;
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    vi.restoreAllMocks();
    delete window.__player;
    delete window.__playerReady;
    delete window.__hf;
  });

  /** A root with one scene clip at `hostStart`, whose timeline slides `#s` from 0 to 100 over 2 s. */
  function load(hostStart: number) {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      `<div id="host" class="clip" data-composition-id="scene" data-start="${hostStart}" data-duration="3">` +
      `<div id="s"></div></div></div>`;
    const scene = gsap
      .timeline({ paused: true })
      .to("#s", { x: 100, duration: 2, ease: "none" }, 0);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0);
    window.__timelines = { main: root, scene } as unknown as Record<string, RuntimeTimelineLike>;
    initSandboxRuntimeModular();
    return scene;
  }

  const shownX = () => Number(gsap.getProperty("#s", "x"));

  it("places the scene at its host's new start when a rebind follows a host move, as a fresh load does", () => {
    const scene = load(1);
    window.__player?.seek(5);
    expect(shownX()).toBe(100);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    expect(shownX()).toBe(50);
    window.__player?.seek(4.5);
    expect(shownX()).toBe(25);
  });
});
