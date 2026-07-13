// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player";
import { mountReactHarness } from "./domSelectionTestHarness";
import type { CommitMutationOptions } from "./gsapScriptCommitTypes";
import { useGestureCommit } from "./useGestureCommit";

const gestureRecording = vi.hoisted(() => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(() => [
    { time: 0, properties: { x: 0, y: 0, opacity: 1 } },
    { time: 0.5, properties: { x: 50, y: 25, opacity: 0.5 } },
    { time: 1, properties: { x: 100, y: 50, opacity: 0 } },
  ]),
  clearSamples: vi.fn(),
  cancelRecording: vi.fn(),
  isRecording: false,
  recordingDuration: 0,
  samplesRef: { current: [] },
  trailRef: { current: [] },
}));

vi.mock("./useGestureRecording", () => ({
  useGestureRecording: () => gestureRecording,
}));

vi.mock("../utils/rdpSimplify", () => ({
  simplifyGestureSamples: () =>
    new Map([
      [0, { x: 0, y: 0, opacity: 1 }],
      [50, { x: 50, y: 25, opacity: 0.5 }],
      [100, { x: 100, y: 50, opacity: 0 }],
    ]),
}));

vi.mock("../utils/gestureSmoother", () => ({
  smoothGestureKeyframes: (keyframes: unknown) => keyframes,
}));

vi.mock("../utils/velocityEaseFitter", () => ({
  fitEasesFromVelocity: (keyframes: unknown) => keyframes,
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  usePlayerStore.getState().reset();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function makeSelection(element: HTMLElement): DomEditSelection {
  return {
    id: element.id,
    element,
    label: "Card",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: null,
    dataAttributes: { start: "0", duration: "2" },
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

describe("useGestureCommit", () => {
  it("coalesces property-group commits and reloads only the terminal group", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const element = document.createElement("div");
    element.id = "card";
    const commitMutation = vi.fn<
      (mutation: Record<string, unknown>, options: CommitMutationOptions) => Promise<void>
    >(async () => {});
    const sessionRef = {
      current: {
        domEditSelection: makeSelection(element),
        selectedGsapAnimations: [],
        commitMutation,
      },
    };
    const captured: { hook: ReturnType<typeof useGestureCommit> | null } = { hook: null };
    function Probe() {
      captured.hook = useGestureCommit({
        domEditSessionRef: sessionRef,
        previewIframeRef: { current: iframe },
        showToast: vi.fn(),
        isGestureRecordingRef: { current: false },
      });
      return null;
    }
    const root = mountReactHarness(<Probe />);
    cleanup = () => act(() => root.unmount());
    if (!captured.hook) throw new Error("hook did not initialize");

    act(() => captured.hook?.handleToggleRecording());
    act(() => captured.hook?.handleToggleRecording());
    await act(async () => {
      await vi.waitFor(() => expect(commitMutation).toHaveBeenCalledTimes(2));
    });

    const options = commitMutation.mock.calls.map((call) => call[1]);
    expect(new Set(options.map((entry) => entry.coalesceKey)).size).toBe(1);
    expect(options[0]).toEqual(expect.objectContaining({ coalesceMs: Infinity, skipReload: true }));
    expect(options[0]).not.toHaveProperty("softReload");
    expect(options[1]).toEqual(expect.objectContaining({ coalesceMs: Infinity, softReload: true }));
    expect(options[1]).not.toHaveProperty("skipReload");
  });
});
