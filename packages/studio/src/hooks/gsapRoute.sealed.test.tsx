// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ request: vi.fn(), drag: vi.fn(), resize: vi.fn() }));

vi.mock("../player/lib/previewChannel", async (original) => {
  const clients = new WeakMap<HTMLIFrameElement, object>();
  return {
    ...(await original<object>()),
    previewEditingClient: (iframe: HTMLIFrameElement) => {
      if (!clients.has(iframe)) clients.set(iframe, {});
      return clients.get(iframe);
    },
    previewFrameOpaque: () => true,
    previewRequest: mocks.request,
  };
});
vi.mock("./gsapRuntimeBridge", () => ({
  tryGsapDragIntercept: mocks.drag,
  tryGsapRotationIntercept: vi.fn(),
}));
vi.mock("./gsapResizeIntercept", () => ({ tryGsapResizeIntercept: mocks.resize }));
vi.mock("./useSafeGsapCommitMutation", () => ({
  useGsapSaveFailureTelemetry: () => vi.fn(),
  useSafeGsapCommitMutation: (commit: unknown) => commit,
}));

import { registerPreviewStandIn } from "../components/editor/previewDrafts";
import { createTransformCommitHandlers } from "../components/editor/propertyPanelTransformCommit";
import { announcePreviewRestoredInPlace } from "../player/sceneSwap";
import { usePlayerStore } from "../player/store/playerStore";
import { mountReactHarness } from "./domSelectionTestHarness";
import { editsPlainCss, editsPlainCssSettled } from "./gsapRuntimeKeyframes";
import { useGsapAwareEditing } from "./useGsapAwareEditing";

const HANDLE = "0123456789abcdef:1";

/** The frame's GSAP read: one timeline whose only tween sets `vars` on the layer. */
const snapshot = (vars: Record<string, number> | null) => ({
  time: 0.5,
  defaultEase: null,
  timelines: [
    {
      id: "main",
      time: 0.5,
      defaultEase: null,
      tweens: vars
        ? [
            {
              targets: [HANDLE],
              vars,
              start: 0,
              duration: 1,
              from: false,
              initted: true,
              parsed: Object.entries(vars).map(([p, c]) => ({ p, s: 0, c })),
              parts: [],
            },
          ]
        : [],
    },
  ],
  targets: [{ handle: HANDLE, id: "card", className: "", values: {} }],
});

afterEach(() => {
  mocks.request.mockReset();
  vi.clearAllMocks();
  usePlayerStore.setState({ currentTime: 0, isPlaying: false });
});

/** A sealed layer GSAP animates with `vars`, its frame not yet read. */
function sealedLayer(vars: Record<string, number> | null) {
  usePlayerStore.setState({ currentTime: 0.5, isPlaying: false });
  mocks.request.mockImplementation(async (_iframe, kind) =>
    kind === "gsap-snapshot" ? snapshot(vars) : null,
  );
  const iframe = document.createElement("iframe");
  const standIn = document.createElement("div");
  registerPreviewStandIn(standIn, iframe, HANDLE);
  const selection = {
    element: standIn,
    handle: HANDLE,
    id: "card",
    selector: "#card",
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
  } as unknown as DomEditSelection;
  return { iframe, standIn, selection };
}

function gsapAwareEditing(selection: DomEditSelection) {
  mocks.drag.mockResolvedValue({ status: "persisted" });
  mocks.resize.mockResolvedValue({ status: "persisted" });
  const stageElementPositionOffset = vi.fn(() => ({
    save: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn(),
  }));
  const handleDomBoxSizeCommit = vi.fn().mockResolvedValue(undefined);
  let editing!: ReturnType<typeof useGsapAwareEditing>;
  function Harness() {
    editing = useGsapAwareEditing({
      domEditSelection: selection,
      selectedGsapAnimations: [],
      gsapCommitMutation: vi.fn().mockResolvedValue(undefined),
      previewIframeRef: { current: null },
      showToast: vi.fn(),
      bumpGsapCache: vi.fn(),
      makeFetchFallback: () => vi.fn().mockResolvedValue([]),
      trackGsapInteractionFailure: vi.fn(),
      stageElementPositionOffset,
      handleDomBoxSizeCommit,
      handleDomRotationCommit: vi.fn(),
      commitPositionPatchToHtml: vi.fn(),
      addGsapAnimation: vi.fn(),
      convertToKeyframes: vi.fn(),
      setArcPath: vi.fn(),
      updateArcSegment: vi.fn(),
    });
    return null;
  }
  const root = mountReactHarness(<Harness />);
  return { editing, stageElementPositionOffset, handleDomBoxSizeCommit, root };
}

describe("the GSAP-or-CSS route for a layer in a sealed preview", () => {
  it("takes GSAP's route for an X typed in the inspector, before the frame was ever read", async () => {
    const { selection } = sealedLayer({ x: 200 });
    const onSetManualOffset = vi.fn();
    const { commitManualOffset } = createTransformCommitHandlers({
      element: selection,
      styles: {},
      hasGsapAnimation: false,
      gsapAnimId: null,
      gsapKeyframes: null,
      currentPct: 0,
      onCommitAnimatedProperty: undefined,
      onAddKeyframe: undefined,
      onSetManualOffset,
      onSetManualSize: vi.fn(),
      onSetManualRotation: vi.fn(),
    });

    await commitManualOffset("x", "40");

    expect(onSetManualOffset.mock.calls[0]?.[2]).toEqual({ plainTranslate: false });
  });

  it("takes GSAP's route for a move made by the agent", async () => {
    const { selection } = sealedLayer({ x: 200 });
    const { editing, stageElementPositionOffset, root } = gsapAwareEditing(selection);

    await act(() => editing.handleGsapAwarePathOffsetCommit(selection, { x: 40, y: 0 }));

    expect(stageElementPositionOffset).not.toHaveBeenCalledWith(selection, { x: 40, y: 0 }, true);
    expect(mocks.drag).toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("takes GSAP's route for a resize of a layer whose tween sets its width", async () => {
    const { selection } = sealedLayer({ width: 300 });
    const { editing, handleDomBoxSizeCommit, root } = gsapAwareEditing(selection);

    await act(() => editing.handleGsapAwareBoxSizeCommit(selection, { width: 200, height: 80 }));

    expect(handleDomBoxSizeCommit).not.toHaveBeenCalled();
    expect(editsPlainCss(selection.element, "move")).toBe(true);
    act(() => root.unmount());
  });

  it("saves a resize's anchor move on GSAP's marks when only a shared tween positions the layer", async () => {
    const { selection } = sealedLayer({ x: 200 });
    const { editing, stageElementPositionOffset, root } = gsapAwareEditing(selection);
    mocks.drag.mockResolvedValue({ status: "element-offset" });

    await act(() =>
      editing.handleGsapAwareBoxSizeCommit(
        selection,
        { width: 200, height: 80 },
        { x: 10, y: 5 },
        undefined,
        { plainTranslate: false },
      ),
    );

    expect(stageElementPositionOffset).toHaveBeenCalledWith(
      selection,
      { x: 10, y: 5 },
      false,
      expect.anything(),
    );
    act(() => root.unmount());
  });

  it("decides again from the frame after an undo restored in place re-ran its script", async () => {
    const { iframe, standIn } = sealedLayer(null);
    expect(await editsPlainCssSettled(standIn, "move")).toBe(true);
    mocks.request.mockImplementation(async (_iframe, kind) =>
      kind === "gsap-snapshot" ? snapshot({ x: 200 }) : null,
    );

    announcePreviewRestoredInPlace(iframe);
    await Promise.resolve();

    expect(await editsPlainCssSettled(standIn, "move")).toBe(false);
  });
});
