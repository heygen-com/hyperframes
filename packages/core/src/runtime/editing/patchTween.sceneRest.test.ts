import gsap from "gsap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "../init";
import type { RuntimeTimelineLike } from "../types";
import { resetRuntimeFixtureDom } from "../runtimeSeekFixture.test-helpers";
import { patchTweens } from "./patchTween";

// fails without the fix: the runtime skips a scene resting at the time it would draw, so a patched tween on a
// scene's timeline was never drawn and the frame still answered patched.
describe("patch-tweens on a scene that rests", () => {
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

  /** A root holding scenes `a` and `b`; `#a` is held at x 40 by a set on scene a's timeline, `depth` timelines down. */
  function load(depth: 1 | 2) {
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      `<div class="clip" data-composition-id="a" data-start="0" data-duration="10"><div id="a"></div></div>` +
      `<div class="clip" data-composition-id="b" data-start="0" data-duration="10"><div id="b"></div></div>` +
      `</div>`;
    const held = gsap.timeline().set("#a", { x: 40 }, 0);
    const a = gsap.timeline({ paused: true }).to({}, { duration: 5 }, 0);
    if (depth === 1) a.set("#a", { x: 40 }, 0);
    else a.add(held, 0);
    const b = gsap.timeline({ paused: true }).set("#b", { x: 10 }, 0).to({}, { duration: 5 }, 0);
    const root = gsap.timeline({ paused: true }).to({}, { duration: 10 }, 0);
    window.__timelines = { main: root, a, b } as unknown as Record<string, RuntimeTimelineLike>;
    initSandboxRuntimeModular();
    window.__player?.seek(1);
    window.__player?.seek(1);
    return { b };
  }

  const shownX = (selector: string) => Number(gsap.getProperty(selector, "x"));
  const patchA = (x: number) =>
    patchTweens({
      patches: [{ selector: "#a", change: { kind: "set", props: { x } } }],
      seek: true,
    });

  it.each([1, 2] as const)(
    "draws the patched set on a scene timeline %i deep, and only then answers patched",
    (depth) => {
      load(depth);
      expect(shownX("#a")).toBe(40);
      expect(patchA(300)).toEqual({ patched: true });
      expect(shownX("#a")).toBe(300);
    },
  );

  it("still skips a scene at rest that no patch touched", () => {
    const { b } = load(1);
    const drawsB = [vi.spyOn(b, "totalTime"), vi.spyOn(b, "seek"), vi.spyOn(b, "render")];
    patchA(300);
    expect(drawsB.map((draw) => draw.mock.calls.filter((call) => call.length > 0).length)).toEqual([
      0, 0, 0,
    ]);
  });

  it("answers not patched when nothing draws the scene it changed", () => {
    load(1);
    delete window.__player;
    expect(patchA(300)).toEqual({ patched: false });
  });
});
