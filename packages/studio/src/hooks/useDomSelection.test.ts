// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDomSelection } from "./useDomSelection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/editor/manualEditingAvailability", () => ({
  STUDIO_INSPECTOR_PANELS_ENABLED: false,
}));

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("useDomSelection inspector-disabled mode", () => {
  it("forces right panel focus to renders on mount", () => {
    const focusRightPanelTab = vi.fn();
    const setSelectedTimelineElementId = vi.fn();
    const setRightCollapsed = vi.fn();
    const stableCompIdToSrc = new Map<string, string>();
    const stableTimelineElements: [] = [];
    const stableRightPanelTabs: Array<"design" | "layers" | "motion" | "css" | "renders"> = [
      "design",
    ];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function Harness() {
      useDomSelection({
        projectId: "demo",
        activeCompPath: null,
        isMasterView: true,
        compIdToSrc: stableCompIdToSrc,
        captionEditMode: false,
        previewIframeRef: { current: null },
        timelineElements: stableTimelineElements,
        setSelectedTimelineElementId,
        setRightCollapsed,
        focusRightPanelTab,
        previewIframe: null,
        refreshKey: 0,
        rightPanelTabs: stableRightPanelTabs,
      });
      return null;
    }

    act(() => {
      root.render(React.createElement(Harness));
    });

    expect(focusRightPanelTab).toHaveBeenCalledWith("renders");

    act(() => {
      root.unmount();
      host.remove();
    });
  });
});
