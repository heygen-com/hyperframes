import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaapiAdapter } from "./waapi";

class TestAnimation {
  constructor(public currentTime = 0) {}
  playState = "running";
  playbackRate = 1;
  timeline: object | null = timeline;
  addEventListener = vi.fn();
  pause = vi.fn(() => {
    this.playState = "paused";
  });
}
class TestCssAnimation extends TestAnimation {}
class TestCssTransition extends TestAnimation {}
const timeline = {};

describe("initial WAAPI baseline", () => {
  let items: TestAnimation[];
  const create = (time = 300) => {
    const animation = new TestAnimation(time);
    items.push(animation);
    return animation;
  };

  beforeEach(() => {
    items = [];
    vi.stubGlobal("document", { timeline, getAnimations: () => items });
    vi.stubGlobal("CSSAnimation", TestCssAnimation);
    vi.stubGlobal("CSSTransition", TestCssTransition);
    vi.stubGlobal("Element", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([0, 16, 90, 300, 1500])(
    "does not retain %d ms of initial wall-clock progress",
    (time) => {
      const animation = create(time);
      const adapter = createWaapiAdapter();
      adapter.discover();
      for (const t of [0, 2, 3.5, 2]) {
        adapter.seek({ time: t });
        expect(animation.currentTime).toBe(t * 1000);
        expect(animation.playState).toBe("paused");
      }
    },
  );

  it.each(["seek", "pause"])("also anchors when %s is called before discover", (method) => {
    const animation = create();
    const adapter = createWaapiAdapter();
    if (method === "pause") adapter.pause();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2000);
  });

  it("rewinds an animation that finished before initial discovery", () => {
    const animation = create(80);
    animation.playState = "finished";
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 0.04 });
    expect(animation.currentTime).toBe(40);
  });

  it("does not reinterpret an idle animation", () => {
    const animation = create(500);
    animation.playState = "idle";
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2500);
  });

  it("keeps the captured baseline across repeated discovery at composition zero", () => {
    const animation = create(300);
    const adapter = createWaapiAdapter();
    adapter.discover();
    animation.currentTime = 900;
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2000);
  });

  it.each([0, 500])("preserves a paused authored offset of %d ms", (time) => {
    const animation = create(time);
    animation.playState = "paused";
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2000 + time);
  });

  it.each([TestCssAnimation, TestCssTransition])("leaves $name baselines unchanged", (Type) => {
    const animation = new Type(500);
    items.push(animation);
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2500);
  });

  it.each([null, {}])("leaves an alternate or absent timeline unchanged", (otherTimeline) => {
    const animation = create(500);
    animation.timeline = otherTimeline;
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2500);
  });

  it.each([-1, 0, 2])("does not reinterpret a playback rate of %d", (rate) => {
    const animation = create(500);
    animation.playbackRate = rate;
    const adapter = createWaapiAdapter();
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2500);
  });

  it("preserves late discovery and rediscovery relative to composition time", () => {
    const adapter = createWaapiAdapter();
    create(100);
    adapter.discover();
    adapter.seek({ time: 1 });
    const late = create(0);
    adapter.seek({ time: 1.2 });
    expect(late.currentTime).toBe(0);
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(late.currentTime).toBe(800);
  });

  it("can capture initial animations again after revert", () => {
    const adapter = createWaapiAdapter();
    const animation = create();
    adapter.discover();
    adapter.seek({ time: 2 });
    adapter.revert();
    animation.currentTime = 300;
    animation.playState = "running";
    adapter.discover();
    adapter.seek({ time: 2 });
    expect(animation.currentTime).toBe(2000);
  });
});
