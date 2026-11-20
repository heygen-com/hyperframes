import { gsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveRetime, parseLiveRetime, type LiveRetimeParams } from "./liveRetime";

type TestWindow = Window & Record<string, unknown>;
const win = window as TestWindow;
const script = (start: number) =>
  `var tl = gsap.timeline({ paused: true }); tl.to("#a", { x: 100, duration: 1 }, ${start}); window.__timelines["t"] = tl;`;
const MOVE = {
  selector: "#a",
  start: 1.5,
  duration: 1,
  wasStart: 0.5,
  wasDuration: 1,
  moved: true,
};
const params = (over: Partial<LiveRetimeParams> = {}): LiveRetimeParams => ({
  key: "t",
  after: script(1.5),
  time: 2,
  tweens: [{ ...MOVE, source: 0 }],
  timing: [],
  ...over,
});

function preview() {
  document.body.innerHTML = `<div data-composition-id="t" data-duration="3"><div id="a" data-start="0.5" data-duration="1"></div></div><script type="text/plain">${script(0.5)}</script>`;
  win.__timelines = {};
  new Function("gsap", "window", script(0.5))(gsap, win);
  win.__hfForceTimelineRebind = vi.fn();
  win.__player = { seek: vi.fn() };
  const timeline = (win.__timelines as Record<string, gsap.core.Timeline>).t!;
  const start = () => timeline.getChildren(false, true, false)[0]!.startTime();
  return { start, text: () => document.querySelector("script")!.textContent };
}

afterEach(() => {
  document.body.innerHTML = "";
  for (const key of ["__timelines", "__hfForceTimelineRebind", "__player"]) delete win[key];
});

describe("live-retime", () => {
  it("moves the live tween to the planned start, records the saved script, and re-seeks", () => {
    const live = preview();

    expect(liveRetime(params())).toEqual({ result: "moved" });

    expect(live.start()).toBe(1.5);
    expect(live.text()).toBe(script(1.5));
    expect(win.__hfForceTimelineRebind).toHaveBeenCalledOnce();
    expect((win.__player as { seek: ReturnType<typeof vi.fn> }).seek).toHaveBeenCalledWith(2);
  });

  it("moves nothing when the live timeline is not where the plan says it was", () => {
    const live = preview();

    const stale = params({ tweens: [{ ...MOVE, wasStart: 0.7, source: 0 }] });
    expect(liveRetime(stale)).toEqual({ result: "unchanged" });

    expect(live.start()).toBe(0.5);
    expect(live.text()).toBe(script(0.5));
    expect(win.__hfForceTimelineRebind).not.toHaveBeenCalled();
  });
});

describe("live-retime of a timing edit", () => {
  const timing: LiveRetimeParams["timing"] = [["#a", [["data-start", "1.5"]]]];

  it("puts the saved clip timing on the live element before the rebind derives its window", () => {
    preview();
    const clip = document.getElementById("a")!;
    const seen: Array<string | null> = [];
    win.__hfForceTimelineRebind = () => seen.push(clip.getAttribute("data-start"));

    expect(liveRetime(params({ timing }))).toEqual({ result: "moved" });
    expect(seen).toEqual(["1.5"]);
  });

  it("leaves the clip's timing to the re-run when its tweens cannot move", () => {
    preview();
    const stale = params({ timing, tweens: [{ ...MOVE, wasStart: 0.7, source: 0 }] });
    expect(liveRetime(stale)).toEqual({ result: "unchanged" });
    expect(document.getElementById("a")!.getAttribute("data-start")).toBe("0.5");
  });

  it("moves nothing and asks for a reload when a timed element of the saved file is not in the preview", () => {
    const live = preview();
    expect(liveRetime(params({ timing: [["#gone", [["data-start", "1"]]]] }))).toEqual({
      result: "failed",
    });
    expect(live.start()).toBe(0.5);
  });
});

describe("parseLiveRetime", () => {
  it("accepts a bounded plan", () => {
    expect(parseLiveRetime(params())).toEqual(params());
  });

  it.each([
    ["an extra field", { ...params(), script: "x" }],
    ["a tween with an extra field", params({ tweens: [{ ...MOVE, source: 0, x: 1 } as never] })],
    ["a non-finite start", params({ tweens: [{ ...MOVE, start: Infinity, source: 0 }] })],
    ["a negative length", params({ tweens: [{ ...MOVE, duration: -1, source: 0 }] })],
    ["a fractional source", params({ tweens: [{ ...MOVE, source: 0.5 }] })],
    ["no tweens", params({ tweens: [] })],
    ["a negative time", params({ time: -1 })],
    ["a timing attribute that is not timing", params({ timing: [["#a", [["class", "x"]]]] })],
  ])("refuses %s", (_label, request) => {
    expect(parseLiveRetime(request)).toBeNull();
  });
});
