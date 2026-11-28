// Coordinates sealed preview keyboard focus, armed Delete/nudge handles, and Studio shortcut forwarding.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArmCanvasKeysParams,
  CanvasKeyActionEvent,
  CanvasKeyNudgeCombo,
  EditingElementHandle,
  EditingKeyEvent,
} from "@hyperframes/core/runtime/editing-port";
import { resetKeyframesMayClaim } from "../../hooks/appHotkeysDispatch";
import { membersForDelete } from "../../hooks/domEditDeleteMembers";
import { noteFrameRemovedHandles } from "../../hooks/previewTimingPatch";
import {
  getStudioKeys,
  useStudioKeys,
  type StudioKeys,
} from "../../player/components/studioShortcuts";
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
  baseGsap: Record<string, { x: number; y: number }>;
}

export type CanvasDeleteHandler = (
  selection: DomEditSelection,
  options?: {
    expandGroup?: boolean;
    members?: readonly DomEditSelection[];
    onSettled?: (ok: boolean) => void;
  },
) => Promise<unknown> | void;

export interface UseSealedCanvasKeysParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  allowCanvasMovement: boolean;
  readOnly: boolean;
  inlineTextEditing: boolean;
  holdsPress: () => boolean;
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
  if (!excluded.has("Enter")) unique.add("Enter");
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

/** Saves exactly the members the frame removed under this arm; rolls back any it cannot name. */
function runDeleteAction(
  iframe: HTMLIFrameElement,
  del: CanvasDeleteHandler | undefined,
  armedDeletes: ReadonlyMap<EditingElementHandle, DomEditSelection>,
  event: Extract<CanvasKeyActionEvent, { action: "delete" }>,
): void {
  const members = event.handles.map((handle) => armedDeletes.get(handle));
  if (!del || !members.every((member): member is DomEditSelection => Boolean(member)))
    return resolveAction(iframe, event.actionId, "rollback");
  noteFrameRemovedHandles(iframe, event.handles);
  let settled: boolean | null = null;
  const onSettled = (ok: boolean) => {
    settled = ok;
  };
  Promise.resolve()
    .then(() => del(members[0]!, { members, onSettled }))
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
  resetMayClaim: boolean;
}): { params: ArmCanvasKeysParams; armedDeletes: Map<EditingElementHandle, DomEditSelection> } {
  const { deleteMembers, nudgeMembers } = resolveCanvasTargets(
    input.selection,
    input.groupSelections,
  );
  const deleteHandles = input.allowDelete ? (handlesFor(deleteMembers) ?? []) : [];
  const { deleteSelected, deleteSelectedAlt, resetKeyframes } = input.studioKeys;
  // A combo Reset Keyframes may claim stays with Studio's dispatcher, which tries reset first.
  const deleteCombos = deleteHandles.length
    ? [deleteSelected, deleteSelectedAlt].filter(
        (combo) => !input.resetMayClaim || combo !== resetKeyframes,
      )
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
  const params = {
    revision: input.revision,
    focus: input.focus,
    deleteHandles,
    deleteCombos,
    nudge,
    forwardCombos: forwardCombosFor(input.studioKeys, excluded),
  };
  return {
    params,
    armedDeletes: new Map(deleteHandles.map((handle, i) => [handle, deleteMembers[i]!])),
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

type CanvasActionHandler = (event: CanvasKeyActionEvent) => void;
const actionRoutes = new WeakMap<object, Map<number, CanvasActionHandler>>();

const personActedJustNow = () => navigator.userActivation?.isActive === true;
const canvasCancelListeners = new Set<(frame: HTMLIFrameElement) => void>();

export function onSealedCanvasCancel(listener: (frame: HTMLIFrameElement) => void): () => void {
  canvasCancelListeners.add(listener);
  return () => void canvasCancelListeners.delete(listener);
}

export function cancelFromSealedCanvas(frame: HTMLIFrameElement): void {
  for (const cancel of canvasCancelListeners) cancel(frame);
}

function isBareCancelEscape(key: EditingKeyEvent): boolean {
  if (key.type !== "keydown" || key.key !== "Escape" || getStudioKeys().cancel !== "Escape")
    return false;
  return !key.altKey && !key.ctrlKey && !key.metaKey && !key.shiftKey;
}

/** One action listener per frame load, routing by arm revision; a Delete for no known arm rolls back. */
function canvasActionRoute(iframe: HTMLIFrameElement): Map<number, CanvasActionHandler> {
  const client = previewEditingClient(iframe);
  const known = actionRoutes.get(client);
  if (known) return known;
  const sessions = new Map<number, CanvasActionHandler>();
  client.onCanvasKeyAction((event) => {
    const handler = personActedJustNow() ? sessions.get(event.revision) : undefined;
    if (handler) handler(event);
    else if (event.action === "delete") resolveAction(iframe, event.actionId, "rollback");
  });
  actionRoutes.set(client, sessions);
  return sessions;
}

function forwardSealedKeys(
  iframe: HTMLIFrameElement,
  overlayRef: React.RefObject<HTMLDivElement | null>,
  sameLoad: () => boolean,
): () => void {
  return previewEditingClient(iframe).onKey((key) => {
    if (!sameLoad() || !hasSealedCanvasKeyboardHold(iframe)) return;
    if (!personActedJustNow()) {
      if (isBareCancelEscape(key)) cancelFromSealedCanvas(iframe);
      return;
    }
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
}

function startSealedCanvasSession(input: {
  iframe: HTMLIFrameElement;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  armedReadyRef: React.MutableRefObject<boolean>;
  studioHoldsPress: () => boolean;
  onDeleteRef: React.RefObject<CanvasDeleteHandler | undefined>;
  applyNudgeRef: React.RefObject<(step: RuntimeNudgeStep) => void>;
  selection: DomEditSelection;
  groupSelections: DomEditSelection[];
  studioKeys: StudioKeys;
  allowNudge: boolean;
  allowDelete: boolean;
  resetMayClaim: boolean;
}): () => void {
  const { iframe, armedReadyRef, studioHoldsPress, onDeleteRef, applyNudgeRef, selection } = input;
  const revision = ++lastCanvasKeyRevision;
  armedReadyRef.current = false;
  const { params, armedDeletes } = buildArmParams({
    revision,
    focus: !studioHoldsPress(),
    selection,
    groupSelections: input.groupSelections,
    studioKeys: input.studioKeys,
    allowNudge: input.allowNudge,
    allowDelete: input.allowDelete,
    resetMayClaim: input.resetMayClaim,
  });
  const sameLoad = samePreviewLoad(iframe);
  const releaseHold = holdSealedCanvasKeyboard(iframe);
  const sessions = canvasActionRoute(iframe);
  let live = true;
  // A Delete pressed under this arm saves even when it lands after the session ends, as it would unsealed.
  sessions.set(revision, (event) => {
    if (!sameLoad()) return;
    if (event.action === "delete")
      return runDeleteAction(iframe, onDeleteRef.current, armedDeletes, event);
    if (!live || !hasSealedCanvasKeyboardHold(iframe)) return;
    applyNudgeRef.current({
      handles: event.handles,
      totalDx: event.totalDx,
      totalDy: event.totalDy,
      drafts: event.drafts,
      baseGsap: event.baseGsap,
    });
  });
  const stopKeys = forwardSealedKeys(iframe, input.overlayRef, sameLoad);
  void previewRequest(iframe, "arm-canvas-keys", params).then((res) => {
    if (!live || !sameLoad() || !res?.armed) return;
    armedReadyRef.current = true;
    if (!studioHoldsPress() && hasSealedCanvasKeyboardHold(iframe)) focusSealedIframe(iframe);
  });
  return () => {
    live = false;
    armedReadyRef.current = false;
    stopKeys();
    releaseHold();
    // The frame posts this arm's actions before it answers the disarm, so its answer ends them.
    const disarmed =
      sameLoad() && iframe.isConnected && previewFrameOpaque(iframe)
        ? previewRequest(iframe, "arm-canvas-keys", disarmParams(++lastCanvasKeyRevision))
        : null;
    const end = () => sessions.delete(revision);
    void Promise.resolve(disarmed).then(end, end);
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
  armedReadyRef: React.RefObject<boolean>,
  blocked: boolean,
  holdsPress: () => boolean,
): { canvasFocused: boolean; studioHoldsPress: () => boolean } {
  const [canvasFocused, setCanvasFocused] = useState(false);
  const pointerDownRef = useRef(false);
  const holdsPressRef = useRef(holdsPress);
  holdsPressRef.current = holdsPress;
  const studioHoldsPress = useCallback(() => pointerDownRef.current || holdsPressRef.current(), []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const inside = eventInsideCanvas(event, overlayRef.current, iframeRef.current);
      pointerDownRef.current = inside;
      setCanvasFocused(inside);
    };
    let focusOnceDropLands = 0;
    const focusFrameAfterDrop = () => {
      const iframe = iframeRef.current;
      if (
        iframe &&
        !studioHoldsPress() &&
        armedReadyRef.current &&
        previewFrameOpaque(iframe) &&
        hasSealedCanvasKeyboardHold(iframe)
      ) {
        focusSealedIframe(iframe);
      }
    };
    const onPointerUp = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      window.clearTimeout(focusOnceDropLands);
      focusOnceDropLands = window.setTimeout(focusFrameAfterDrop);
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
      window.clearTimeout(focusOnceDropLands);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [armedReadyRef, iframeRef, overlayRef, studioHoldsPress]);

  useEffect(() => {
    if (blocked) setCanvasFocused(false);
  }, [blocked]);

  return { canvasFocused, studioHoldsPress };
}

function useSealedCanvasPermissions(
  allowCanvasMovement: boolean,
  nudgeSaving: boolean,
  hasDeleteHandler: boolean,
): { allowNudge: boolean; allowDelete: boolean; resetMayClaim: boolean } {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasKeyframes = usePlayerStore((s) => s.selectedKeyframes.size > 0);
  const hasAutomation = usePlayerStore((s) => s.automationSelection !== null);
  const resetMayClaim = usePlayerStore(resetKeyframesMayClaim);
  return {
    allowNudge: !isPlaying && !nudgeSaving && allowCanvasMovement,
    allowDelete: !hasKeyframes && !hasAutomation && hasDeleteHandler,
    resetMayClaim,
  };
}

export function useSealedCanvasKeys({
  iframeRef,
  overlayRef,
  selection,
  groupSelections,
  allowCanvasMovement,
  readOnly,
  inlineTextEditing,
  holdsPress,
  onDeleteSelection,
  applyRuntimeNudge,
  onNudgeSavingChangeRef,
}: UseSealedCanvasKeysParams): void {
  const armedReadyRef = useRef(false);
  const { canvasFocused, studioHoldsPress } = useCanvasFocusOwnership(
    iframeRef,
    overlayRef,
    armedReadyRef,
    readOnly || inlineTextEditing,
    holdsPress,
  );
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [nudgeEpoch, setNudgeEpoch] = useState(0);
  const studioKeys = useStudioKeys();
  const { allowNudge, allowDelete, resetMayClaim } = useSealedCanvasPermissions(
    allowCanvasMovement,
    nudgeSaving,
    Boolean(onDeleteSelection),
  );

  const onDeleteRef = useRef(onDeleteSelection);
  onDeleteRef.current = onDeleteSelection;
  const applyNudgeRef = useRef(applyRuntimeNudge);
  applyNudgeRef.current = applyRuntimeNudge;

  onNudgeSavingChangeRef.current = (saving: boolean) => {
    setNudgeSaving(saving);
    if (!saving) setNudgeEpoch((n) => n + 1);
  };

  const canArm = canvasFocused && selection !== null && !readOnly && !inlineTextEditing;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!canArm || !selection || !iframe || !previewFrameOpaque(iframe)) return;
    return startSealedCanvasSession({
      iframe,
      overlayRef,
      armedReadyRef,
      studioHoldsPress,
      onDeleteRef,
      applyNudgeRef,
      selection,
      groupSelections,
      studioKeys,
      allowNudge,
      allowDelete,
      resetMayClaim,
    });
  }, [
    allowDelete,
    allowNudge,
    canArm,
    groupSelections,
    iframeRef,
    nudgeEpoch,
    overlayRef,
    resetMayClaim,
    studioHoldsPress,
    selection,
    studioKeys,
  ]);
}
