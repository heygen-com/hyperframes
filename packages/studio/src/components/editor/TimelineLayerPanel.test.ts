import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import type { DomEditLayerItem } from "./domEditing";
import { getTimelineLayerPanelSummary } from "./TimelineLayerPanel";

function createLayer(overrides: Partial<DomEditLayerItem> = {}): DomEditLayerItem {
  const window = new Window();
  return {
    childCount: 0,
    depth: 0,
    element: window.document.createElement(overrides.tagName ?? "div"),
    key: "layer",
    label: "Layer",
    sourceFile: "index.html",
    tagName: "div",
    ...overrides,
  };
}

describe("TimelineLayerPanel", () => {
  it("describes a leaf media clip as a single selectable layer", () => {
    expect(
      getTimelineLayerPanelSummary([
        createLayer({ key: "alpha-video", label: "Alpha Video", tagName: "video" }),
      ]),
    ).toBe("Single selectable media layer");
  });

  it("describes real nested layers with the nested count", () => {
    expect(
      getTimelineLayerPanelSummary([
        createLayer({ key: "root", childCount: 2 }),
        createLayer({ key: "title", depth: 1 }),
        createLayer({ key: "subtitle", depth: 1 }),
      ]),
    ).toBe("2 nested selectable layers");
  });

  it("keeps empty layer lists explicit", () => {
    expect(getTimelineLayerPanelSummary([])).toBe("No selectable layers");
  });
});
