// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { previewRequest } from "../../player/lib/previewChannel";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import {
  hasSealedCanvasKeyboardHold,
  keepKeyboardOutOfSealedFrame,
} from "../../player/lib/sealedFrameKeyboard";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { usePlayerStore } from "../../player/store/playerStore";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import type { DomEditSelection } from "./domEditing";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { keepGestureStartReadAhead } from "./gestureStartReadAhead";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { standInFor } from "./previewSelection";
import { useDomEditNudge, type UseDomEditNudgeParams } from "./useDomEditNudge";
import { useSealedCanvasKeys, type CanvasDeleteHandler } from "./useSealedCanvasKeys";

installReactActEnvironment();

vi.mock("../../player/lib/previewChannel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../player/lib/previewChannel")>();
  return { ...actual, previewRequest: vi.fn(actual.previewRequest) };
});

function sized<T extends Element>(element: T, [x, y, width, height]: number[]): T {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  return element;
}

function trustedKey(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

const ref = <T>(current: T) => ({ current });
const OVERLAY_RECT: OverlayRect = {
  left: 320,
  top: 210,
  width: 100,
  height: 50,
  editScaleX: 1,
  editScaleY: 1,
};

async function setupSealedCanvas(options?: {
  onDeleteSelection?: CanvasDeleteHandler;
  onCommit?: ReturnType<typeof vi.fn>;
  readOnly?: boolean;
}) {
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="target">box</div></div><div data-studio-timeline="true"><button id="tl-clip">clip</button></div>`;
  const targetEl = document.getElementById("target")!;
  targetEl.getBoundingClientRect = () => {
    const x = 300 + (Number.parseFloat(targetEl.style.translate) || 0);
    return {
      x,
      y: 200,
      width: 100,
      height: 50,
      left: x,
      top: 200,
      right: x + 100,
      bottom: 250,
    } as DOMRect;
  };
  const { iframe, frame } = sealedPreviewFrame();
  sized(iframe, [20, 10, 1920, 1080]);
  watchPreviewFrame(iframe);
  onTestFinished(keepKeyboardOutOfSealedFrame(iframe));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );

  const match = (await queryPreviewElements(iframe, "#target"))!.matches[0]!;
  const described = (await describePreviewElements(iframe, [match.handle]))![0]!;
  const standIn = standInFor(iframe, described);
  const selection: DomEditSelection = {
    ...makeSelection("Target", standIn),
    id: "target",
    selector: "#target",
    handle: match.handle,
  };

  const overlay = sized(document.createElement("div"), [20, 10, 1920, 1080]);
  document.body.append(overlay);
  const commit = options?.onCommit ?? vi.fn();
  const onDeleteSelection =
    options?.onDeleteSelection ?? vi.fn(async (_sel, opts) => opts?.onSettled?.(true));

  const nudgeOpts: Omit<
    UseDomEditNudgeParams,
    "selection" | "groupSelections" | "allowCanvasMovement" | "onNudgeSavingChangeRef"
  > = {
    iframeRef: ref(iframe),
    overlayRef: ref(overlay),
    activeCompositionPathRef: ref(null),
    selectionRef: ref<DomEditSelection | null>(selection),
    overlayRectRef: ref<OverlayRect | null>(OVERLAY_RECT),
    groupOverlayItemsRef: ref([]),
    gestureRef: ref(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    waitingPressRef: ref(null),
    onManualDragStartRef: ref(vi.fn()),
    onBlockedMoveRef: ref(vi.fn()),
    onPathOffsetCommitRef: ref(
      commit as unknown as UseDomEditNudgeParams["onPathOffsetCommitRef"]["current"],
    ),
    onGroupPathOffsetCommitRef: ref(async () => {}),
  };

  onTestFinished(
    keepGestureStartReadAhead({
      ...nudgeOpts,
      rafPausedRef: ref(false),
    } as unknown as UseDomEditOverlayGesturesOptions),
  );

  function Harness() {
    const onNudgeSavingChangeRef = useRef<((saving: boolean) => void) | undefined>(undefined);
    const { applyRuntimeNudge } = useDomEditNudge({
      ...nudgeOpts,
      selection,
      groupSelections: [],
      allowCanvasMovement: !options?.readOnly,
      onNudgeSavingChangeRef,
    });
    useSealedCanvasKeys({
      iframeRef: nudgeOpts.iframeRef,
      overlayRef: nudgeOpts.overlayRef,
      selection,
      groupSelections: [],
      allowCanvasMovement: !options?.readOnly,
      readOnly: Boolean(options?.readOnly),
      inlineTextEditing: false,
      onDeleteSelection,
      applyRuntimeNudge,
      onNudgeSavingChangeRef,
    });
    return null;
  }

  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(React.createElement(Harness)));
  onTestFinished(() => act(() => root.unmount()));

  return { iframe, overlay, targetEl, selection, commit, onDeleteSelection, handle: match.handle };
}

beforeEach(() => {
  __resetForTests();
  vi.mocked(previewRequest).mockClear();
  usePlayerStore.getState().reset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

it("acquires canvas focus hold on canvas click, releases on timeline click, and disarms runtime", async () => {
  const { iframe, overlay } = await setupSealedCanvas();
  const focusSpy = vi.spyOn(iframe, "focus");

  expect(hasSealedCanvasKeyboardHold(iframe)).toBe(false);

  // Clicking the canvas overlay arms runtime keys and focuses the sealed iframe.
  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await vi.waitFor(() => expect(hasSealedCanvasKeyboardHold(iframe)).toBe(true));
  expect(focusSpy).toHaveBeenCalled();

  // Clicking the timeline releases the canvas hold and disarms the runtime.
  const timelineBtn = document.getElementById("tl-clip")!;
  act(() => {
    timelineBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await vi.waitFor(() => expect(hasSealedCanvasKeyboardHold(iframe)).toBe(false));
});

async function waitForArm(predicate: (params: Record<string, unknown>) => boolean = () => true) {
  let promise: Promise<unknown> | null = null;
  await vi.waitFor(() => {
    const calls = vi.mocked(previewRequest).mock.calls;
    const results = vi.mocked(previewRequest).mock.results;
    for (let i = calls.length - 1; i >= 0; i--) {
      const [, kind, params] = calls[i]!;
      if (kind === "arm-canvas-keys" && predicate(params as Record<string, unknown>)) {
        promise = results[i]?.value as Promise<unknown>;
        return;
      }
    }
    throw new Error("arm-canvas-keys not sent yet");
  });
  await promise;
}

it("runs in-frame Delete with Studio commit and restores on persist rollback", async () => {
  let resolveDelete!: (ok: boolean) => void;
  const onDelete = vi.fn(
    (_sel, opts?: { onSettled?: (ok: boolean) => void }) =>
      new Promise<void>((resolve) => {
        resolveDelete = (ok) => {
          opts?.onSettled?.(ok);
          resolve();
        };
      }),
  );
  const { overlay } = await setupSealedCanvas({ onDeleteSelection: onDelete });

  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);

  // Trusted Delete removes #target immediately in-frame, then Studio fails save -> runtime restores #target.
  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).toBeNull();
  await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));

  await act(async () => resolveDelete(false));
  await vi.waitFor(() => expect(document.getElementById("target")).not.toBeNull());
});

it("commits rapid repeat Arrow nudges once with exact cumulative delta and zero redundant draft echo", async () => {
  const commit = vi.fn();
  const { overlay, targetEl } = await setupSealedCanvas({ onCommit: commit });

  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await waitForArm((p) => p.nudge !== null);

  // Let read-ahead warm up so burst joins synchronously.
  await new Promise((r) => setTimeout(r, 30));
  vi.mocked(previewRequest).mockClear();

  // Rapid key-repeat nudges draw in-frame immediately without waiting on Studio.
  window.dispatchEvent(trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight" }));
  window.dispatchEvent(
    trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true }),
  );
  window.dispatchEvent(
    trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true }),
  );
  window.dispatchEvent(
    trustedKey("keydown", { key: "ArrowDown", code: "ArrowDown", shiftKey: true }),
  );
  expect(targetEl.style.getPropertyValue("translate")).toContain("3px");
  expect(targetEl.style.getPropertyValue("translate")).toContain("10px");

  // Wait for Studio's 400ms nudge debounce commit.
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), {
    timeout: CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 1000,
  });
  expect(commit.mock.calls[0]?.[1]).toEqual({ x: 3, y: 10 });
  const echoedDraws = vi
    .mocked(previewRequest)
    .mock.calls.filter(
      ([, kind, params]) =>
        kind === "draft" &&
        (params as { drafts: Array<{ end?: unknown }> }).drafts.some((d) => !("end" in d)),
    );
  expect(echoedDraws).toHaveLength(0);
});

it("forwards non-local Studio shortcuts only while canvas focus hold is active, and disarms Delete when keyframes are selected", async () => {
  const onDelete = vi.fn();
  const { overlay } = await setupSealedCanvas({ onDeleteSelection: onDelete });
  const studioSaw: string[] = [];
  const onStudioKey = (e: KeyboardEvent) => studioSaw.push(e.code || e.key);
  window.addEventListener("keydown", onStudioKey, true);
  onTestFinished(() => window.removeEventListener("keydown", onStudioKey, true));

  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);

  // Trusted Space in frame forwards to Studio's window listener.
  window.dispatchEvent(trustedKey("keydown", { key: " ", code: "Space" }));
  await vi.waitFor(() => expect(studioSaw).toContain("Space"));

  // Selecting a keyframe disarms local Delete so Delete forwards to Studio instead of removing #target.
  vi.mocked(previewRequest).mockClear();
  act(() => {
    usePlayerStore.setState({ selectedKeyframes: new Set(["target:x:0"]) });
  });
  await waitForArm((p) => (p.deleteHandles as string[]).length === 0);
  studioSaw.length = 0;
  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).not.toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(studioSaw).toContain("Delete"));
});
