import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player";
import { resolveTimelineAssetDrop } from "../player/components/timelineLayout";
import {
  parseTimelineCompositionPayload,
  resolveTimelineCompositionDrop,
} from "./timelineCompositionDrop";

const element = (id: string, track: number, start: number, duration: number): TimelineElement => ({
  id,
  tag: "div",
  track,
  start,
  duration,
});

const geometry = {
  rectLeft: 100,
  rectTop: 20,
  scrollLeft: 200,
  scrollTop: 0,
  pixelsPerSecond: 50,
  duration: 10,
  trackHeight: 48,
  trackOrder: [0, 1],
};

describe("timeline composition drop", () => {
  it("maps pointer X through scroll and zoom beyond the current duration", () => {
    const result = resolveTimelineCompositionDrop(
      { ...geometry, elements: [], duration: 3 },
      748,
      100,
    );
    expect(result.start).toBe(15.36);
    expect(result.track).toBe(0);
  });

  it("uses a free visible lane and spills when every visible lane collides", () => {
    expect(
      resolveTimelineCompositionDrop(
        { ...geometry, elements: [element("a", 0, 0, 10)], duration: 3 },
        248,
        100,
      ).track,
    ).toBe(1);
    expect(
      resolveTimelineCompositionDrop(
        {
          ...geometry,
          elements: [element("a", 0, 0, 10), element("b", 1, 0, 10)],
          duration: 3,
        },
        248,
        100,
      ).track,
    ).toBe(2);
  });

  it("keeps asset placement clamped and rejects malformed composition payloads", () => {
    expect(resolveTimelineAssetDrop(geometry, 748, 100).start).toBe(10);
    expect(parseTimelineCompositionPayload('{"sourcePath":"scene.html"}')).toEqual({
      sourcePath: "scene.html",
    });
    expect(parseTimelineCompositionPayload('{"path":"scene.html"}')).toBeNull();
    expect(parseTimelineCompositionPayload("nope")).toBeNull();
  });
});
