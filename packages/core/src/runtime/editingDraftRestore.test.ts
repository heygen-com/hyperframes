import gsap from "gsap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { drawDrafts } from "./editingDraft";
import { handleFor } from "./editingHandles";
import { gsapSet } from "./editing/gsapSet";
import { patchTweens } from "./editing/patchTween";
import { initSandboxRuntimeModular } from "./init";
import { resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import type { RuntimeTimelineLike } from "./types";

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

/** At 1 s, `#a` held at x 40 by scene a's set (or `holdA`'s) and at y 30 by a base set, then dragged to (30, 36). */
function dragged(holdA = (a: gsap.core.Timeline) => a.set("#a", { x: 40 }, 0), baseX?: number) {
  const clip = (id: string) =>
    `<div class="clip" data-composition-id="${id}" data-start="0" data-duration="10"><div id="${id}"></div></div>`;
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-duration="10">${clip("a")}${clip("b")}</div>`;
  const scene = () => gsap.timeline({ paused: true }).to({}, { duration: 5 }, 0);
  window.__timelines = {
    main: scene(),
    a: holdA(scene()),
    b: scene().set("#b", { x: 10 }, 0),
  } as unknown as Record<string, RuntimeTimelineLike>;
  initSandboxRuntimeModular();
  window.__player?.seek(1);
  gsap.set("#a", { y: 30, ...(baseX !== undefined && { x: baseX }) });
  const handle = handleFor(document.getElementById("a")!);
  drawDrafts([{ handle, translate: { x: 30, y: 36, route: "gsap" }, size: null }]);
  const restored = () => {
    drawDrafts([{ handle, end: "restore" }]);
    return { x: Number(gsap.getProperty("#a", "x")), y: Number(gsap.getProperty("#a", "y")) };
  };
  return { handle, restored };
}
const setX = (selector: string, x: number) => ({
  selector,
  change: { kind: "set" as const, props: { x } },
});

// fails without the fix: the restore threw x back to the draft's start, 40, under a tween edit the timeline keeps.
// It reverses round 3's (40, 30): after this failure Studio re-runs the saved script, with the edit, sealed or open.
it("shows the timeline's edited x when a batch's later patch misses", () => {
  const { restored } = dragged();
  expect(patchTweens({ patches: [setX("#a", 50), setX("#missing", 1)], seek: true })).toEqual({
    patched: false,
  });
  expect(restored()).toEqual({ x: 50, y: 30 });
});

// fails without the fix: a drawing batch released x though #a's only tween starts after the playhead, so the restore
// left the cancelled drag's 30.
it("puts back the base when the tween holding the axis has not started", () => {
  const { restored } = dragged((a) => a.set("#a", { x: 70 }, 3), 40);
  patchTweens({ patches: [setX("#a", 60), setX("#b", 20)], seek: true });
  expect(restored()).toEqual({ x: 40, y: 30 });
});

// fails without the fix: the batch's seek drew x 50, then its global-set missed, and the restore threw x back to 40.
it("keeps the x a batch's seek drew when a later base set in it misses", () => {
  const { restored } = dragged();
  const missingSet = {
    selector: "#missing",
    change: { kind: "global-set" as const, props: { x: 1 } },
  };
  expect(
    patchTweens({ patches: [setX("#a", 50), setX("#b", 20), missingSet], seek: true }),
  ).toEqual({
    patched: false,
  });
  expect(restored()).toEqual({ x: 50, y: 30 });
});

it("keeps an earlier batch's x when a batch between it and the drawing batch fails", () => {
  const { restored } = dragged();
  expect(patchTweens({ patches: [setX("#a", 50)], seek: false })).toEqual({ patched: true });
  expect(patchTweens({ patches: [setX("#missing", 1)], seek: false })).toEqual({ patched: false });
  expect(patchTweens({ patches: [setX("#b", 20)], seek: true })).toEqual({ patched: true });
  expect(restored()).toEqual({ x: 50, y: 30 });
});

it("gives an axis a tween holds at the playhead to the tween, over a base set after the draw", () => {
  const { handle, restored } = dragged();
  gsapSet({ handle, props: { x: 25, y: 33 } });
  expect(restored()).toEqual({ x: 40, y: 33 });
});

it("runs none of the timeline's callbacks when it restores", () => {
  const ran = vi.fn();
  const { restored } = dragged((a) =>
    a.set("#a", { x: 40 }, 0).call(ran, [], 0).call(ran, [], 0.5).eventCallback("onUpdate", ran),
  );
  ran.mockClear();
  restored();
  expect(ran).not.toHaveBeenCalled();
});
