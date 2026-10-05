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
  function load(hostStart: number | string) {
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
    return { scene, root };
  }

  const shownX = () => Number(gsap.getProperty("#s", "x"));

  it("places the scene at its host's new start when a rebind follows a host move, as a fresh load does", () => {
    const { scene } = load(1);
    window.__player?.seek(5);
    expect(shownX()).toBe(100);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    expect(shownX()).toBe(50);
    window.__player?.seek(4.5);
    expect(shownX()).toBe(25);
  });

  it("leaves a scene where the root script places it after a re-run, as a fresh load does", () => {
    const { scene } = load(1);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0).add(scene, 2);
    window.__timelines = { main: root, scene } as unknown as Record<string, RuntimeTimelineLike>;
    window.__hfForceTimelineRebind?.();
    expect(scene.startTime()).toBe(2);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(2);
  });

  it("leaves a scene that a script moved into another timeline where that timeline put it", () => {
    const { root, scene } = load(1);
    const holder = gsap.timeline({ paused: true });
    root.add(holder, 0);
    holder.add(scene, 2);

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.parent).toBe(holder);
    expect(scene.startTime()).toBe(2);
  });

  it("still moves a runtime-placed scene when the root script placed another one itself", () => {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      // Listed first, so a throw on the script-placed intro would stop the loop before the scene.
      `<div class="clip" data-composition-id="intro" data-start="2.5" data-duration="2"></div>` +
      `<div id="host" class="clip" data-composition-id="scene" data-start="1" data-duration="3"></div></div>`;
    const intro = gsap.timeline({ paused: true }).to({}, { duration: 2 }, 0);
    const scene = gsap.timeline({ paused: true }).to({}, { duration: 3 }, 0);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 1 }, 0).add(intro, 2);
    window.__timelines = { main: root, intro, scene } as unknown as Record<
      string,
      RuntimeTimelineLike
    >;
    initSandboxRuntimeModular();

    document.getElementById("host")!.setAttribute("data-start", "4");
    window.__hfForceTimelineRebind?.();

    expect(scene.startTime()).toBe(4);
    expect(intro.startTime()).toBe(2);
  });

  it("leaves an unmoved scene in place on a rebind, whatever its start rounds to", () => {
    const { root, scene } = load("0.33333333");
    const remove = vi.spyOn(root, "remove");

    window.__hfForceTimelineRebind?.();

    expect(remove).not.toHaveBeenCalledWith(scene);
  });
});
