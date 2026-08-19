import { describe, expect, it, vi } from "vitest";
import type { HfAutomation } from "@hyperframes/core/audio-automation";
import type { TimelineElement } from "../store/playerStore";
import type { AutomationLaneBinding } from "./useAutomationLanes";
import {
  nextFadeCurve,
  readFadeCurve,
  resolveClipFadeBinding,
  type ClipFadeDeps,
} from "./clipFadeBinding";

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

/** A deps bag with both paths stubbed, plus the spies to assert against. */
function deps(options: { automation?: HfAutomation; readOnly?: boolean; selected?: boolean } = {}) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const writeAttribute = vi.fn();
  const updateElement = vi.fn();
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
    writeAttribute,
    isSelected: () => options.selected ?? true,
    updateElement,
  };
  return { bag, onPreview, onCommit, writeAttribute, updateElement };
}

const volumeOf = (call: unknown) =>
  (call as HfAutomation).lanes.find((l) => l.target === "volume")?.points.map((p) => [p.t, p.v]);

describe("resolveClipFadeBinding — which storage a clip uses", () => {
  it("gives a visual clip the attribute path", () => {
    const { bag, writeAttribute, onCommit } = deps();
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 2, fadeOut: 0 });
    expect(writeAttribute).toHaveBeenCalledWith("data-fade-in", "2", true, expect.anything());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("gives an audio clip the envelope path", () => {
    const { bag, writeAttribute, onCommit } = deps();
    resolveClipFadeBinding(audio(), bag)!.onCommit({ fadeIn: 2, fadeOut: 0 });
    expect(volumeOf(onCommit.mock.calls[0]![0])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(writeAttribute).not.toHaveBeenCalled();
  });

  it("offers nothing on a clip with no length to fade across", () => {
    const { bag } = deps();
    expect(resolveClipFadeBinding(el({ duration: 0 }), bag)).toBeUndefined();
  });
});

describe("visual fades", () => {
  it("reads the clip's declared attributes", () => {
    const { bag } = deps();
    const fade = resolveClipFadeBinding(
      el({ fadeIn: "1.5", fadeOut: "2", fadeCurve: "smooth" }),
      bag,
    )!;
    expect(fade.fades).toEqual({ fadeIn: 1.5, fadeOut: 2 });
    expect(fade.curve).toBe("smooth");
  });

  it("previews without persisting, and only writes the end that moved", () => {
    const { bag, writeAttribute } = deps();
    const fade = resolveClipFadeBinding(el({ fadeIn: "1" }), bag)!;
    fade.onPreview({ fadeIn: 2, fadeOut: 0 });
    expect(writeAttribute).toHaveBeenCalledTimes(1);
    expect(writeAttribute).toHaveBeenCalledWith("data-fade-in", "2", false, expect.anything());
  });

  it("removes the attribute when the fade is dragged back to nothing", () => {
    const { bag, writeAttribute } = deps();
    resolveClipFadeBinding(el({ fadeIn: "2" }), bag)!.onCommit({ fadeIn: 0, fadeOut: 0 });
    expect(writeAttribute).toHaveBeenCalledWith("data-fade-in", null, true, expect.anything());
  });

  it("leaves the curve attribute off while it is the default", () => {
    const { bag, writeAttribute } = deps();
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(writeAttribute).not.toHaveBeenCalledWith(
      "data-fade-curve",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("writes the curve once it is stepped, and drops it back at linear", () => {
    const stepped = deps();
    resolveClipFadeBinding(el({ fadeIn: "1" }), stepped.bag)!.onCycleCurve();
    expect(stepped.writeAttribute).toHaveBeenCalledWith(
      "data-fade-curve",
      "smooth",
      true,
      expect.anything(),
    );

    const back = deps();
    resolveClipFadeBinding(el({ fadeIn: "1", fadeCurve: "sharp" }), back.bag)!.onCycleCurve();
    expect(back.writeAttribute).toHaveBeenCalledWith(
      "data-fade-curve",
      null,
      true,
      expect.anything(),
    );
  });

  it("shares a clip too short for both fades rather than overlapping them", () => {
    const { bag } = deps();
    const fade = resolveClipFadeBinding(el({ duration: 4, fadeIn: "3", fadeOut: "3" }), bag)!;
    expect(fade.fades.fadeIn + fade.fades.fadeOut).toBeCloseTo(4, 6);
  });

  it("writes nothing for a clip that is not the selected one", () => {
    const { bag, writeAttribute, updateElement } = deps({ selected: false });
    const fade = resolveClipFadeBinding(el(), bag)!;
    expect(fade.readOnly).toBe(true);
    fade.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(writeAttribute).not.toHaveBeenCalled();
    expect(updateElement).not.toHaveBeenCalled();
  });

  it("applies the fade to the store too, so the grip reads back what it wrote", () => {
    const { bag, updateElement } = deps();
    resolveClipFadeBinding(el(), bag)!.onCommit({ fadeIn: 2, fadeOut: 0 });
    expect(updateElement).toHaveBeenCalledWith("clip", {
      fadeIn: "2",
      fadeOut: undefined,
      fadeCurve: undefined,
    });
  });

  it("is read-only with no edit session at all", () => {
    const { bag } = deps();
    const fade = resolveClipFadeBinding(el(), { ...bag, writeAttribute: undefined })!;
    expect(fade.readOnly).toBe(true);
  });
});

describe("audio fades", () => {
  const withFade: HfAutomation = {
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
  };

  it("reads the clip's existing envelope as its fades", () => {
    const { bag } = deps({ automation: withFade });
    expect(resolveClipFadeBinding(audio(), bag)!.fades).toEqual({ fadeIn: 2, fadeOut: 0 });
  });

  it("previews without persisting, and commits once", () => {
    const { bag, onPreview, onCommit } = deps();
    const fade = resolveClipFadeBinding(audio(), bag)!;
    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(volumeOf(onPreview.mock.calls[0]![0])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("drops the lane entirely once the last fade is dragged away", () => {
    const { bag, onCommit } = deps({ automation: withFade });
    resolveClipFadeBinding(audio(), bag)!.onCommit({ fadeIn: 0, fadeOut: 0 });
    expect((onCommit.mock.calls[0]![0] as HfAutomation).lanes).toEqual([]);
  });

  it("writes nothing through a read-only binding", () => {
    const { bag, onPreview, onCommit } = deps({ readOnly: true });
    const fade = resolveClipFadeBinding(audio(), bag)!;
    expect(fade.readOnly).toBe(true);
    fade.onPreview({ fadeIn: 1, fadeOut: 0 });
    fade.onCommit({ fadeIn: 1, fadeOut: 0 });
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps the fade lengths when only the curve is stepped", () => {
    const { bag, onCommit } = deps({ automation: withFade });
    const fade = resolveClipFadeBinding(audio(), bag)!;
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
  it("names the curvature an audio fade was written with", () => {
    expect(readFadeCurve(undefined)).toBe("linear");
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
