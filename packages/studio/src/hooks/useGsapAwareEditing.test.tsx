// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { mountReactHarness } from "./domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  resize: vi.fn(),
  drag: vi.fn(),
  readPosition: vi.fn(),
  setPosition: vi.fn(),
}));

vi.mock("./gsapResizeIntercept", () => ({ tryGsapResizeIntercept: mocks.resize }));
vi.mock("./gsapRuntimeBridge", () => ({
  tryGsapDragIntercept: mocks.drag,
  tryGsapRotationIntercept: vi.fn(),
}));
vi.mock("./gsapPositionDetection", () => ({
  readGsapPositionFromIframe: mocks.readPosition,
}));
vi.mock("../utils/elementGsap", () => ({ setElementGsapPosition: mocks.setPosition }));
vi.mock("./useAnimatedPropertyCommit", () => ({
  useAnimatedPropertyCommit: () => ({
    commitAnimatedProperty: vi.fn(),
    commitAnimatedProperties: vi.fn(),
  }),
}));
vi.mock("./useSafeGsapCommitMutation", () => ({
  useGsapSaveFailureTelemetry: () => vi.fn(),
  useSafeGsapCommitMutation: (commit: unknown) => commit,
}));

import { useGsapAwareEditing } from "./useGsapAwareEditing";

afterEach(() => {
  vi.clearAllMocks();
});

function mountResizeHandler(animations: GsapAnimation[]) {
  const element = document.createElement("div");
  const selection = { element, id: "clip", selector: "#clip" } as unknown as DomEditSelection;
  const fallback = vi.fn().mockResolvedValue(undefined);
  let resize:
    | ((
        selection: DomEditSelection,
        size: { width: number; height: number },
        offset?: { x: number; y: number },
      ) => Promise<void>)
    | null = null;
  function Harness() {
    resize = useGsapAwareEditing({
      domEditSelection: selection,
      selectedGsapAnimations: animations,
      gsapCommitMutation: vi.fn(),
      previewIframeRef: { current: null },
      showToast: vi.fn(),
      bumpGsapCache: vi.fn(),
      makeFetchFallback: () => vi.fn().mockResolvedValue(animations),
      trackGsapInteractionFailure: vi.fn(),
      handleDomBoxSizeCommit: fallback,
      addGsapAnimation: vi.fn(),
      convertToKeyframes: vi.fn(),
      setArcPath: vi.fn(),
      updateArcSegment: vi.fn(),
    }).handleGsapAwareBoxSizeCommit;
    return null;
  }
  const root = mountReactHarness(<Harness />);
  return { selection, fallback, resize: resize!, root };
}

describe("useGsapAwareEditing anchored resize", () => {
  it("forwards the anchor offset to the DOM fallback when GSAP does not handle resize", async () => {
    mocks.resize.mockResolvedValue(false);
    const h = mountResizeHandler([]);
    await act(() => h.resize(h.selection, { width: 300, height: 200 }, { x: -50, y: -25 }));
    expect(h.fallback).toHaveBeenCalledWith(
      h.selection,
      { width: 300, height: 200 },
      { x: -50, y: -25 },
    );
    act(() => h.root.unmount());
  });

  it("persists the anchor exactly once through GSAP position when size route handles resize", async () => {
    mocks.resize.mockResolvedValue(true);
    mocks.drag.mockResolvedValue(true);
    const h = mountResizeHandler([]);
    await act(() => h.resize(h.selection, { width: 300, height: 200 }, { x: -50, y: -25 }));
    expect(h.fallback).not.toHaveBeenCalled();
    expect(mocks.drag).toHaveBeenCalledTimes(1);
    expect(mocks.drag.mock.calls[0]![1]).toEqual({ x: -50, y: -25 });
    act(() => h.root.unmount());
  });

  it("settles the live GSAP position before the deferred anchor persist resolves", async () => {
    let resolveDrag!: (handled: boolean) => void;
    const pendingDrag = new Promise<boolean>((resolve) => {
      resolveDrag = resolve;
    });
    mocks.resize.mockResolvedValue(true);
    mocks.drag.mockReturnValue(pendingDrag);
    mocks.readPosition.mockReturnValue({ x: 120.4, y: 80.2 });
    const h = mountResizeHandler([]);
    h.selection.element.setAttribute("data-hf-drag-gsap-base-x", "120.4");
    h.selection.element.setAttribute("data-hf-drag-gsap-base-y", "80.2");
    h.selection.element.setAttribute("data-hf-drag-initial-offset-x", "0");
    h.selection.element.setAttribute("data-hf-drag-initial-offset-y", "0");

    let commit!: Promise<void>;
    act(() => {
      commit = h.resize(h.selection, { width: 300, height: 200 }, { x: -50.2, y: -25.6 });
    });
    await vi.waitFor(() => expect(mocks.drag).toHaveBeenCalledTimes(1));

    expect(mocks.setPosition).toHaveBeenCalledWith(h.selection.element, 70, 55);
    expect(mocks.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.drag.mock.invocationCallOrder[0]!,
    );

    resolveDrag(true);
    await act(() => commit);
    act(() => h.root.unmount());
  });

  it("does not apply the anchor twice when scale route already settles the drop point", async () => {
    mocks.resize.mockResolvedValue(true);
    const scale = { propertyGroup: "scale" } as GsapAnimation;
    const h = mountResizeHandler([scale]);
    await act(() => h.resize(h.selection, { width: 300, height: 200 }, { x: -50, y: -25 }));
    expect(mocks.drag).not.toHaveBeenCalled();
    expect(h.fallback).not.toHaveBeenCalled();
    act(() => h.root.unmount());
  });
});
