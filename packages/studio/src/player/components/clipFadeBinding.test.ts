import { describe, expect, it, vi } from "vitest";
import type { HfAutomation } from "@hyperframes/core/audio-automation";
import type { TimelineElement } from "../store/playerStore";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import { nextFadeCurve, readFadeCurve, resolveClipFadeBinding } from "./clipFadeBinding";

function el(over: Partial<TimelineElement> = {}): TimelineElement {
  return {
    id: "music",
    key: "music",
    tag: "audio",
    src: "bgm.m4a",
    start: 0,
    duration: 10,
    track: 2,
    domId: "music",
    ...over,
  };
}

function binder(automation: HfAutomation, readOnly = false) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const bind = (): AutomationLaneBinding =>
    ({
      automation,
      lanes: automation.lanes,
      chain: null,
      readOnly,
      onPreview,
      onCommit,
    }) as unknown as AutomationLaneBinding;
  return { bind, onPreview, onCommit };
}

const EMPTY: HfAutomation = { version: 1, lanes: [] };
const volumeOf = (call: unknown) =>
  (call as HfAutomation).lanes.find((l) => l.target === "volume")?.points.map((p) => [p.t, p.v]);

describe("resolveClipFadeBinding", () => {
  it("offers no fades on a clip with no audio to fade", () => {
    const { bind } = binder(EMPTY);
    expect(resolveClipFadeBinding(el({ tag: "div", src: undefined }), bind)).toBeUndefined();
  });

  it("reads the clip's existing envelope as its fades", () => {
    const { bind } = binder({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
      ],
    });
    expect(resolveClipFadeBinding(el(), bind)?.fades).toEqual({ fadeIn: 2, fadeOut: 0 });
  });

  it("previews without persisting, and commits once", () => {
    const { bind, onPreview, onCommit } = binder(EMPTY);
    const fade = resolveClipFadeBinding(el(), bind)!;

    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(volumeOf(onPreview.mock.calls[0]![0])).toEqual([
      [0, 0],
      [1, 1],
    ]);

    fade.onCommit({ fadeIn: 1, fadeOut: 2 });
    expect(volumeOf(onCommit.mock.calls[0]![0])).toEqual([
      [0, 0],
      [1, 1],
      [8, 1],
      [10, 0],
    ]);
  });

  it("drops the lane entirely once the last fade is dragged away", () => {
    const { bind, onCommit } = binder({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
      ],
    });
    resolveClipFadeBinding(el(), bind)!.onCommit({ fadeIn: 0, fadeOut: 0 });
    expect((onCommit.mock.calls[0]![0] as HfAutomation).lanes).toEqual([]);
  });

  it("writes nothing through a read-only binding", () => {
    const { bind, onPreview, onCommit } = binder(EMPTY, true);
    const fade = resolveClipFadeBinding(el(), bind)!;
    expect(fade.readOnly).toBe(true);
    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    fade.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps the fade lengths when only the curve is stepped", () => {
    const { bind, onCommit } = binder({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        },
      ],
    });
    const fade = resolveClipFadeBinding(el(), bind)!;
    expect(fade.curve).toBe("linear");
    fade.onCycleCurve();
    const points = (onCommit.mock.calls[0]![0] as HfAutomation).lanes[0]!.points;
    expect(points.map((p) => [p.t, p.v])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(points[0]!.curve).toBeCloseTo(0.35, 6);
  });
});

describe("fade curves", () => {
  it("names the curvature a fade was written with", () => {
    expect(readFadeCurve(undefined)).toBe("linear");
    expect(readFadeCurve(0)).toBe("linear");
    expect(readFadeCurve(0.35)).toBe("smooth");
    expect(readFadeCurve(-0.45)).toBe("sharp");
    // Something hand-authored that matches no shape reads as the plain one.
    expect(readFadeCurve(0.9)).toBe("linear");
  });

  it("cycles through every shape and back", () => {
    expect(nextFadeCurve("linear")).toBe("smooth");
    expect(nextFadeCurve("smooth")).toBe("sharp");
    expect(nextFadeCurve("sharp")).toBe("linear");
  });
});
