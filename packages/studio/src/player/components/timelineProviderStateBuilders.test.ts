import { describe, expect, it, vi } from "vitest";
import { buildTimelineMeta, type TimelineMetaBuilderInputs } from "./timelineProviderStateBuilders";

function inputs(overrides: Partial<TimelineMetaBuilderInputs> = {}): TimelineMetaBuilderInputs {
  return {
    emptyState: {} as TimelineMetaBuilderInputs["emptyState"],
    container: {
      ref: vi.fn(),
      "aria-label": "Timeline track view",
      "data-timeline-element-count": 2,
      isDragOver: false,
      activeTool: "select",
      shiftHeld: false,
      accentClass: "ring",
      onMouseMove: vi.fn(),
      onMouseLeave: vi.fn(),
      style: {},
    },
    viewport: {
      ref: vi.fn(),
      tabIndex: -1,
      labelMode: false,
      zoomMode: "fit",
      onScroll: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onLostPointerCapture: vi.fn(),
    },
    elementCount: 2,
    labelColumnWidth: 120,
    razorGuide: null,
    ...overrides,
  };
}

describe("buildTimelineMeta", () => {
  it("uses the drag, tool, and modifier branches for the container class", () => {
    const meta = buildTimelineMeta(
      inputs({
        container: {
          ...inputs().container,
          isDragOver: true,
          activeTool: "razor",
          shiftHeld: true,
        },
      }),
    );
    expect(meta.containerProps.className).toContain("ring");
    expect(meta.containerProps.className).toContain("cursor-crosshair");
  });

  it("uses the label-column inset only in label mode", () => {
    const fit = buildTimelineMeta(inputs());
    const labels = buildTimelineMeta(
      inputs({ viewport: { ...inputs().viewport, labelMode: true } }),
    );
    expect(fit.viewportProps["data-timeline-auto-scroll-left-inset"]).toBe(0);
    expect(labels.viewportProps["data-timeline-auto-scroll-left-inset"]).toBe(120);
  });
});
