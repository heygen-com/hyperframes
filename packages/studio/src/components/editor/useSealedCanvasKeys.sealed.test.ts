// @vitest-environment happy-dom

import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { installPreviewKeyShield } from "../../../../core/src/runtime/editing/canvasKeys";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { previewRequest } from "../../player/lib/previewChannel";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import {
  hasSealedCanvasKeyboardHold,
  keepKeyboardOutOfSealedFrame,
} from "../../player/lib/sealedFrameKeyboard";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { getStudioKeys, setStudioKeys } from "../../player/components/studioShortcuts";
import { usePlayerStore } from "../../player/store/playerStore";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import type { DomEditSelection } from "./domEditing";
import { membersForDelete } from "../../hooks/domEditDeleteMembers";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { keepGestureStartReadAhead } from "./gestureStartReadAhead";
import type { UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";
import { standInFor } from "./previewSelection";
import { useDomEditNudge, type UseDomEditNudgeParams } from "./useDomEditNudge";
import {
  onSealedCanvasCancel,
  useSealedCanvasKeys,
  type CanvasDeleteHandler,
} from "./useSealedCanvasKeys";

installReactActEnvironment();

const readAhead = vi.hoisted(() => ({ cold: false }));
vi.mock("./gestureStartReadAhead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gestureStartReadAhead")>();
  return {
    ...actual,
    gestureStartReadAhead: (...args: Parameters<typeof actual.gestureStartReadAhead>) =>
      readAhead.cold ? null : actual.gestureStartReadAhead(...args),
  };
});

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

async function previewSelections(iframe: HTMLIFrameElement, ids: string[]) {
  const byId = new Map<string, DomEditSelection>();
  for (const id of ids) {
    if (id !== "target") sized(document.getElementById(id)!, [600, 200, 100, 50]);
    const found = (await queryPreviewElements(iframe, `#${id}`))!.matches[0]!;
    const described = (await describePreviewElements(iframe, [found.handle]))![0]!;
    const standIn = standInFor(iframe, described);
    byId.set(id, { ...makeSelection(id, standIn), id, selector: `#${id}`, handle: found.handle });
  }
  return byId;
}

async function setupSealedCanvas(options?: {
  onDeleteSelection?: CanvasDeleteHandler;
  onCommit?: ReturnType<typeof vi.fn>;
  readOnly?: boolean;
  others?: string[];
}) {
  const others = (options?.others ?? []).map((id) => `<div id="${id}">${id}</div>`).join("");
  document.body.innerHTML = `<div data-composition-id="main" data-width="1920" data-height="1080"><div id="target">box</div>${others}</div><div data-studio-timeline="true"><button id="tl-clip">clip</button></div>`;
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
  // The fake frame shares this window and document: install its shield at load as entry.ts does,
  // and start with its surface focused, so neither side sees the other's keys or focus moves.
  vi.stubGlobal("origin", "null");
  onTestFinished(installPreviewKeyShield(window, {} as Window));
  vi.unstubAllGlobals();
  document.body.tabIndex = -1;
  document.body.focus();
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

  const byId = await previewSelections(iframe, ["target", ...(options?.others ?? [])]);
  const selection = byId.get("target")!;
  const match = { handle: selection.handle! };
  const shown = { selection, group: [] as DomEditSelection[] };
  let select: (primary: string, group?: string[]) => void = () => {};

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
    const [picked, setPicked] = useState(shown);
    select = (primary, group = []) => {
      const next = { selection: byId.get(primary)!, group: group.map((id) => byId.get(id)!) };
      Object.assign(shown, next);
      nudgeOpts.selectionRef.current = next.selection;
      setPicked(next);
    };
    const { applyRuntimeNudge } = useDomEditNudge({
      ...nudgeOpts,
      selection: picked.selection,
      groupSelections: picked.group,
      allowCanvasMovement: !options?.readOnly,
      onNudgeSavingChangeRef,
    });
    useSealedCanvasKeys({
      iframeRef: nudgeOpts.iframeRef,
      overlayRef: nudgeOpts.overlayRef,
      selection: picked.selection,
      groupSelections: picked.group,
      allowCanvasMovement: !options?.readOnly,
      readOnly: Boolean(options?.readOnly),
      inlineTextEditing: false,
      holdsPress: () => overlayHold.held,
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

  return {
    iframe,
    overlay,
    targetEl,
    selection,
    commit,
    onDeleteSelection,
    handle: match.handle,
    shown,
    select: (primary: string, group?: string[]) => act(() => select(primary, group)),
  };
}

const activation = { isActive: true };
Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation });
const overlayHold = { held: false };

beforeEach(() => {
  activation.isActive = true;
  overlayHold.held = false;
  readAhead.cold = false;
  __resetForTests();
  vi.mocked(previewRequest).mockClear();
  usePlayerStore.getState().reset();
});

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as { gsap?: unknown }).gsap;
  delete (window as { __timelines?: unknown }).__timelines;
  vi.useRealTimers();
});

it("acquires canvas focus hold on canvas click, releases on timeline click, and disarms runtime", async () => {
  const { iframe, overlay } = await setupSealedCanvas();
  const focusSpy = vi.spyOn(iframe, "focus");

  expect(hasSealedCanvasKeyboardHold(iframe)).toBe(false);

  // Clicking the canvas overlay arms runtime keys and focuses the sealed iframe once armed.
  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await vi.waitFor(() => expect(hasSealedCanvasKeyboardHold(iframe)).toBe(true));
  await vi.waitFor(() => expect(focusSpy).toHaveBeenCalled());

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

function clickCanvas(overlay: HTMLElement) {
  act(() => {
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
}

it("starts a cold first nudge on a GSAP clip from its pre-draw position, so the step lands once", async () => {
  // The save writes GSAP x/y from the stamped gesture base plus the offset, as a reload shows it.
  const savedBase: Array<string | null> = [];
  const commit = vi.fn((sel: DomEditSelection) => {
    savedBase.push(sel.element.getAttribute("data-hf-drag-gsap-base-x"));
  });
  const { overlay, targetEl } = await setupSealedCanvas({ onCommit: commit });
  const gsapState = { x: 40, y: 10 };
  Object.assign(window, {
    gsap: {
      getProperty: (el: Element, prop: string) =>
        el === targetEl ? (prop === "x" ? gsapState.x : prop === "y" ? gsapState.y : 0) : 0,
      set: (el: Element, vars: Record<string, number>) => {
        if (el !== targetEl) return;
        if (typeof vars.x === "number") gsapState.x = vars.x;
        if (typeof vars.y === "number") gsapState.y = vars.y;
      },
    },
    __timelines: {
      main: {
        getChildren: () => [{ vars: { x: 100 }, targets: () => [targetEl], duration: () => 0 }],
      },
    },
  });
  readAhead.cold = true;
  clickCanvas(overlay);
  await waitForArm((p) => p.nudge !== null);

  window.dispatchEvent(trustedKey("keydown", { key: "ArrowRight", code: "ArrowRight" }));
  expect(gsapState).toEqual({ x: 41, y: 10 });

  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), {
    timeout: CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 1000,
  });
  expect(commit.mock.calls[0]?.[1]).toEqual({ x: 1, y: 0 });
  expect(savedBase).toEqual(["40"]);
  expect(gsapState).toEqual({ x: 41, y: 10 });
});

it("leaves Backspace with Studio while Reset Keyframes may claim it for the selected clip", async () => {
  const onDelete = vi.fn();
  const { overlay } = await setupSealedCanvas({ onDeleteSelection: onDelete });
  const studioSaw: string[] = [];
  const onStudioKey = (e: KeyboardEvent) => studioSaw.push(e.key);
  window.addEventListener("keydown", onStudioKey, true);
  onTestFinished(() => window.removeEventListener("keydown", onStudioKey, true));
  act(() => {
    usePlayerStore.setState({
      selectedElementId: "target",
      keyframeCache: new Map([["target", {}]]) as never,
    });
  });
  clickCanvas(overlay);
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);

  window.dispatchEvent(trustedKey("keydown", { key: "Backspace", code: "Backspace" }));
  expect(document.getElementById("target")).not.toBeNull();
  await vi.waitFor(() => expect(studioSaw).toContain("Backspace"));
  expect(onDelete).not.toHaveBeenCalled();

  // Delete itself never resets keyframes, so it still runs in-frame.
  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).toBeNull();
  await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
});

it("saves an in-frame Delete when the canvas loses focus before Studio takes it", async () => {
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
  clickCanvas(overlay);
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);

  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).toBeNull();
  // The timeline takes focus before the frame's Delete notification reaches Studio.
  act(() => {
    document
      .getElementById("tl-clip")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  // It was pressed while armed, so it saves as it would unsealed; a failed save still restores it.
  await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  expect(document.getElementById("target")).toBeNull();
  await act(async () => resolveDelete(false));
  await vi.waitFor(() => expect(document.getElementById("target")).not.toBeNull());
});

it("rolls back a Delete whose arm Studio does not know", async () => {
  const onDelete = vi.fn();
  const { overlay, iframe, handle } = await setupSealedCanvas({ onDeleteSelection: onDelete });
  clickCanvas(overlay);
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);
  // An arm sent outside any canvas session, as a stale Studio instance would.
  await previewRequest(iframe, "arm-canvas-keys", {
    revision: 9_999,
    deleteHandles: [handle],
    deleteCombos: ["Delete"],
    nudge: null,
    forwardCombos: [],
  });
  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).toBeNull();
  await vi.waitFor(() => expect(document.getElementById("target")).not.toBeNull());
  expect(onDelete).not.toHaveBeenCalled();
});

it("saves a delayed group Delete on the members the frame removed, not the group selected since", async () => {
  // Deletes what the Studio handler would: its members, else the group selected when it runs.
  const deleted: string[][] = [];
  let shownNow: { selection: DomEditSelection; group: DomEditSelection[] } | null = null;
  const onDelete: CanvasDeleteHandler = async (sel, opts) => {
    const members = membersForDelete(sel, shownNow!.group, opts);
    deleted.push(members.map((member) => member.id ?? ""));
    opts?.onSettled?.(true);
  };
  const { overlay, shown, select } = await setupSealedCanvas({
    onDeleteSelection: onDelete,
    others: ["a", "b", "c", "d"],
  });
  shownNow = shown;
  select("a", ["a", "b"]);
  clickCanvas(overlay);
  await waitForArm((p) => (p.deleteHandles as string[]).length === 2);

  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect([document.getElementById("a"), document.getElementById("b")]).toEqual([null, null]);
  // The selection moves to C+D before the frame's notification reaches Studio.
  select("c", ["c", "d"]);

  await vi.waitFor(() => expect(deleted).toEqual([["a", "b"]]));
  expect(document.getElementById("c")).not.toBeNull();
  expect(document.getElementById("d")).not.toBeNull();
});

it("acts on a frame's Delete or forwarded key only while the person has just clicked or pressed a key", async () => {
  const onDelete = vi.fn();
  const { overlay, iframe } = await setupSealedCanvas({ onDeleteSelection: onDelete });
  const forwarded: string[] = [];
  const onStudioKey = (e: KeyboardEvent) => {
    if (!e.isTrusted) forwarded.push(`${e.shiftKey ? "Shift+" : ""}${e.key}/${e.code}`);
  };
  window.addEventListener("keydown", onStudioKey, true);
  onTestFinished(() => window.removeEventListener("keydown", onStudioKey, true));
  // Bound, so the frame forwards them and only Studio's own check can stop them.
  setStudioKeys({ fullscreen: "shift+Escape", split: "alt+Escape", record: "ctrl+Escape" });
  onTestFinished(() => setStudioKeys(null));
  const { fullscreen, split, record } = getStudioKeys();
  const modifiedEscapes = [fullscreen, split, record];
  expect(modifiedEscapes).toEqual(["shift+Escape", "alt+Escape", "ctrl+Escape"]);
  clickCanvas(overlay);
  await waitForArm(
    (p) =>
      (p.deleteHandles as string[]).length > 0 &&
      modifiedEscapes.every((combo) => (p.forwardCombos as string[]).includes(combo)),
  );

  activation.isActive = false;
  window.dispatchEvent(trustedKey("keydown", { key: " ", code: "Space" }));
  window.dispatchEvent(trustedKey("keydown", { key: "Delete", code: "Delete" }));
  expect(document.getElementById("target")).toBeNull();
  await vi.waitFor(() => expect(document.getElementById("target")).not.toBeNull());
  expect(onDelete).not.toHaveBeenCalled();
  // Escape never activates a page: a bare one runs only the canvas cancel, and no key reaches Studio's
  // shortcuts or composition navigation, whatever code the frame reports.
  const cancels = vi.fn();
  onTestFinished(onSealedCanvasCancel(cancels));
  window.dispatchEvent(trustedKey("keydown", { key: "Escape", code: "Delete" }));
  window.dispatchEvent(trustedKey("keyup", { key: "Escape", code: "Delete" }));
  await vi.waitFor(() => expect(cancels).toHaveBeenCalledTimes(1));
  expect(cancels).toHaveBeenCalledWith(iframe);
  for (const modifier of ["shiftKey", "altKey", "ctrlKey"] as const)
    window.dispatchEvent(
      trustedKey("keydown", { key: "Escape", code: "Escape", [modifier]: true }),
    );
  await previewRequest(iframe, "hello", {});
  expect(cancels).toHaveBeenCalledTimes(1);
  // A host that binds Escape to another action gets nothing without a real press.
  setStudioKeys({ cancel: "Shift+Escape", deleteSelected: "Escape" });
  expect(getStudioKeys().deleteSelected).toBe("Escape");
  window.dispatchEvent(trustedKey("keydown", { key: "Escape", code: "Escape" }));
  await previewRequest(iframe, "hello", {});
  expect(cancels).toHaveBeenCalledTimes(1);
  expect(forwarded).toEqual([]);
  expect(document.getElementById("target")).not.toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
});

it("lets a drag released on the canvas finish before the keyboard moves into the frame", async () => {
  const { overlay, iframe } = await setupSealedCanvas();
  // As in a browser: focus entering the frame blurs Studio's window, which cancels a held drag.
  vi.spyOn(iframe, "focus").mockImplementation(() => void window.dispatchEvent(new Event("blur")));
  const order: string[] = [];
  const onBlur = () => order.push("blur");
  window.addEventListener("blur", onBlur);
  onTestFinished(() => window.removeEventListener("blur", onBlur));
  overlay.addEventListener("pointerup", () => order.push("drop"));

  act(() => void overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);
  act(() => void overlay.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
  await vi.waitFor(() => expect(order).toContain("blur"));
  expect(order).toEqual(["drop", "blur"]);
});

it("keeps the keyboard out of the frame while a released drop is still held", async () => {
  const { overlay, iframe } = await setupSealedCanvas();
  const focus = vi.spyOn(iframe, "focus");
  overlayHold.held = true;
  act(() => void overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await waitForArm((p) => (p.deleteHandles as string[]).length > 0);
  act(() => void overlay.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
  // Past the task the release queued: the drop is still held, as one waiting on a slow frame read is.
  await new Promise<void>((resolve) => setTimeout(resolve));
  expect(focus).not.toHaveBeenCalled();
});
