import gsap from "gsap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import { resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

// A render seek must draw each scene once, at its own time, however many scenes follow the playhead.
describe("runtime root length across render seeks", () => {
  beforeEach(() => {
    resetRuntimeFixtureDom();
    window.gsap = gsap as unknown as typeof window.gsap;
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    delete window.__player;
    delete window.__playerReady;
    delete window.__hf;
  });

  /** `sceneCount` five-second scenes back to back; returns the local times scene 1 is drawn at. */
  function load(sceneCount: number) {
    const hosts = Array.from(
      { length: sceneCount },
      (_, i) => `<div data-composition-id="s${i}" data-start="${i * 5}" data-duration="5"></div>`,
    ).join("");
    document.body.innerHTML = `<div data-composition-id="main" data-start="0" data-duration="${sceneCount * 5}">${hosts}</div>`;
    const timelines: Record<string, RuntimeTimelineLike> = {
      main: gsap.timeline({ paused: true }) as unknown as RuntimeTimelineLike,
    };
    const drawnAt: number[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const target = { v: 0, w: 0 };
      const scene = gsap
        .timeline({ paused: true })
        .to(target, { v: 1, duration: 5, ease: "none" }, 0)
        .to(target, { w: 1, duration: 1 }, 0)
        // Overwrites the tween above on its first render, which marks the root's length stale.
        .to(target, { w: 2, duration: 1, overwrite: "auto" }, 0);
      if (i === 1)
        scene.eventCallback("onUpdate", () => drawnAt.push(Number(scene.time().toFixed(4))));
      timelines[`s${i}`] = scene as unknown as RuntimeTimelineLike;
    }
    window.__timelines = timelines;
    initSandboxRuntimeModular();
    return drawnAt;
  }

  function renderFrames(from: number, to: number) {
    for (let frame = from; frame <= to; frame++) window.__player?.renderSeek(frame / 30);
  }

  it("draws a scene at its own time when no scene follows it", () => {
    const drawnAt = load(2);
    renderFrames(210, 214);
    expect(drawnAt).toEqual([2, 2.0333, 2.0667, 2.1, 2.1333]);
  });

  it("draws a scene at its own time when a later scene first renders during the seek", () => {
    const drawnAt = load(3);
    renderFrames(210, 214);
    expect(drawnAt).toEqual([2, 2.0333, 2.0667, 2.1, 2.1333]);
  });
});
