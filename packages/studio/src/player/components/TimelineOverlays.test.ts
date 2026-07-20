// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { type KeyframeDiamondContextMenuState } from "./KeyframeDiamondContextMenu";
import { TimelineOverlays, resolveTimelineContextElement } from "./TimelineOverlays";
import { defaultTimelineTheme } from "./timelineTheme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  usePlayerStore.setState({ selectedElementId: null, timelineSessionEpoch: 0 });
});

const captured: TimelineElement = {
  id: "child",
  key: "parent::child",
  tag: "div",
  start: 1,
  duration: 2,
  track: 3,
};

describe("resolveTimelineContextElement", () => {
  it("returns the current expanded model instead of the captured snapshot", () => {
    const current = { ...captured, start: 4, track: 7 };

    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 2,
        sessionEpoch: 2,
        selectedElementId: "parent::child",
        elements: [current],
      }),
    ).toBe(current);
  });

  it("resolves synthetic expanded children that are absent from raw store elements", () => {
    expect(
      resolveTimelineContextElement({
        capturedElement: captured,
        targetSessionEpoch: 2,
        sessionEpoch: 2,
        selectedElementId: "parent::child",
        elements: [captured],
      }),
    ).toBe(captured);
  });

  it("rejects stale sessions, changed selection, and removed elements", () => {
    const input = {
      capturedElement: captured,
      targetSessionEpoch: 2,
      sessionEpoch: 2,
      selectedElementId: "parent::child",
      elements: [captured],
    };

    expect(resolveTimelineContextElement({ ...input, sessionEpoch: 3 })).toBeNull();
    expect(resolveTimelineContextElement({ ...input, selectedElementId: "other" })).toBeNull();
    expect(resolveTimelineContextElement({ ...input, elements: [] })).toBeNull();
  });
});

function renderKeyframeOverlay(options: {
  capturedElement: TimelineElement;
  currentElement: TimelineElement;
  setKfContextMenu?: ReturnType<typeof vi.fn>;
  onDeleteAllKeyframes?: ReturnType<typeof vi.fn>;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const elements = [options.currentElement];
  const setKfContextMenu = options.setKfContextMenu ?? vi.fn();
  const onDeleteAllKeyframes = options.onDeleteAllKeyframes ?? vi.fn();
  const menu: KeyframeDiamondContextMenuState = {
    x: 10,
    y: 10,
    sessionEpoch: 2,
    element: options.capturedElement,
    elementId: options.capturedElement.key ?? options.capturedElement.id,
    percentage: 50,
    animationId: "child-position",
  };

  act(() => {
    usePlayerStore.setState({
      selectedElementId: options.capturedElement.key ?? options.capturedElement.id,
      timelineSessionEpoch: 2,
    });
    root.render(
      createElement(TimelineOverlays, {
        elements,
        elementsRef: { current: elements },
        theme: defaultTimelineTheme,
        showShortcutHint: false,
        showPopover: false,
        rangeSelection: null,
        setShowPopover: vi.fn(),
        setRangeSelection: vi.fn(),
        kfContextMenu: menu,
        setKfContextMenu,
        onDeleteKeyframe: vi.fn(),
        onDeleteAllKeyframes,
        onMoveKeyframeToPlayhead: vi.fn(),
        clipContextMenu: null,
        setClipContextMenu: vi.fn(),
        currentTime: 0,
        onSplitElement: vi.fn(),
        pinZoomBeforeEdit: vi.fn(),
        onDeleteElement: vi.fn(),
        gapContextMenu: null,
        onDismissGapContextMenu: vi.fn(),
        onCloseTrackGap: vi.fn(),
        onCloseAllTrackGaps: vi.fn(),
        onHoverGapAction: vi.fn(),
      }),
    );
  });
  return { setKfContextMenu, onDeleteAllKeyframes };
}

describe("TimelineOverlays context lifecycle", () => {
  it("dismisses a keyframe menu when its selected target becomes stale", () => {
    const setKfContextMenu = vi.fn();
    renderKeyframeOverlay({
      capturedElement: captured,
      currentElement: captured,
      setKfContextMenu,
    });

    act(() => usePlayerStore.setState({ selectedElementId: "other" }));

    expect(setKfContextMenu).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("dispatches a menu action with the current model element", () => {
    const current = { ...captured, start: 4, track: 7 };
    const onDeleteAllKeyframes = vi.fn();
    renderKeyframeOverlay({
      capturedElement: captured,
      currentElement: current,
      onDeleteAllKeyframes,
    });
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Delete All Keyframes",
    );

    act(() => button?.click());

    expect(onDeleteAllKeyframes).toHaveBeenCalledExactlyOnceWith(current, "child-position");
  });
});
