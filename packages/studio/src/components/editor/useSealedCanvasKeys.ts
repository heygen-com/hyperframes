// Coordinates sealed preview keyboard focus, armed Delete/nudge handles, and Studio shortcut forwarding.
import { useEffect, useRef, useState } from "react";
import type {
  ArmCanvasKeysParams,
  CanvasKeyActionEvent,
  CanvasKeyNudgeCombo,
  EditingElementHandle,
} from "@hyperframes/core/runtime/editing-port";
import { membersForDelete } from "../../hooks/domEditDeleteMembers";
import { noteFrameRemovedHandles } from "../../hooks/previewTimingPatch";
import { useStudioKeys, type StudioKeys } from "../../player/components/studioShortcuts";
import {
  previewEditingClient,
  previewFrameOpaque,
  previewRequest,
  samePreviewLoad,
} from "../../player/lib/previewChannel";
import {
  hasSealedCanvasKeyboardHold,
  holdSealedCanvasKeyboard,
} from "../../player/lib/sealedFrameKeyboard";
import { usePlayerStore } from "../../player/store/playerStore";
import type { DomEditSelection } from "./domEditing";
import {
  CANVAS_NUDGE_SHIFT_STEP_PX,
  CANVAS_NUDGE_STEP_PX,
  canCanvasNudgeTargets,
} from "./domEditNudge";
import { filterNestedDomEditGroupItems } from "./domEditOverlayGeometry";
import { previewStandInHandle } from "./previewDrafts";

export interface RuntimeNudgeStep {
  handles: EditingElementHandle[];
  totalDx: number;
  totalDy: number;
  drafts: Record<string, number>;
}

export type CanvasDeleteHandler = (
  selection: DomEditSelection,
  options?: { expandGroup?: boolean; onSettled?: (ok: boolean) => void },
) => Promise<unknown> | void;

export interface UseSealedCanvasKeysParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  allowCanvasMovement: boolean;
  readOnly: boolean;
  inlineTextEditing: boolean;
  onDeleteSelection?: CanvasDeleteHandler;
  applyRuntimeNudge: (step: RuntimeNudgeStep) => void;
  onNudgeSavingChangeRef: React.MutableRefObject<((saving: boolean) => void) | undefined>;
}

function handleOf(selection: DomEditSelection): EditingElementHandle | null {
  return previewStandInHandle(selection.element) ?? selection.handle ?? null;
}

function handlesFor(selections: readonly DomEditSelection[]): EditingElementHandle[] | null {
  if (!selections.length) return null;
  const handles = selections.map(handleOf);
  return handles.every((h): h is EditingElementHandle => Boolean(h)) ? handles : null;
}

function nudgeCombosFor(keys: StudioKeys): CanvasKeyNudgeCombo[] {
  return [
    { combo: keys.nudgeLeft, dx: -CANVAS_NUDGE_STEP_PX, dy: 0 },
    { combo: keys.nudgeRight, dx: CANVAS_NUDGE_STEP_PX, dy: 0 },
    { combo: keys.nudgeUp, dx: 0, dy: -CANVAS_NUDGE_STEP_PX },
    { combo: keys.nudgeDown, dx: 0, dy: CANVAS_NUDGE_STEP_PX },
    { combo: keys.nudgeLeftTen, dx: -CANVAS_NUDGE_SHIFT_STEP_PX, dy: 0 },
    { combo: keys.nudgeRightTen, dx: CANVAS_NUDGE_SHIFT_STEP_PX, dy: 0 },
    { combo: keys.nudgeUpTen, dx: 0, dy: -CANVAS_NUDGE_SHIFT_STEP_PX },
    { combo: keys.nudgeDownTen, dx: 0, dy: CANVAS_NUDGE_SHIFT_STEP_PX },
  ];
}

function forwardCombosFor(keys: StudioKeys, excluded: ReadonlySet<string>): string[] {
  const unique = new Set<string>();
  for (const combo of Object.values(keys)) {
    if (!excluded.has(combo)) unique.add(combo);
  }
  if (!excluded.has("Escape")) unique.add("Escape");
  return [...unique];
}

function disarmParams(revision: number): ArmCanvasKeysParams {
  return { revision, deleteHandles: [], deleteCombos: [], nudge: null, forwardCombos: [] };
}

function resolveCanvasTargets(
  selection: DomEditSelection,
  groupSelections: DomEditSelection[],
): { deleteMembers: DomEditSelection[]; nudgeMembers: DomEditSelection[] } {
  const deleteMembers = membersForDelete(selection, groupSelections, { expandGroup: true });
  const nudgeMembers =
    groupSelections.length > 1
      ? filterNestedDomEditGroupItems(
          groupSelections.map((sel) => ({ selection: sel, element: sel.element })),
        ).map((item) => item.selection)
      : [selection];
  return { deleteMembers, nudgeMembers };
}

function resolveAction(
  iframe: HTMLIFrameElement,
  actionId: number,
  outcome: "commit" | "rollback",
): void {
  void previewRequest(iframe, "resolve-canvas-key-action", { actionId, outcome });
}

function runDeleteAction(
  iframe: HTMLIFrameElement,
  del: CanvasDeleteHandler | undefined,
  selection: DomEditSelection,
  event: Extract<CanvasKeyActionEvent, { action: "delete" }>,
): void {
  if (!del) return resolveAction(iframe, event.actionId, "rollback");
  noteFrameRemovedHandles(iframe, event.handles);
  let settled: boolean | null = null;
  const onSettled = (ok: boolean) => {
    settled = ok;
  };
  Promise.resolve()
    .then(() => del(selection, { expandGroup: true, onSettled }))
    .then(
      () => resolveAction(iframe, event.actionId, settled === false ? "rollback" : "commit"),
      () => resolveAction(iframe, event.actionId, "rollback"),
    );
}

function buildArmParams(input: {
  revision: number;
  focus: boolean;
  selection: DomEditSelection;
  groupSelections: DomEditSelection[];
  studioKeys: StudioKeys;
  allowNudge: boolean;
  allowDelete: boolean;
}): ArmCanvasKeysParams {
  const { deleteMembers, nudgeMembers } = resolveCanvasTargets(
    input.selection,
    input.groupSelections,
  );
  const deleteHandles = input.allowDelete ? (handlesFor(deleteMembers) ?? []) : [];
  const deleteCombos = deleteHandles.length
    ? [input.studioKeys.deleteSelected, input.studioKeys.deleteSelectedAlt]
    : [];
  const nudgeHandles =
    input.allowNudge && canCanvasNudgeTargets(nudgeMembers) ? handlesFor(nudgeMembers) : null;
  const nudge = nudgeHandles
    ? { handles: nudgeHandles, combos: nudgeCombosFor(input.studioKeys) }
    : null;
  const excluded = new Set<string>([
    ...deleteCombos,
    ...(nudge ? nudge.combos.map((c) => c.combo) : []),
  ]);
  return {
    revision: input.revision,
    focus: input.focus,
    deleteHandles,
    deleteCombos,
    nudge,
    forwardCombos: forwardCombosFor(input.studioKeys, excluded),
  };
}

function focusSealedIframe(iframe: HTMLIFrameElement): void {
  iframe.focus({ preventScroll: true });
  try {
    iframe.contentWindow?.focus();
  } catch {
    /* cross-origin guard */
  }
}

function attachSealedCanvasPort(input: {
  iframe: HTMLIFrameElement;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  sameLoad: () => boolean;
  armedRef: React.MutableRefObject<{ revision: number; selection: DomEditSelection } | null>;
  onDeleteRef: React.RefObject<CanvasDeleteHandler | undefined>;
  applyNudgeRef: React.RefObject<(step: RuntimeNudgeStep) => void>;
}): () => void {
  const { iframe, overlayRef, sameLoad, armedRef, onDeleteRef, applyNudgeRef } = input;
  const client = previewEditingClient(iframe);
  const stopActions = client.onCanvasKeyAction((event) => {
    if (!sameLoad() || !hasSealedCanvasKeyboardHold(iframe)) return;
    const active = armedRef.current;
    if (!active || active.revision !== event.revision) {
      if (event.action === "delete") resolveAction(iframe, event.actionId, "rollback");
      return;
    }
    if (event.action === "nudge") {
      applyNudgeRef.current({
        handles: event.handles,
        totalDx: event.totalDx,
        totalDy: event.totalDy,
        drafts: event.drafts,
      });
      return;
    }
    runDeleteAction(iframe, onDeleteRef.current, active.selection, event);
  });
  const stopKeys = client.onKey((key) => {
    if (!sameLoad() || !hasSealedCanvasKeyboardHold(iframe)) return;
    (overlayRef.current ?? window).dispatchEvent(
      new KeyboardEvent(key.type, {
        key: key.key,
        code: key.code,
        altKey: key.altKey,
        ctrlKey: key.ctrlKey,
        metaKey: key.metaKey,
        shiftKey: key.shiftKey,
        repeat: key.repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return () => {
    stopActions();
    stopKeys();
  };
}

function startSealedCanvasSession(input: {
  iframe: HTMLIFrameElement;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  armedRef: React.MutableRefObject<{ revision: number; selection: DomEditSelection } | null>;
  onDeleteRef: React.RefObject<CanvasDeleteHandler | undefined>;
  applyNudgeRef: React.RefObject<(step: RuntimeNudgeStep) => void>;
  selection: DomEditSelection;
  groupSelections: DomEditSelection[];
  studioKeys: StudioKeys;
  allowNudge: boolean;
  allowDelete: boolean;
  shouldFocus: boolean;
}): () => void {
  const { iframe, overlayRef, armedRef, onDeleteRef, applyNudgeRef } = input;
  const revision = ++lastCanvasKeyRevision;
  armedRef.current = { revision, selection: input.selection };
  const params = buildArmParams({
    revision,
    focus: input.shouldFocus,
    selection: input.selection,
    groupSelections: input.groupSelections,
    studioKeys: input.studioKeys,
    allowNudge: input.allowNudge,
    allowDelete: input.allowDelete,
  });
  const sameLoad = samePreviewLoad(iframe);
  const releaseHold = holdSealedCanvasKeyboard(iframe);
  const stopPort = attachSealedCanvasPort({
    iframe,
    overlayRef,
    sameLoad,
    armedRef,
    onDeleteRef,
    applyNudgeRef,
  });
  if (input.shouldFocus) focusSealedIframe(iframe);
  void previewRequest(iframe, "arm-canvas-keys", params);
  return () => {
    stopPort();
    releaseHold();
    if (armedRef.current?.revision === revision) armedRef.current = null;
    if (sameLoad() && iframe.isConnected && previewFrameOpaque(iframe)) {
      void previewRequest(iframe, "arm-canvas-keys", disarmParams(++lastCanvasKeyRevision));
    }
  };
}

let lastCanvasKeyRevision = 0;

function eventInsideCanvas(
  event: Event,
  overlay: HTMLDivElement | null,
  iframe: HTMLIFrameElement | null,
): boolean {
  const root = iframe?.getRootNode();
  if (root instanceof ShadowRoot && event.target === root.host && root.activeElement === iframe) {
    return true;
  }
  return event
    .composedPath()
    .some(
      (node) =>
        node === iframe || (overlay !== null && node instanceof Node && overlay.contains(node)),
    );
}

function useCanvasFocusOwnership(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  blocked: boolean,
): { canvasFocused: boolean; pointerDownRef: React.RefObject<boolean> } {
  const [canvasFocused, setCanvasFocused] = useState(false);
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const inside = eventInsideCanvas(event, overlayRef.current, iframeRef.current);
      pointerDownRef.current = inside;
      setCanvasFocused(inside);
    };
    const onPointerUp = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      const iframe = iframeRef.current;
      if (iframe && previewFrameOpaque(iframe) && hasSealedCanvasKeyboardHold(iframe)) {
        focusSealedIframe(iframe);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!eventInsideCanvas(event, overlayRef.current, iframeRef.current)) setCanvasFocused(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [iframeRef, overlayRef]);

  useEffect(() => {
    if (blocked) setCanvasFocused(false);
  }, [blocked]);

  return { canvasFocused, pointerDownRef };
}

export function useSealedCanvasKeys({
  iframeRef,
  overlayRef,
  selection,
  groupSelections,
  allowCanvasMovement,
  readOnly,
  inlineTextEditing,
  onDeleteSelection,
  applyRuntimeNudge,
  onNudgeSavingChangeRef,
}: UseSealedCanvasKeysParams): void {
  const { canvasFocused, pointerDownRef } = useCanvasFocusOwnership(
    iframeRef,
    overlayRef,
    readOnly || inlineTextEditing,
  );
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [nudgeEpoch, setNudgeEpoch] = useState(0);
  const armedRef = useRef<{ revision: number; selection: DomEditSelection } | null>(null);
  const studioKeys = useStudioKeys();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasKeyframes = usePlayerStore((s) => s.selectedKeyframes.size > 0);
  const hasAutomation = usePlayerStore((s) => s.automationSelection !== null);

  const onDeleteRef = useRef(onDeleteSelection);
  onDeleteRef.current = onDeleteSelection;
  const applyNudgeRef = useRef(applyRuntimeNudge);
  applyNudgeRef.current = applyRuntimeNudge;

  onNudgeSavingChangeRef.current = (saving: boolean) => {
    setNudgeSaving(saving);
    if (!saving) setNudgeEpoch((n) => n + 1);
  };

  const canArm = canvasFocused && selection !== null && !readOnly && !inlineTextEditing;
  const allowNudge = !isPlaying && !nudgeSaving && allowCanvasMovement;
  const allowDelete = !hasKeyframes && !hasAutomation && Boolean(onDeleteSelection);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!canArm || !selection || !iframe || !previewFrameOpaque(iframe)) return;
    return startSealedCanvasSession({
      iframe,
      overlayRef,
      armedRef,
      onDeleteRef,
      applyNudgeRef,
      selection,
      groupSelections,
      studioKeys,
      allowNudge,
      allowDelete,
      shouldFocus: !pointerDownRef.current,
    });
  }, [
    allowDelete,
    allowNudge,
    canArm,
    groupSelections,
    iframeRef,
    nudgeEpoch,
    overlayRef,
    pointerDownRef,
    selection,
    studioKeys,
  ]);
}
