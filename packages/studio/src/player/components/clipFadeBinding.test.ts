import { describe, expect, it, vi } from "vitest";
import type { HfAutomation } from "@hyperframes/core/audio-automation";
import type { TimelineElement } from "../store/playerStore";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import { resolveClipFadeBinding, type ClipFadeDeps } from "./clipFadeBinding";

const EMPTY: HfAutomation = { version: 1, lanes: [] };

function el(over: Partial<TimelineElement> = {}): TimelineElement {
  return {
    id: "clip",
    key: "clip",
    tag: "div",
    start: 0,
    duration: 10,
    track: 0,
    domId: "clip",
    ...over,
  };
}

const audio = (over: Partial<TimelineElement> = {}) =>
  el({ id: "music", key: "music", tag: "audio", src: "bgm.m4a", ...over });

function deps(options: { automation?: HfAutomation; readOnly?: boolean } = {}) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const bag: ClipFadeDeps = {
    bindAutomation: () =>
      ({
        automation: options.automation ?? EMPTY,
        lanes: (options.automation ?? EMPTY).lanes,
        chain: null,
        readOnly: options.readOnly ?? false,
        onPreview,
        onCommit,
      }) as unknown as AutomationLaneBinding,
  };
  return { bag, onPreview, onCommit };
}

/** The points a write produced, for whichever lane the clip should have used. */
const laneOf = (call: unknown, target: string) =>
  (call as HfAutomation).lanes.find((l) => l.target === target)?.points.map((p) => [p.t, p.v]);

const withLane = (target: string, points: { t: number; v: number; curve?: number }[]) =>
  ({ version: 1, lanes: [{ target, points }] }) as HfAutomation;

describe("which lane a clip's fade lives in", () => {
  it("puts a picture's fade in the opacity lane", () => {
    const { bag, onCommit } = deps();
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 2, fadeOut: 0 });
    expect(laneOf(onCommit.mock.calls[0]![0], "opacity")).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });

  it("puts a sound's fade in the volume lane", () => {
    const { bag, onCommit } = deps();
    resolveClipFadeBinding(audio(), bag)!.onCommit({ fadeIn: 2, fadeOut: 0 });
    expect(laneOf(onCommit.mock.calls[0]![0], "volume")).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });

  it("writes no attribute of its own, on either kind of clip", () => {
    // The whole storage is data-automation. If this binding ever grows a second
    // way to record a fade, these two lanes stop being the source of truth.
    const { bag, onCommit } = deps();
    const binding = resolveClipFadeBinding(el(), bag)!;
    expect(Object.keys(binding)).not.toContain("writeAttribute");
    binding.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("has no fade to offer a clip with no length", () => {
    expect(resolveClipFadeBinding(el({ duration: 0 }), deps().bag)).toBeUndefined();
  });
});

describe("reading a fade back", () => {
  it("reads a picture's fade off its opacity lane", () => {
    const { bag } = deps({
      automation: withLane("opacity", [
        { t: 0, v: 0 },
        { t: 1.5, v: 1 },
        { t: 8, v: 1 },
        { t: 10, v: 0 },
      ]),
    });
    expect(resolveClipFadeBinding(el(), bag)!.fades).toEqual({ fadeIn: 1.5, fadeOut: 2 });
  });

  it("does not mistake a sound's volume lane for a picture's fade", () => {
    const { bag } = deps({
      automation: withLane("volume", [
        { t: 0, v: 0 },
        { t: 1.5, v: 1 },
      ]),
    });
    // Same clip is a div, so it looks at opacity and finds nothing.
    expect(resolveClipFadeBinding(el(), bag)!.fades).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it("reads a bend off the point each ramp leaves", () => {
    const { bag } = deps({
      automation: withLane("opacity", [
        { t: 0, v: 0, curve: 0.5 },
        { t: 2, v: 1 },
        { t: 8, v: 1, curve: -0.25 },
        { t: 10, v: 0 },
      ]),
    });
    // Stored curvature is the bend read from the other end; see readFadeCurve.
    expect(resolveClipFadeBinding(el(), bag)!.curves).toEqual({ in: -0.5, out: 0.25 });
  });
});

describe("writing a fade", () => {
  it("previews without persisting, and commits once", () => {
    const { bag, onPreview, onCommit } = deps();
    const fade = resolveClipFadeBinding(el(), bag)!;
    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(laneOf(onPreview.mock.calls[0]![0], "opacity")).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("drops the lane entirely once the last fade is dragged away", () => {
    const { bag, onCommit } = deps({
      automation: withLane("opacity", [
        { t: 0, v: 0 },
        { t: 2, v: 1 },
      ]),
    });
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 0, fadeOut: 0 });
    expect((onCommit.mock.calls[0]![0] as HfAutomation).lanes).toEqual([]);
  });

  it("writes nothing through a read-only binding", () => {
    const { bag, onPreview, onCommit } = deps({ readOnly: true });
    const fade = resolveClipFadeBinding(el(), bag)!;
    expect(fade.readOnly).toBe(true);
    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    fade.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a point the author placed between the two fades", () => {
    // The grips own the head and the tail. Everything in the middle is somebody
    // else's envelope and has to survive a fade being redrawn.
    const { bag, onCommit } = deps({
      automation: withLane("opacity", [{ t: 5, v: 0.4 }]),
    });
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 1, fadeOut: 1 });
    expect(laneOf(onCommit.mock.calls[0]![0], "opacity")).toEqual([
      [0, 0],
      [1, 1],
      [5, 0.4],
      [9, 1],
      [10, 0],
    ]);
  });
});

describe("the two ramps bend apart", () => {
  const bothFades = () =>
    deps({
      automation: withLane("opacity", [
        { t: 0, v: 0 },
        { t: 1, v: 1 },
        { t: 9, v: 1 },
        { t: 10, v: 0 },
      ]),
    });

  it("bends the head and leaves the tail alone", () => {
    const { bag, onCommit } = bothFades();
    resolveClipFadeBinding(el(), bag)!.onBend("in", -0.5, true);
    const points = (onCommit.mock.calls[0]![0] as HfAutomation).lanes[0]!.points;
    expect(points[0]?.curve).toBeCloseTo(0.5, 6);
    expect(points[2]?.curve).toBeUndefined();
  });

  it("bends the tail and leaves the head alone", () => {
    const { bag, onCommit } = bothFades();
    resolveClipFadeBinding(el(), bag)!.onBend("out", 0.25, true);
    const points = (onCommit.mock.calls[0]![0] as HfAutomation).lanes[0]!.points;
    expect(points[0]?.curve).toBeUndefined();
    expect(points[2]?.curve).toBeCloseTo(-0.25, 6);
  });

  it("previews a bend without persisting it", () => {
    const { bag, onPreview, onCommit } = bothFades();
    resolveClipFadeBinding(el(), bag)!.onBend("in", -0.3, false);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("a second gesture sees the first one", () => {
  it("draws a fade out without dropping the fade in", () => {
    // The regression this guards: the quiet commit reaches the file and the
    // preview but skips the refresh that re-derives the timeline. Draw a fade
    // in, draw a fade out a moment later, and the second write was computed
    // from a clip that still looked like it had none, which dropped the first.
    // useAutomationLanes now catches the store up on persist; here we stand in
    // for that by binding against what the first write produced.
    const first = deps();
    resolveClipFadeBinding(el(), first.bag)!.onCommit({ fadeIn: 1.5, fadeOut: 0 });
    const afterFirst = first.onCommit.mock.calls[0]![0] as HfAutomation;

    const second = deps({ automation: afterFirst });
    const binding = resolveClipFadeBinding(el(), second.bag)!;
    // The second gesture starts from the fade the first one drew.
    expect(binding.fades).toEqual({ fadeIn: 1.5, fadeOut: 0 });
    binding.onCommit({ fadeIn: 1.5, fadeOut: 2 });
    expect(laneOf(second.onCommit.mock.calls[0]![0], "opacity")).toEqual([
      [0, 0],
      [1.5, 1],
      [8, 1],
      [10, 0],
    ]);
  });
});
