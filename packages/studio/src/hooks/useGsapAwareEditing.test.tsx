// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/DomEditOverlay";
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
  POSITION_CHANNELS: ["x", "y"],
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
  const commitMutation = vi.fn().mockResolvedValue(undefined);
  let resize:
    | ((
        selection: DomEditSelection,
        size: { width: number; height: number },
        offset?: { x: number; y: number },
        restore?: () => void,
      ) => Promise<void>)
    | null = null;
  function Harness() {
    resize = useGsapAwareEditing({
      domEditSelection: selection,
      selectedGsapAnimations: animations,
      gsapCommitMutation: commitMutation,
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
  return { selection, fallback, commitMutation, resize: resize!, root };
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

  it("settles the live GSAP position before resize persistence reaches its first await", async () => {
    let resolveResize!: (handled: boolean) => void;
    const pendingResize = new Promise<boolean>((resolve) => {
      resolveResize = resolve;
    });
    mocks.resize.mockReturnValue(pendingResize);
    mocks.drag.mockResolvedValue(true);
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

    expect(mocks.setPosition).toHaveBeenCalledWith(h.selection.element, 70, 55);
    expect(mocks.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resize.mock.invocationCallOrder[0]!,
    );

    resolveResize(true);
    await act(() => commit);
    act(() => h.root.unmount());
  });

  it("passes a transaction-scoped commit wrapper into the resize path", async () => {
    mocks.resize.mockImplementation(async (selection, _size, _animations, _iframe, commit) => {
      await commit(selection, { type: "resize" }, { label: "Resize", softReload: true });
      return true;
    });
    const h = mountResizeHandler([]);

    await act(() => h.resize(h.selection, { width: 300, height: 200 }));

    expect(h.commitMutation).toHaveBeenCalledWith(
      h.selection,
      { type: "resize" },
      expect.objectContaining({
        coalesceKey: expect.stringMatching(/^tx:Resize layer:\d+$/),
        softReload: true,
      }),
    );
    act(() => h.root.unmount());
  });

  it("folds a group drag's member writes into one undo entry via a shared coalesceKey", async () => {
    const capturedKeys: Array<string | undefined> = [];
    mocks.drag.mockImplementation(
      async (
        selection: DomEditSelection,
        _next: unknown,
        _anims: unknown,
        _iframe: unknown,
        commit: (
          s: DomEditSelection,
          m: unknown,
          o: { coalesceKey?: string; label?: string; softReload?: boolean },
        ) => Promise<void>,
      ) => {
        await commit(selection, { type: "move" }, { label: "Move", softReload: true });
        return true;
      },
    );
    const commitMutation = vi.fn(
      (_s: DomEditSelection, _m: unknown, o: { coalesceKey?: string }) => {
        capturedKeys.push(o.coalesceKey);
        return Promise.resolve();
      },
    );
    let groupCommit!: (updates: DomEditGroupPathOffsetCommit[]) => Promise<void>;
    function Harness() {
      groupCommit = useGsapAwareEditing({
        domEditSelection: null,
        selectedGsapAnimations: [],
        gsapCommitMutation: commitMutation,
        previewIframeRef: { current: null },
        showToast: vi.fn(),
        bumpGsapCache: vi.fn(),
        makeFetchFallback: () => vi.fn().mockResolvedValue([]),
        trackGsapInteractionFailure: vi.fn(),
        handleDomBoxSizeCommit: vi.fn(),
        addGsapAnimation: vi.fn(),
        convertToKeyframes: vi.fn(),
        setArcPath: vi.fn(),
        updateArcSegment: vi.fn(),
      }).handleGsapAwareGroupPathOffsetCommit;
      return null;
    }
    const root = mountReactHarness(<Harness />);
    const updates = [
      {
        selection: { element: document.createElement("div"), id: "a", selector: "#a" },
        next: { x: 10, y: 10 },
      },
      {
        selection: { element: document.createElement("div"), id: "b", selector: "#b" },
        next: { x: 10, y: 10 },
      },
    ] as unknown as DomEditGroupPathOffsetCommit[];

    await act(() => groupCommit(updates));

    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toMatch(/^group-drag:\d+$/);
    // Both members share ONE coalesceKey → they fold into a single undo entry.
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
    act(() => root.unmount());
  });

  it("restores once when resize persistence fails", async () => {
    const error = new Error("resize failed");
    const restore = vi.fn();
    mocks.resize.mockRejectedValue(error);
    const h = mountResizeHandler([]);

    const commit = h.resize(h.selection, { width: 300, height: 200 }, undefined, restore);
    await expect(commit).rejects.toBe(error);
    expect(restore).toHaveBeenCalledTimes(1);
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
