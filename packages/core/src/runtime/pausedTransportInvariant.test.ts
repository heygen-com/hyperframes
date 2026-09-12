import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import {
  createMockTimeline,
  installImmediateAnimationFrame,
  resetRuntimeFixtureDom,
} from "./runtimeSeekFixture.test-helpers";

/**
 * One invariant: while the transport clock is paused, nothing in the preview may
 * be running — not a sibling composition timeline, not a media element.
 */

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

/** A root composition, two sub-composition hosts, and the registry the runtime
 *  reads. `captions` has a host element (so the per-child source-time seek
 *  visits it); `overlay` is registry-only (reached solely by root propagation).
 *  Both are siblings under the invariant. */
function mountNestedComposition() {
  document.body.innerHTML = `
    <div data-composition-id="main" data-root="true" data-start="0" data-duration="20">
      <div class="clip" data-composition-id="captions" data-start="0" data-duration="20"></div>
    </div>`;
  const registry = {
    main: createMockTimeline(20),
    captions: createMockTimeline(20),
    overlay: createMockTimeline(20),
  };
  window.__timelines = registry;
  return registry;
}

describe("paused transport owns what is running", () => {
  beforeEach(() => {
    resetRuntimeFixtureDom();
    installImmediateAnimationFrame();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    delete window.__timelines;
    document.body.innerHTML = "";
  });

  it("keeps a registered child the root does not hold paused across a rebind", () => {
    // The resolver used to unpause every registry child before nesting it. A
    // rebind after an edit re-resolves with no seek behind it, so a child the
    // root never actually holds (add() is a no-op here, as when GSAP refuses)
    // was left free-running on the global ticker while the clock was paused.
    const registry = mountNestedComposition();
    initSandboxRuntimeModular();
    expect(registry.captions.paused!()).toBe(true);

    window.__hfForceTimelineRebind!();

    expect(window.__player!.isPlaying()).toBe(false);
    expect(registry.captions.paused!()).toBe(true);
    expect(registry.overlay.paused!()).toBe(true);
  });

  it("leaves every registered sibling timeline paused after a renderSeek", () => {
    const registry = mountNestedComposition();
    initSandboxRuntimeModular();
    const player = window.__player;
    expect(player).toBeDefined();

    player!.renderSeek(2);

    expect(player!.isPlaying()).toBe(false);
    expect(registry.captions.paused!()).toBe(true);
    expect(registry.overlay.paused!()).toBe(true);
  });

  it("keeps them paused across the repeated renderSeeks the Studio fallback adapter issues", () => {
    // createStaticSeekPlaybackAdapter drives playback by calling renderSeek from
    // its own rAF loop. Every one of those seeks used to unpause the siblings,
    // and one is enough — the Studio's own transport tick is running the whole
    // time, so the residual state is never harmless there.
    const registry = mountNestedComposition();
    initSandboxRuntimeModular();
    const player = window.__player;

    for (const t of [0, 0.5, 1, 1.5, 2]) {
      player!.renderSeek(t);
      expect([registry.captions.paused!(), registry.overlay.paused!()]).toEqual([true, true]);
    }
  });

  it("still hands the root seek an unpaused sibling, so propagation reaches it", () => {
    // The rearm is what this whole dance exists for: GSAP does not propagate
    // totalTime() into a paused child. Restoring must not cost that.
    const registry = mountNestedComposition();
    const seenDuringRootSeek: boolean[] = [];
    const rootTotalTime = registry.main.totalTime!;
    registry.main.totalTime = (time?: number, suppressEvents?: boolean) => {
      seenDuringRootSeek.push(registry.overlay.paused!());
      return rootTotalTime.call(registry.main, time, suppressEvents);
    };

    initSandboxRuntimeModular();
    seenDuringRootSeek.length = 0;
    window.__player!.renderSeek(3);

    expect(seenDuringRootSeek.length).toBeGreaterThan(0);
    expect(seenDuringRootSeek.every((paused) => paused === false)).toBe(true);
    expect(registry.overlay.paused!()).toBe(true);
  });
});
