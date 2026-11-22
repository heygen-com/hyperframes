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

  /** `#a` is held at x 40 by a set on scene a's timeline; at depth 2, scene a sits inside scene outer. */
  function load(depth: 1 | 2, holdA = (a: gsap.core.Timeline) => a.set("#a", { x: 40 }, 0)) {
    const a = `<div class="clip" data-composition-id="a" data-start="0" data-duration="10"><div id="a"></div></div>`;
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="10">` +
      (depth === 1
        ? a
        : `<div class="clip" data-composition-id="outer" data-start="0" data-duration="10">${a}</div>`) +
      `<div class="clip" data-composition-id="b" data-start="0" data-duration="10"><div id="b"></div></div>` +
      `</div>`;
    const scene = () => gsap.timeline({ paused: true }).to({}, { duration: 5 }, 0);
    const b = scene().set("#b", { x: 10 }, 0);
    const timelines: Record<string, unknown> = {
      main: scene(),
      a: holdA(scene()),
      b,
    };
    if (depth === 2) timelines.outer = scene();
    window.__timelines = timelines as Record<string, RuntimeTimelineLike>;
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
    "draws the patched set on a scene %i composition deep, and only then answers patched",
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

  it("answers not patched when the patched set sits in a child timeline that already ended", () => {
    load(1, (a) => a.add(gsap.timeline().set("#a", { x: 40 }, 0), 0));
    expect(patchA(300)).toEqual({ patched: false });
    expect(shownX("#a")).toBe(40);
  });

  it("answers patched for a keyframe-step edit once the tween that replaced it renders", () => {
    load(1, (a) =>
      a.to("#a", { keyframes: { "0%": { x: 40 }, "100%": { x: 40 } }, duration: 2 }, 0),
    );
    const reply = patchTweens({
      patches: [
        { selector: "#a", change: { kind: "keyframe-rebuild", pct: 100, props: { x: 140 } } },
      ],
      seek: true,
    });
    expect(reply).toEqual({ patched: true });
    expect(shownX("#a")).toBe(90);
  });

  it("answers not patched when nothing draws the scene it changed", () => {
    load(1);
    delete window.__player;
    expect(patchA(300)).toEqual({ patched: false });
  });
});

// The reply reads GSAP's internal _initted: an upgrade that changes it fails here, not every reply.
describe("GSAP's init flag, as the patch reply reads it", () => {
  it("is cleared by invalidate() and set again by the tween's next render", () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const timeline = gsap
      .timeline({ paused: true })
      .set("#a", { x: 40 }, 0)
      .to({}, { duration: 2 }, 0);
    timeline.totalTime(1);
    const set = timeline.getChildren(true)[0] as gsap.core.Tween & { _initted?: unknown };
    expect(Boolean(set._initted)).toBe(true);
    set.invalidate();
    expect(Boolean(set._initted)).toBe(false);
    timeline.totalTime(0.5, true);
    timeline.totalTime(1, true);
    expect(Boolean(set._initted)).toBe(true);
  });
});
