// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStudioHash,
  normalizeStudioCompositionPath,
  normalizeStudioUrlPanelTab,
  parseStudioUrlStateFromHash,
} from "./studioUrlState";
import { useStudioUrlState } from "../hooks/useStudioUrlState";
import { usePlayerStore } from "../player";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetPlayerStore() {
  usePlayerStore.setState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    timelineReady: false,
    elements: [],
    selectedElementId: null,
    requestedSeekTime: null,
  });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  resetPlayerStore();
});

function renderStudioUrlStateHarness(
  props: Partial<React.ComponentProps<typeof StudioUrlStateHarness>> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const baseProps: React.ComponentProps<typeof StudioUrlStateHarness> = {
    projectId: "demo",
    activeCompPath: null,
    currentTime: 0,
    duration: 30,
    isPlaying: false,
    compositionLoading: false,
    refreshKey: 0,
    previewIframeRef: { current: null },
    rightPanelTab: "renders",
    rightCollapsed: true,
    timelineVisible: true,
    activeCompPathHydrated: true,
    domEditSelection: null,
    buildDomSelectionFromTarget: () => Promise.resolve(null),
    applyDomSelection: () => {},
    initialState: {
      activeCompPath: null,
      currentTime: 4.2,
      rightPanelTab: null,
      rightCollapsed: null,
      timelineVisible: null,
      selection: null,
    },
  };

  const render = (nextProps: Partial<React.ComponentProps<typeof StudioUrlStateHarness>> = {}) => {
    act(() => {
      root.render(
        React.createElement(StudioUrlStateHarness, {
          ...baseProps,
          ...props,
          ...nextProps,
        }),
      );
    });
  };

  render();
  return {
    rerender: render,
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

function StudioUrlStateHarness(props: Parameters<typeof useStudioUrlState>[0]) {
  useStudioUrlState(props);
  return null;
}

describe("studio url state", () => {
  it("parses persisted studio state from project hash", () => {
    const state = parseStudioUrlStateFromHash(
      "#project/demo?v=1&comp=compositions%2Ftitle.html&t=4.25&tab=design&rc=0&tv=1&selFile=index.html&selId=hero",
    );

    expect(state.activeCompPath).toBe("compositions/title.html");
    expect(state.currentTime).toBe(4.25);
    expect(state.rightPanelTab).toBe("design");
    expect(state.rightCollapsed).toBe(false);
    expect(state.timelineVisible).toBe(true);
    expect(state.selection).toEqual({
      sourceFile: "index.html",
      id: "hero",
      selector: undefined,
      selectorIndex: undefined,
    });
  });

  it("builds a project hash with persisted studio state", () => {
    expect(
      buildStudioHash("demo", {
        activeCompPath: "compositions/title.html",
        currentTime: 4.2571,
        rightPanelTab: "layers",
        rightCollapsed: true,
        timelineVisible: false,
        selection: {
          sourceFile: "index.html",
          selector: ".card",
          selectorIndex: 2,
        },
      }),
    ).toBe(
      "#project/demo?v=1&comp=compositions%2Ftitle.html&t=4.257&tab=layers&rc=1&tv=0&selFile=index.html&selSelector=.card&selIndex=2",
    );
  });

  it("falls back cleanly on invalid values", () => {
    const state = parseStudioUrlStateFromHash("#project/demo?tab=nope&t=abc&rc=9&tv=7");

    expect(state.activeCompPath).toBeNull();
    expect(state.currentTime).toBeNull();
    expect(state.rightPanelTab).toBeNull();
    expect(state.rightCollapsed).toBeNull();
    expect(state.timelineVisible).toBeNull();
    expect(state.selection).toBeNull();
  });

  it("normalizes stale composition paths to the master composition", () => {
    expect(
      normalizeStudioCompositionPath("compositions/missing.html", [
        "index.html",
        "compositions/title.html",
      ]),
    ).toBeNull();
    expect(
      normalizeStudioCompositionPath("compositions/title.html", [
        "index.html",
        "compositions/title.html",
      ]),
    ).toBe("compositions/title.html");
  });

  it("normalizes url tabs against feature flags", () => {
    expect(normalizeStudioUrlPanelTab("renders")).toBe("renders");
    expect(normalizeStudioUrlPanelTab("layers", { inspectorPanelsEnabled: false })).toBe("renders");
    expect(normalizeStudioUrlPanelTab("motion", { motionPanelEnabled: false })).toBe("design");
  });

  it("hydrates seek first, preserves the initial url state, then restores selection", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "#project/demo?t=4.2&tab=design&selId=hero");
    const requestSeek = vi.fn();
    usePlayerStore.setState({ requestSeek });
    const selectedElement = document.createElement("div");
    selectedElement.id = "hero";
    document.body.append(selectedElement);
    const previewDoc = document.implementation.createHTMLDocument("preview");
    previewDoc.body.append(selectedElement);
    const applyDomSelection = vi.fn();
    const restoredSelection = {
      element: selectedElement,
      id: "hero",
      selector: "#hero",
      selectorIndex: 0,
      sourceFile: "index.html",
      tagName: "div",
      label: "Hero",
      textContent: "",
      textFields: [],
      capabilities: {
        canEditText: false,
        canEditLayout: true,
        canApplyManualOffset: true,
        canApplyManualSize: true,
        canApplyManualRotation: true,
        canAdjustOpacity: true,
        canAdjustFill: true,
        canAdjustBorderRadius: true,
        canAdjustStroke: true,
        canAdjustShadow: true,
        canAdjustZIndex: true,
      },
      computedStyle: {
        display: "block",
        position: "absolute",
      },
    };

    const harness = renderStudioUrlStateHarness({
      previewIframeRef: {
        current: { contentDocument: previewDoc } as HTMLIFrameElement,
      },
      rightPanelTab: "design",
      rightCollapsed: false,
      applyDomSelection,
      buildDomSelectionFromTarget: () => Promise.resolve(restoredSelection),
      initialState: {
        activeCompPath: null,
        currentTime: 4.2,
        rightPanelTab: "design",
        rightCollapsed: false,
        timelineVisible: true,
        selection: { id: "hero" },
      },
    });

    expect(requestSeek).toHaveBeenCalledWith(4.2);
    expect(applyDomSelection).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("t=4.2");
    expect(window.location.hash).toContain("tab=design");

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(window.location.hash).toContain("t=4.2");
    expect(applyDomSelection).not.toHaveBeenCalled();

    // Drive the hook's internal currentTime read. Per #1311 the hook stopped
    // taking currentTime as a prop and now subscribes to the player store
    // directly (usePlayerStore((s) => s.currentTime)). The harness prop is a
    // no-op; the selection-hydration useEffect's time-stability guard
    // (`Math.abs(currentTime - stableTimeRef.current) > 0.05`) only passes
    // once the store's currentTime catches up to the seek target.
    act(() => {
      usePlayerStore.setState({ currentTime: 4.2 });
    });
    harness.rerender({ currentTime: 4.2 });
    await act(async () => {
      vi.advanceTimersByTime(250);
      // Flush microtasks so the async buildDomSelectionFromTarget Promise resolves
      await Promise.resolve();
    });
    expect(applyDomSelection).toHaveBeenCalledWith(restoredSelection, { revealPanel: false });

    harness.rerender({ currentTime: 4.2, domEditSelection: restoredSelection });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(window.location.hash).toContain("t=4.2");
    expect(window.location.hash).toContain("selId=hero");

    harness.unmount();
  });
});
