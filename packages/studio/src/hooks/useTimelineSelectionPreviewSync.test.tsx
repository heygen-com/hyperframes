// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { installReactActEnvironment, makeSelection } from "./domSelectionTestHarness";
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
}

afterEach(() => {
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
    { id: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
    { id: "clip-2", tag: "div", start: 1, duration: 1, track: 1 },
  ];
  const selectionById = new Map([
    ["clip-1", firstSelection],
    ["clip-2", secondSelection],
  ]);
  return { firstSelection, secondSelection, timelineElements, selectionById };
}

describe("useTimelineSelectionPreviewSync", () => {
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
    });

    expect(applyMarqueeSelection).toHaveBeenCalledWith([secondSelection, firstSelection], false);
    expect(applyDomSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("clears preview selection when the timeline selection set is empty", async () => {
    const { firstSelection, timelineElements, selectionById } = makeSyncFixture();
    const applyDomSelection = vi.fn();
    const applyMarqueeSelection = vi.fn();
    const harness = renderHarness();

    await harness.rerender({
      selectedElementId: null,
      selectedElementIds: new Set(),
      timelineElements,
      domEditSelection: firstSelection,
      domEditGroupSelections: [firstSelection],
      buildDomSelectionForTimelineElement: vi.fn(async (element: TimelineElement) => {
        return selectionById.get(element.id) ?? null;
      }),
      applyDomSelection,
      applyMarqueeSelection,
    });

    expect(applyDomSelection).toHaveBeenCalledWith(null, { revealPanel: false });
    expect(applyMarqueeSelection).not.toHaveBeenCalled();
    harness.cleanup();
  });
});
