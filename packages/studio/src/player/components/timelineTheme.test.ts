import { describe, expect, it } from "vitest";
import {
  getClipHandleOpacity,
  getRenderedTimelineElement,
  getTimelineTrackStyle,
} from "./timelineTheme";

describe("getTimelineTrackStyle", () => {
  it("reuses heading styles for heading tags", () => {
    expect(getTimelineTrackStyle("h2").accent).toBe(getTimelineTrackStyle("h1").accent);
  });

  it("falls back for unknown tags", () => {
    expect(getTimelineTrackStyle("custom-tag").accent).toBe("#3CE6AC");
  });
});

describe("getClipHandleOpacity", () => {
  it("hides handles at rest", () => {
    expect(getClipHandleOpacity({ isHovered: false, isSelected: false, isDragging: false })).toBe(
      0,
    );
  });

  it("prioritizes dragging over hover and selection", () => {
    expect(getClipHandleOpacity({ isHovered: true, isSelected: true, isDragging: true })).toBe(
      0.95,
    );
  });
});

describe("getRenderedTimelineElement", () => {
  it("keeps non-dragged clips unchanged", () => {
    const element = { id: "a", tag: "div", start: 1, duration: 2, track: 0 };
    expect(
      getRenderedTimelineElement({
        element,
        draggedElementId: "b",
        previewStart: 2,
        previewTrack: 1,
      }),
    ).toEqual(element);
  });

  it("moves the actual dragged clip to the preview position", () => {
    const element = { id: "a", tag: "div", start: 1, duration: 2, track: 0 };
    expect(
      getRenderedTimelineElement({
        element,
        draggedElementId: "a",
        previewStart: 2.4,
        previewTrack: 3,
      }),
    ).toEqual({ ...element, start: 2.4, track: 3 });
  });
});
