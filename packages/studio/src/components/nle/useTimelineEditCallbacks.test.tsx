// @vitest-environment happy-dom

import React, { act } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../player";
import type { TimelineEditCallbacks } from "../../player/components/timelineCallbacks";
import { usePlayerStore } from "../../player/store/playerStore";
import { installReactActEnvironment, mountReactHarness } from "../../hooks/domSelectionTestHarness";

installReactActEnvironment();

const mocks = vi.hoisted(() => ({
  actions: {
    handleGsapRemoveKeyframe: vi.fn(),
    handleGsapMoveKeyframeToPlayhead: vi.fn(),
    handleGsapMoveKeyframe: vi.fn(),
    handleGsapResizeKeyframedTween: vi.fn(),
    handleGsapUpdateMeta: vi.fn(),
    handleGsapAddKeyframe: vi.fn(),
    handleGsapAddKeyframeBatch: vi.fn().mockResolvedValue(undefined),
    handleGsapConvertToKeyframes: vi.fn(),
    handleGsapRemoveAllKeyframes: vi.fn(),
    handleGsapDeleteAnimation: vi.fn(),
    buildDomSelectionForTimelineElement: vi.fn(),
  },
  selection: { id: "box", selector: "#box", sourceFile: "index.html" },
  animations: [] as GsapAnimation[],
}));

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ projectId: "project", activeCompPath: "index.html" }),
}));

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditActionsContext: () => mocks.actions,
  useDomEditSelectionContext: () => ({
    domEditSelection: mocks.selection,
    selectedGsapAnimations: mocks.animations,
  }),
}));

import { useTimelineEditCallbacks } from "./useTimelineEditCallbacks";

const element: TimelineElement = {
  id: "box",
  key: "index.html#box",
  domId: "box",
  tag: "div",
  start: 0,
  duration: 1,
  track: 0,
  sourceFile: "index.html",
};

const flatAnimation: GsapAnimation = {
  id: "box-to-0-position",
  targetSelector: "#box",
  method: "to",
  position: 0,
  resolvedStart: 0,
  duration: 1,
  properties: { x: 420 },
  propertyGroup: "position",
};

function renderCallbacks(): { callbacks: TimelineEditCallbacks; unmount: () => void } {
  let callbacks: TimelineEditCallbacks | null = null;
  function Harness() {
    callbacks = useTimelineEditCallbacks({
      handleTimelineElementMove: vi.fn(),
      handleTimelineElementsMove: vi.fn(),
      handleTimelineElementResize: vi.fn(),
      handleTimelineGroupResize: vi.fn(),
      handleToggleTrackHidden: vi.fn(),
      handleBlockedTimelineEdit: vi.fn(),
      handleTimelineElementSplit: vi.fn(),
      handleRazorSplit: vi.fn(),
      handleRazorSplitAll: vi.fn(),
    });
    return null;
  }
  const root = mountReactHarness(<Harness />);
  if (!callbacks) throw new Error("timeline callbacks did not initialize");
  return { callbacks, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.animations = [flatAnimation];
  mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(mocks.selection);
  usePlayerStore.setState({
    currentTime: 0.5,
    elements: [element],
    domClipChildren: [],
    keyframeCache: new Map(),
  });
});

afterEach(() => {
  usePlayerStore.setState({ elements: [], domClipChildren: [], keyframeCache: new Map() });
});

describe("useTimelineEditCallbacks — flat tween keyframe lanes", () => {
  it("adds an interior point through the add-keyframe persist boundary", async () => {
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onTogglePropertyGroupKeyframe?.(element, {
        animationId: flatAnimation.id,
        propertyGroup: "position",
        tweenPercentage: 50,
        properties: { x: 210 },
        remove: false,
      });
    });

    expect(mocks.actions.handleGsapAddKeyframeBatch).toHaveBeenCalledWith(
      flatAnimation.id,
      50,
      { x: 210 },
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapConvertToKeyframes).not.toHaveBeenCalled();
    view.unmount();
  });

  it("safely no-ops a boundary drag while the tween is still flat", () => {
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onMoveKeyframe?.("box", 0, 25, "position", 0, flatAnimation.id);
    });

    expect(mocks.actions.handleGsapMoveKeyframe).not.toHaveBeenCalled();
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });

  it("deletes a flat boundary through the guarded animation delete path", () => {
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", 0, "position", 0, flatAnimation.id);
    });

    expect(mocks.actions.handleGsapDeleteAnimation).toHaveBeenCalledWith(flatAnimation.id);
    expect(mocks.actions.handleGsapRemoveKeyframe).not.toHaveBeenCalled();
    view.unmount();
  });

  it("routes the flat lane-header remove toggle through the guarded delete path", async () => {
    const view = renderCallbacks();

    await act(async () => {
      await view.callbacks.onTogglePropertyGroupKeyframe?.(element, {
        animationId: flatAnimation.id,
        propertyGroup: "position",
        tweenPercentage: 100,
        properties: { x: 420 },
        remove: true,
      });
    });

    expect(mocks.actions.handleGsapDeleteAnimation).toHaveBeenCalledWith(
      flatAnimation.id,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapRemoveKeyframe).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps authored interior deletion on the per-keyframe path", () => {
    mocks.animations = [
      {
        ...flatAnimation,
        keyframes: {
          format: "percentage",
          keyframes: [
            { percentage: 0, properties: { x: 0 } },
            { percentage: 50, properties: { x: 210 } },
            { percentage: 100, properties: { x: 420 } },
          ],
        },
      },
    ];
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", 50, "position", 50, flatAnimation.id);
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(flatAnimation.id, 50);
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps an authored interior drag on the per-keyframe move path", () => {
    mocks.animations = [
      {
        ...flatAnimation,
        keyframes: {
          format: "percentage",
          keyframes: [
            { percentage: 0, properties: { x: 0 } },
            { percentage: 50, properties: { x: 210 } },
            { percentage: 100, properties: { x: 420 } },
          ],
        },
      },
    ];
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onMoveKeyframe?.("box", 50, 75, "position", 50, flatAnimation.id);
    });

    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(flatAnimation.id, 50, 75);
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });
});
