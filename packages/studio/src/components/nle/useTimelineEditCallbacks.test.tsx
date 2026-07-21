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
    handleGsapMoveKeyframe: vi.fn().mockResolvedValue(true),
    handleGsapResizeKeyframedTween: vi.fn().mockResolvedValue(true),
    handleGsapUpdateMeta: vi.fn(),
    handleGsapAddKeyframe: vi.fn(),
    handleGsapAddKeyframeBatch: vi.fn().mockResolvedValue(undefined),
    handleGsapConvertToKeyframes: vi.fn(),
    handleGsapRemoveAllKeyframes: vi.fn(),
    handleGsapDeleteAnimation: vi.fn(),
    buildDomSelectionForTimelineElement: vi.fn(),
  },
  selection: { id: "box", selector: "#box", sourceFile: "index.html" },
  animations: Array<GsapAnimation>(),
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

const otherFlatAnimation: GsapAnimation = {
  ...flatAnimation,
  id: "circle-to-0-position",
  targetSelector: "#circle",
};

const otherKeyframedAnimation: GsapAnimation = {
  ...otherFlatAnimation,
  keyframes: {
    format: "percentage",
    keyframes: [
      { percentage: 0, properties: { x: 0 } },
      { percentage: 100, properties: { x: 420 } },
    ],
  },
};

function authoredInteriorAnimation(): GsapAnimation {
  return {
    ...flatAnimation,
    keyframes: {
      format: "percentage",
      keyframes: [
        { percentage: 0, properties: { x: 0 } },
        { percentage: 50, properties: { x: 210 } },
        { percentage: 100, properties: { x: 420 } },
      ],
    },
  };
}

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

function arrangeClickedCircle(): {
  circle: TimelineElement;
  selection: { id: string; selector: string; sourceFile: string };
} {
  const elementKey = "scenes/main.html#circle";
  const circle: TimelineElement = {
    ...element,
    id: "circle",
    key: elementKey,
    domId: "circle",
    sourceFile: "scenes/main.html",
  };
  const selection = { id: "circle", selector: "#circle", sourceFile: "scenes/main.html" };
  usePlayerStore.setState({
    elements: [element, circle],
    gsapAnimations: new Map([[elementKey, [otherKeyframedAnimation]]]),
  });
  mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(selection);
  return { circle, selection };
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
    gsapAnimations: new Map([["box", [flatAnimation]]]),
  });
});

afterEach(() => {
  usePlayerStore.setState({
    elements: [],
    domClipChildren: [],
    keyframeCache: new Map(),
    gsapAnimations: new Map(),
  });
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

  it("settles false for a boundary drag while the tween is still flat", async () => {
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.("box", 0, 25, "position", 0, flatAnimation.id),
    ).resolves.toBe(false);

    expect(mocks.actions.handleGsapMoveKeyframe).not.toHaveBeenCalled();
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });

  it("deletes a non-selected element flat boundary through the clicked element's selection", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["scenes/main.html#circle", [otherFlatAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteKeyframe?.(
        "scenes/main.html#circle",
        0,
        "position",
        0,
        otherFlatAnimation.id,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Persisted through the CLICKED element's own selection, not the current one.
    expect(mocks.actions.handleGsapDeleteAnimation).toHaveBeenCalledWith(
      otherFlatAnimation.id,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapRemoveKeyframe).not.toHaveBeenCalled();
    view.unmount();
  });

  it("removes a non-selected element authored endpoint through the clicked element's selection", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["index.html#circle", [otherKeyframedAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteKeyframe?.(
        "scenes/main.html#circle",
        100,
        "position",
        100,
        otherKeyframedAnimation.id,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(
      otherKeyframedAnimation.id,
      100,
      undefined,
      mocks.selection,
    );
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("deletes all keyframes through the clicked non-selected element's identity", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
      sourceFile: "scenes/main.html",
    };
    const circleSelection = { id: "circle", selector: "#circle", sourceFile: "scenes/main.html" };
    const scaleAnimation: GsapAnimation = {
      ...otherKeyframedAnimation,
      id: "circle-to-0-scale",
      properties: {},
      propertyGroup: "scale",
      keyframes: {
        format: "percentage",
        keyframes: [
          { percentage: 0, properties: { scale: 1 } },
          { percentage: 100, properties: { scale: 2 } },
        ],
      },
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([
        ["scenes/main.html#circle", [otherKeyframedAnimation, scaleAnimation]],
      ]),
    });
    mocks.actions.buildDomSelectionForTimelineElement.mockResolvedValue(circleSelection);
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteAllKeyframes?.(circle, scaleAnimation.id);
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapRemoveAllKeyframes).toHaveBeenCalledWith(
      scaleAnimation.id,
      circleSelection,
    );
    view.unmount();
  });

  it("does not delete a different lane when an explicit animation identity is stale", async () => {
    const circle: TimelineElement = {
      ...element,
      id: "circle",
      key: "scenes/main.html#circle",
      domId: "circle",
      sourceFile: "scenes/main.html",
    };
    usePlayerStore.setState({
      elements: [element, circle],
      gsapAnimations: new Map([["scenes/main.html#circle", [otherKeyframedAnimation]]]),
    });
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onDeleteAllKeyframes?.(circle, "missing-animation-id");
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapRemoveAllKeyframes).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not delete a different keyframe when its explicit animation identity is stale", () => {
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", 100, "position", 100, "missing-animation-id");
    });

    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    expect(mocks.actions.handleGsapRemoveKeyframe).not.toHaveBeenCalled();
    view.unmount();
  });

  it("does not move a different keyframe when its explicit animation identity is stale", async () => {
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onMoveKeyframeToPlayhead?.(
        element,
        100,
        "position",
        100,
        "missing-animation-id",
      );
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapMoveKeyframeToPlayhead).not.toHaveBeenCalled();
    view.unmount();
  });

  it("moves a keyframe to the playhead through the clicked non-selected element's identity", async () => {
    const { circle, selection } = arrangeClickedCircle();
    const view = renderCallbacks();

    await act(async () => {
      view.callbacks.onMoveKeyframeToPlayhead?.(
        circle,
        100,
        "position",
        100,
        otherKeyframedAnimation.id,
      );
      await Promise.resolve();
    });

    expect(mocks.actions.handleGsapMoveKeyframeToPlayhead).toHaveBeenCalledWith(
      otherKeyframedAnimation.id,
      100,
      selection,
      otherKeyframedAnimation,
    );
    view.unmount();
  });

  it("keeps selected-element flat boundary deletion on the animation delete path", () => {
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
    mocks.animations = [authoredInteriorAnimation()];
    usePlayerStore.setState({ gsapAnimations: new Map([["box", mocks.animations]]) });
    const view = renderCallbacks();

    act(() => {
      view.callbacks.onDeleteKeyframe?.("box", 50, "position", 50, flatAnimation.id);
    });

    expect(mocks.actions.handleGsapRemoveKeyframe).toHaveBeenCalledWith(flatAnimation.id, 50);
    expect(mocks.actions.handleGsapDeleteAnimation).not.toHaveBeenCalled();
    view.unmount();
  });

  it("keeps an authored interior drag on the per-keyframe move path", async () => {
    mocks.animations = [authoredInteriorAnimation()];
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.("box", 50, 75, "position", 50, flatAnimation.id),
    ).resolves.toBe(true);

    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(flatAnimation.id, 50, 75);
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });

  it("uses the clip timing basis when retiming a duration-less tween", async () => {
    const durationless = {
      ...authoredInteriorAnimation(),
      position: 3.2,
      resolvedStart: 3.2,
      duration: undefined,
    };
    const wideElement = { ...element, start: 10.94, duration: 16.26 };
    mocks.animations = [durationless];
    usePlayerStore.setState({
      elements: [wideElement],
      gsapAnimations: new Map([["box", [durationless]]]),
    });
    const view = renderCallbacks();

    await expect(
      view.callbacks.onMoveKeyframe?.("box", 19.1, 40, "position", 50, durationless.id),
    ).resolves.toBe(true);

    expect(mocks.actions.handleGsapMoveKeyframe).toHaveBeenCalledWith(
      durationless.id,
      50,
      expect.any(Number),
    );
    expect(mocks.actions.handleGsapResizeKeyframedTween).not.toHaveBeenCalled();
    view.unmount();
  });
});
