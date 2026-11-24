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
    b: scene().set("#b", { x: 10, rotation: 0 }, 0),
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

// fails without the fix: restoring A re-rendered the timelines over B's live drag, back to its scene's x 10.
it("leaves another element's live drag where it is drawn when one draft is restored", () => {
  const { restored } = dragged();
  const other = handleFor(document.getElementById("b")!);
  drawDrafts([{ handle: other, translate: { x: 81, y: 0, route: "gsap" }, size: null }]);
  restored();
  expect(gsap.getProperty("#b", "x")).toBe(81);
});

// fails without the fix: a restore for a draft already ended still re-rendered, putting the next drag's 71 back to 40.
it("repaints nothing for a restore of a draft that has already ended", () => {
  const { handle } = dragged();
  const [first] = Object.values(
    drawDrafts([{ handle, translate: { x: 30, y: 36, route: "gsap" }, size: null }]).drafts,
  );
  drawDrafts([{ handle, end: "keep-size" }]);
  drawDrafts([{ handle, translate: { x: 71, y: 36, route: "gsap" }, size: null }]);
  drawDrafts([{ handle, end: "restore", draft: first! }]);
  expect(gsap.getProperty("#a", "x")).toBe(71);
});

// fails without the fix: replaying B's live drag put back B's whole draft, its size too, so restoring A reset the
// width B was given after its draw (120) to the width before it (70).
it("leaves what another live draft does not draw as it is when one draft is restored", () => {
  const { restored } = dragged();
  const b = document.getElementById("b")!;
  b.style.width = "70px";
  const other = handleFor(b);
  drawDrafts([{ handle: other, translate: { x: 81, y: 0, route: "gsap" }, size: null }]);
  gsapSet({ handle: other, props: { width: 120 } });
  restored();
  expect([b.style.width, gsap.getProperty("#b", "x")]).toEqual(["120px", 81]);
});

// fails without the fix: the replay kept only B's last draft, a move with no rotation in it, so the redraw left B at
// its scene's rotation 0 and lost the 30 an earlier draft turned it to.
it("keeps the rotation an earlier draft drew on another live element when one draft is restored", () => {
  const { restored } = dragged();
  const other = handleFor(document.getElementById("b")!);
  drawDrafts([{ handle: other, rotate: { route: "gsap", angle: 30 }, size: null }]);
  drawDrafts([{ handle: other, translate: { x: 81, y: 0, route: "gsap" }, size: null }]);
  restored();
  expect([gsap.getProperty("#b", "rotation"), gsap.getProperty("#b", "x")]).toEqual([30, 81]);
});

const recordOnB = (x: number) =>
  drawDrafts([
    { handle: handleFor(document.getElementById("b")!), props: { seconds: 1, values: { x } } },
  ]);

// fails without the fix: restoring #a's drag redrew every timeline and put #b's live recording back to its x 10.
it("keeps another layer's live recording when a drag is restored", () => {
  const { restored } = dragged();
  recordOnB(81);
  restored();
  expect(Number(gsap.getProperty("#b", "x"))).toBe(81);
});

// fails without the fix: ending #a's recording redrew the timeline and put #b's live recording back to its x 10.
it("keeps another layer's live recording when a recording ends", () => {
  const { handle } = dragged();
  // Ending a recording redraws the root timeline, where a tween moving #b would draw over its recording.
  (window.__timelines!.main as unknown as gsap.core.Timeline).fromTo(
    "#b",
    { x: 10 },
    { x: 20, duration: 5 },
    0,
  );
  drawDrafts([{ handle, props: { seconds: 1, values: { x: 55 } } }]);
  recordOnB(81);
  drawDrafts([{ handle, end: "clear" }]);
  expect(Number(gsap.getProperty("#b", "x"))).toBe(81);
});

// fails without the fix: the replay kept only B's last sample, opacity alone, and lost its recorded x 81.
it("replays every value another layer's live recording has set when a drag is restored", () => {
  const { restored } = dragged();
  recordOnB(81);
  drawDrafts([
    {
      handle: handleFor(document.getElementById("b")!),
      props: { seconds: 1, values: { opacity: 0.4 } },
    },
  ]);
  restored();
  expect([Number(gsap.getProperty("#b", "x")), Number(gsap.getProperty("#b", "opacity"))]).toEqual([
    81, 0.4,
  ]);
});

// fails without the fix: replaying B's recording sought the film back to B's last sample, 1 s, from where it was.
it("leaves the playhead where it is when a restore replays another layer's live recording", () => {
  const { restored } = dragged();
  recordOnB(81);
  window.__player?.seek(2);
  restored();
  expect([window.__timelines!.main!.time(), Number(gsap.getProperty("#b", "x"))]).toEqual([2, 81]);
});
