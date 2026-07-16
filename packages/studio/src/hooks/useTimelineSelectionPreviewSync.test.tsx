// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { installReactActEnvironment, makeSelection } from "./domSelectionTestHarness";
import { useDomSelection } from "./useDomSelection";
import { useTimelineSelectionPreviewSync } from "./useTimelineSelectionPreviewSync";

installReactActEnvironment();

interface HarnessProps {
  selectedElementId: string | null;
  selectedElementIds: Set<string>;
  timelineElements: TimelineElement[];
  domEditSelection: DomEditSelection | null;
  domEditGroupSelections: DomEditSelection[];
  buildDomSelectionForTimelineElement: (
    element: TimelineElement,
  ) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean; additive?: boolean; preserveGroup?: boolean },
  ) => void;
  applyMarqueeSelection: (selections: DomEditSelection[], additive: boolean) => void;
  onSelectionNotFound: () => void;
}

afterEach(() => {
  act(() => usePlayerStore.getState().clearSelection());
  document.body.innerHTML = "";
});

function renderHarness() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  function Harness(nextProps: HarnessProps) {
    useTimelineSelectionPreviewSync({
      ...nextProps,
      activeCompPath: "index.html",
    });
    return null;
  }

  const rerender = async (nextProps: HarnessProps) => {
    await act(async () => {
      root.render(React.createElement(Harness, nextProps));
      await Promise.resolve();
    });
  };

  return {
    rerender,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function makeSyncFixture() {
  const firstElement = document.createElement("div");
  firstElement.id = "clip-1";
  const secondElement = document.createElement("div");
  secondElement.id = "clip-2";
  const firstSelection = makeSelection("First", firstElement);
  const secondSelection = makeSelection("Second", secondElement);
  const timelineElements: TimelineElement[] = [
    { id: "clip-1", domId: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
    { id: "clip-2", domId: "clip-2", tag: "div", start: 1, duration: 1, track: 1 },
  ];
  const selectionById = new Map([
    ["clip-1", firstSelection],
    ["clip-2", secondSelection],
  ]);
  return { firstSelection, secondSelection, timelineElements, selectionById };
}

function renderStoreRoundTripHarness() {
  const fixture = makeSyncFixture();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let currentGroup: DomEditSelection[] = [];

  function Harness() {
    const selectedElementId = usePlayerStore((state) => state.selectedElementId);
    const selectedElementIds = usePlayerStore((state) => state.selectedElementIds);
    const domSelection = useDomSelection({
      projectId: "project-1",
      activeCompPath: "index.html",
      isMasterView: true,
      compIdToSrc: new Map(),
      captionEditMode: false,
      previewIframeRef: { current: null },
      timelineElements: fixture.timelineElements,
      setSelectedTimelineElementId: usePlayerStore.getState().setSelectedElementId,
      setTimelineSelection: usePlayerStore.getState().setSelection,
      setRightCollapsed: vi.fn(),
      setRightPanelTab: vi.fn(),
      previewIframe: null,
      refreshKey: 0,
      rightPanelTab: "design",
    });
    currentGroup = domSelection.domEditGroupSelections;
    useTimelineSelectionPreviewSync({
      selectedElementId,
      selectedElementIds,
      timelineElements: fixture.timelineElements,
      domEditSelection: domSelection.domEditSelection,
      domEditGroupSelections: domSelection.domEditGroupSelections,
      activeCompPath: "index.html",
      buildDomSelectionForTimelineElement: async (element) =>
        fixture.selectionById.get(element.id) ?? null,
      applyDomSelection: domSelection.applyDomSelection,
      applyMarqueeSelection: domSelection.applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    });
    return null;
  }

  return {
    fixture,
    currentGroup: () => currentGroup,
    render: async () => {
      await act(async () => {
        root.render(React.createElement(Harness));
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("useTimelineSelectionPreviewSync", () => {
  it("round-trips a store multi-selection without collapsing the preview group", async () => {
    const harness = renderStoreRoundTripHarness();
    act(() => usePlayerStore.getState().setSelection(["clip-1", "clip-2"], "clip-2"));

    await harness.render();

    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["clip-1", "clip-2"]));
    expect(usePlayerStore.getState().selectedElementId).toBe("clip-2");
    expect(harness.currentGroup()).toEqual([
      harness.fixture.secondSelection,
      harness.fixture.firstSelection,
    ]);
    harness.cleanup();
  });

  it("syncs a multi-id timeline selection into preview group selections", async () => {
    const { firstSelection, secondSelection, timelineElements, selectionById } = makeSyncFixture();
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const buildDomSelectionForTimelineElement = vi.fn(async (element: TimelineElement) => {
      return selectionById.get(element.id) ?? null;
    });
    const harness = renderHarness();

    await harness.rerender({
      selectedElementId: "clip-2",
      selectedElementIds: new Set(["clip-1", "clip-2"]),
      timelineElements,
      domEditSelection: null,
      domEditGroupSelections: [],
      buildDomSelectionForTimelineElement,
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    });

    expect(applyMarqueeSelection).toHaveBeenCalledWith([secondSelection, firstSelection], false);
    expect(applyDomSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("preserves an unmapped canvas selection while the timeline selection stays empty", async () => {
    const { timelineElements, selectionById } = makeSyncFixture();
    const canvasChip = document.createElement("button");
    canvasChip.id = "canvas-chip";
    const canvasSelection = makeSelection("Canvas chip", canvasChip);
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const emptySelectedElementIds = new Set<string>();
    const harness = renderHarness();
    const baseProps = {
      selectedElementId: null,
      selectedElementIds: emptySelectedElementIds,
      timelineElements,
      buildDomSelectionForTimelineElement: vi.fn(async (element: TimelineElement) => {
        return selectionById.get(element.id) ?? null;
      }),
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    };

    await harness.rerender({
      ...baseProps,
      domEditSelection: null,
      domEditGroupSelections: [],
    });
    await harness.rerender({
      ...baseProps,
      selectedElementIds: new Set<string>(),
      domEditSelection: canvasSelection,
      domEditGroupSelections: [canvasSelection],
    });

    expect(applyDomSelection).not.toHaveBeenCalled();
    expect(applyMarqueeSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("does not clear a newly selected unmapped canvas element after a mapped store selection", async () => {
    const { firstSelection, timelineElements, selectionById } = makeSyncFixture();
    const canvasChip = document.createElement("button");
    canvasChip.id = "canvas-chip";
    const canvasSelection = makeSelection("Canvas chip", canvasChip);
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const harness = renderHarness();
    const baseProps = {
      timelineElements,
      buildDomSelectionForTimelineElement: vi.fn(async (element: TimelineElement) => {
        return selectionById.get(element.id) ?? null;
      }),
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    };

    await harness.rerender({
      ...baseProps,
      selectedElementId: "clip-1",
      selectedElementIds: new Set(["clip-1"]),
      domEditSelection: firstSelection,
      domEditGroupSelections: [firstSelection],
    });
    await harness.rerender({
      ...baseProps,
      selectedElementId: null,
      selectedElementIds: new Set<string>(),
      domEditSelection: canvasSelection,
      domEditGroupSelections: [canvasSelection],
    });

    expect(applyDomSelection).not.toHaveBeenCalled();
    expect(applyMarqueeSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("clears preview selection when the timeline selection transitions to empty", async () => {
    const { firstSelection, timelineElements, selectionById } = makeSyncFixture();
    const matchingTimelineElements = timelineElements.map((element) =>
      element.id === "clip-1" ? { ...element, domId: "clip-1" } : element,
    );
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const harness = renderHarness();
    const baseProps = {
      timelineElements: matchingTimelineElements,
      domEditSelection: firstSelection,
      domEditGroupSelections: [firstSelection],
      buildDomSelectionForTimelineElement: vi.fn(async (element: TimelineElement) => {
        return selectionById.get(element.id) ?? null;
      }),
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    };

    await harness.rerender({
      ...baseProps,
      selectedElementId: "clip-1",
      selectedElementIds: new Set(["clip-1"]),
    });
    await harness.rerender({
      ...baseProps,
      selectedElementId: null,
      selectedElementIds: new Set(),
    });

    expect(applyDomSelection).toHaveBeenCalledOnce();
    expect(applyDomSelection).toHaveBeenCalledWith(null, { revealPanel: false });
    expect(applyMarqueeSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("does not apply a stale selection after a rapid clip switch", async () => {
    const { firstSelection, secondSelection, timelineElements, selectionById } = makeSyncFixture();
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    let resolveFirstSelection: (selection: DomEditSelection | null) => void = () => undefined;
    const firstSelectionResult = new Promise<DomEditSelection | null>((resolve) => {
      resolveFirstSelection = resolve;
    });
    const buildDomSelectionForTimelineElement = vi.fn((element: TimelineElement) => {
      if (element.id === "clip-1") return firstSelectionResult;
      return Promise.resolve(selectionById.get(element.id) ?? null);
    });
    const harness = renderHarness();
    const baseProps = {
      timelineElements,
      domEditSelection: null,
      domEditGroupSelections: [],
      buildDomSelectionForTimelineElement,
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound: vi.fn(),
    };

    await harness.rerender({
      ...baseProps,
      selectedElementId: "clip-1",
      selectedElementIds: new Set(["clip-1"]),
    });
    await harness.rerender({
      ...baseProps,
      selectedElementId: "clip-2",
      selectedElementIds: new Set(["clip-2"]),
    });
    await act(async () => {
      resolveFirstSelection(firstSelection);
      await firstSelectionResult;
    });

    expect(applyDomSelection).toHaveBeenCalledTimes(1);
    expect(applyDomSelection).toHaveBeenCalledWith(secondSelection);
    harness.cleanup();
  });

  it("reports when a selected timeline element has no live preview node", async () => {
    const { timelineElements } = makeSyncFixture();
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const onSelectionNotFound = vi.fn();
    const harness = renderHarness();

    await harness.rerender({
      selectedElementId: "clip-1",
      selectedElementIds: new Set(["clip-1"]),
      timelineElements,
      domEditSelection: null,
      domEditGroupSelections: [],
      buildDomSelectionForTimelineElement: vi.fn(async () => null),
      applyDomSelection,
      applyMarqueeSelection,
      onSelectionNotFound,
    });

    expect(onSelectionNotFound).toHaveBeenCalledOnce();
    expect(applyDomSelection).not.toHaveBeenCalled();
    expect(applyMarqueeSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });
});
