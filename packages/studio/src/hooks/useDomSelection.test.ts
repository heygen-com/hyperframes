// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "./domSelectionTestHarness";
import { useDomSelection } from "./useDomSelection";
import type { TimelineElement } from "../player";

installReactActEnvironment();

interface HarnessProps {
  activeCompPath: string | null;
  projectId: string | null;
  refreshKey: number;
}

interface TimelineSpies {
  setSelectedTimelineElementId: ReturnType<typeof vi.fn>;
  setTimelineSelectionSet: ReturnType<typeof vi.fn>;
}

function renderHarness(
  initialProps: HarnessProps,
  options: { timelineElements?: TimelineElement[] } = {},
): {
  current: () => ReturnType<typeof useDomSelection>;
  rerender: (props: HarnessProps) => void;
  cleanup: () => void;
  timeline: TimelineSpies;
} {
  const timeline: TimelineSpies = {
    setSelectedTimelineElementId: vi.fn(),
    setTimelineSelectionSet: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let currentHook: ReturnType<typeof useDomSelection> | null = null;

  function Harness(props: HarnessProps) {
    currentHook = useDomSelection({
      projectId: props.projectId,
      activeCompPath: props.activeCompPath,
      isMasterView: false,
      compIdToSrc: new Map(),
      captionEditMode: false,
      previewIframeRef: { current: null },
      timelineElements: options.timelineElements ?? [],
      getTimelineSelectionSet: () => new Set(),
      setSelectedTimelineElementId: timeline.setSelectedTimelineElementId,
      setTimelineSelectionSet: timeline.setTimelineSelectionSet,
      setRightCollapsed: vi.fn(),
      setRightPanelTab: vi.fn(),
      previewIframe: null,
      refreshKey: props.refreshKey,
      rightPanelTab: "design",
    });
    return null;
  }

  const rerender = (props: HarnessProps) => {
    act(() => {
      root.render(React.createElement(Harness, props));
    });
  };

  rerender(initialProps);

  return {
    current: () => {
      if (!currentHook) throw new Error("Expected hook result");
      return currentHook;
    },
    rerender,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
    timeline,
  };
}

function setupSelectedHarness() {
  const element = document.createElement("div");
  element.id = "headline";
  const selection = makeSelection("Headline", element);
  const harness = renderHarness({
    activeCompPath: "intro.html",
    projectId: "project-1",
    refreshKey: 0,
  });
  act(() => harness.current().applyDomSelection(selection));
  return { selection, harness };
}

function timelineElement(domId: string): TimelineElement {
  return {
    id: domId,
    key: domId,
    domId,
    tag: "div",
    start: 0,
    duration: 1,
    track: 0,
    sourceFile: "index.html",
  } as TimelineElement;
}

/**
 * A marquee builds the group correctly and then used to lose it: it announced only
 * the primary to the timeline, the timeline is the source of truth for what is
 * selected, and the sync back to the canvas replaced the group with that one
 * element a moment after the drop. The whole set has to be announced, with the
 * primary as its anchor rather than as a new single selection.
 */
describe("useDomSelection marquee", () => {
  it("announces every marquee'd element to the timeline, anchored on the primary", () => {
    const first = document.createElement("div");
    first.id = "card";
    const second = document.createElement("div");
    second.id = "chip";
    document.body.append(first, second);
    const harness = renderHarness(
      { activeCompPath: "index.html", projectId: "project-1", refreshKey: 0 },
      { timelineElements: [timelineElement("card"), timelineElement("chip")] },
    );

    act(() =>
      harness
        .current()
        .applyMarqueeSelection(
          [makeSelection("Card", first), makeSelection("Chip", second)],
          false,
        ),
    );

    expect(harness.current().domEditGroupSelections).toHaveLength(2);
    expect(harness.timeline.setTimelineSelectionSet).toHaveBeenCalledWith(
      new Set(["card", "chip"]),
    );
    expect(harness.timeline.setSelectedTimelineElementId).toHaveBeenCalledWith("card", {
      preserveSet: true,
    });
    harness.cleanup();
  });

  it("uses a surviving group member as the timeline anchor when the canvas primary has no row", () => {
    const canvasOnly = document.createElement("div");
    canvasOnly.id = "canvas-only";
    const card = document.createElement("div");
    card.id = "card";
    document.body.append(canvasOnly, card);
    const harness = renderHarness(
      { activeCompPath: "index.html", projectId: "project-1", refreshKey: 0 },
      { timelineElements: [timelineElement("card")] },
    );

    act(() =>
      harness
        .current()
        .applyMarqueeSelection(
          [makeSelection("Canvas only", canvasOnly), makeSelection("Card", card)],
          false,
        ),
    );

    expect(harness.timeline.setTimelineSelectionSet).toHaveBeenCalledWith(new Set(["card"]));
    expect(harness.timeline.setSelectedTimelineElementId).toHaveBeenCalledWith("card", {
      preserveSet: true,
    });
    harness.cleanup();
  });
});

/**
 * Adding a second element announced only that element, with preserveSet — and
 * preserving a set that does not contain the id empties it. An empty timeline
 * selection syncs back as "nothing is selected", so growing a group could wipe
 * it instead, and so could re-resolving one after a move.
 */
describe("useDomSelection additive", () => {
  it("announces both members when a second element joins the selection", () => {
    const first = document.createElement("div");
    first.id = "card";
    const second = document.createElement("div");
    second.id = "chip";
    document.body.append(first, second);
    const harness = renderHarness(
      { activeCompPath: "index.html", projectId: "project-1", refreshKey: 0 },
      { timelineElements: [timelineElement("card"), timelineElement("chip")] },
    );

    act(() => harness.current().applyDomSelection(makeSelection("Card", first)));
    act(() =>
      harness.current().applyDomSelection(makeSelection("Chip", second), { additive: true }),
    );

    expect(harness.current().domEditGroupSelections).toHaveLength(2);
    expect(harness.timeline.setTimelineSelectionSet).toHaveBeenLastCalledWith(
      new Set(["card", "chip"]),
    );
    expect(harness.timeline.setSelectedTimelineElementId).toHaveBeenLastCalledWith("chip", {
      preserveSet: true,
    });
    harness.cleanup();
  });
});

describe("useDomSelection", () => {
  it("ignores a repeated non-additive selection of the same target", () => {
    const element = document.createElement("div");
    element.id = "headline";
    const first = makeSelection("Headline", element);
    const repeated = makeSelection("Headline", element);
    const harness = renderHarness({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    act(() => harness.current().applyDomSelection(first));
    harness.timeline.setSelectedTimelineElementId.mockClear();
    harness.timeline.setTimelineSelectionSet.mockClear();

    act(() => harness.current().applyDomSelection(repeated));

    expect(harness.current().domEditSelection).toBe(first);
    expect(harness.current().domEditGroupSelections).toEqual([first]);
    expect(harness.timeline.setSelectedTimelineElementId).not.toHaveBeenCalled();
    expect(harness.timeline.setTimelineSelectionSet).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("still refreshes selection data for the same target when preserving the group", () => {
    const element = document.createElement("div");
    element.id = "headline";
    const first = makeSelection("Headline", element);
    const refreshed = makeSelection("Updated headline", element);
    const harness = renderHarness({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    act(() => harness.current().applyDomSelection(first));
    act(() =>
      harness.current().applyDomSelection(refreshed, {
        preserveGroup: true,
        revealPanel: false,
      }),
    );

    expect(harness.current().domEditSelection).toBe(refreshed);
    expect(harness.current().domEditGroupSelections).toEqual([refreshed]);
    harness.cleanup();
  });

  it("clears a committed selection when the active composition path changes", () => {
    const { selection, harness } = setupSelectedHarness();
    expect(harness.current().domEditSelection).toBe(selection);

    harness.rerender({
      activeCompPath: "outro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    expect(harness.current().domEditSelection).toBe(null);
    harness.cleanup();
  });

  it("preserves a committed selection when composition identity is unchanged", () => {
    const { selection, harness } = setupSelectedHarness();
    harness.rerender({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 1,
    });

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });

  it("preserves selection when clearing an already inactive group scope", () => {
    const { selection, harness } = setupSelectedHarness();
    act(() => harness.current().setActiveGroupElement(null));

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });

  it("preserves selection when entering the already active group scope", () => {
    const group = document.createElement("div");
    const child = document.createElement("span");
    child.id = "headline";
    group.append(child);
    const selection = makeSelection("Headline", child);
    const harness = renderHarness({
      activeCompPath: "intro.html",
      projectId: "project-1",
      refreshKey: 0,
    });

    act(() => harness.current().setActiveGroupElement(group));
    act(() => harness.current().applyDomSelection(selection));
    act(() => harness.current().setActiveGroupElement(group));

    expect(harness.current().domEditSelection).toBe(selection);
    harness.cleanup();
  });
});
