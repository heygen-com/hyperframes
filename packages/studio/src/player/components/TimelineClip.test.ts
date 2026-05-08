import { describe, expect, it } from "vitest";
import { getTimelineClipControlPresentation } from "./TimelineClip";

describe("getTimelineClipControlPresentation", () => {
  it("collapses persistent controls for compact clips until the clip is interactive", () => {
    expect(
      getTimelineClipControlPresentation({
        widthPx: 42,
        isHovered: false,
        isSelected: false,
        isInspectorActive: false,
        isThumbnailActive: false,
        isDragging: false,
      }),
    ).toMatchObject({
      compact: true,
      showControls: false,
    });
  });

  it("shows compact controls when the clip is hovered, selected, or active", () => {
    expect(
      getTimelineClipControlPresentation({
        widthPx: 42,
        isHovered: true,
        isSelected: false,
        isInspectorActive: false,
        isThumbnailActive: false,
        isDragging: false,
      }),
    ).toMatchObject({
      compact: true,
      showControls: true,
    });

    expect(
      getTimelineClipControlPresentation({
        widthPx: 42,
        isHovered: false,
        isSelected: false,
        isInspectorActive: true,
        isThumbnailActive: false,
        isDragging: false,
      }).showControls,
    ).toBe(true);
  });

  it("keeps controls visible on wide clips", () => {
    expect(
      getTimelineClipControlPresentation({
        widthPx: 120,
        isHovered: false,
        isSelected: false,
        isInspectorActive: false,
        isThumbnailActive: false,
        isDragging: false,
      }),
    ).toMatchObject({
      compact: false,
      showControls: true,
    });
  });

  it("treats medium-width clips as compact so dense tracks do not turn into icon grids", () => {
    expect(
      getTimelineClipControlPresentation({
        widthPx: 96,
        isHovered: false,
        isSelected: false,
        isInspectorActive: false,
        isThumbnailActive: false,
        isDragging: false,
      }),
    ).toMatchObject({
      compact: true,
      showControls: false,
    });
  });

  it("hides controls while dragging", () => {
    expect(
      getTimelineClipControlPresentation({
        widthPx: 120,
        isHovered: true,
        isSelected: true,
        isInspectorActive: true,
        isThumbnailActive: true,
        isDragging: true,
      }).showControls,
    ).toBe(false);
  });
});
