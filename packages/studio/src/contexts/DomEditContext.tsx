// fallow-ignore-file code-duplication
import type { useDomEditSession } from "../hooks/useDomEditSession";
import { useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { createStableContext } from "../utils/hmrStableContext";
import { trackStudioPendingEdit } from "../utils/studioPendingEdits";

type DomEditValue = ReturnType<typeof useDomEditSession>;

export interface DomEditActionsValue extends Pick<
  DomEditValue,
  | "handleTimelineElementSelect"
  | "handlePreviewCanvasMouseDown"
  | "handlePreviewCanvasPointerMove"
  | "handlePreviewCanvasPointerLeave"
  | "applyDomSelection"
  | "clearDomSelection"
  | "refreshDomEditSelectionFromPreview"
  | "handleDomStyleCommit"
  | "handleDomStyleCommitForSelection"
  | "handleDomAttributeCommit"
  | "handleDomAttributeLiveCommit"
  | "handleDomAttributeQuietCommit"
  | "handleDomHtmlAttributeCommit"
  | "handleDomAttributesCommit"
  | "handleDomPathOffsetCommit"
  | "handleDomGroupPathOffsetCommit"
  | "handleDomZIndexReorderCommit"
  | "handleDomBoxSizeCommit"
  | "handleDomRotationCommit"
  | "handleDomManualEditsReset"
  | "handleDomTextCommit"
  | "handleDomTextCommitForSelection"
  | "handleDomRichTextCommit"
  | "handleDomTextFieldStyleCommit"
  | "handleDomAddTextField"
  | "handleDomRemoveTextField"
  | "getGsapAnimationsForSelection"
  | "handleAskAgent"
  | "handleAgentModalSubmit"
  | "handleBlockedDomMove"
  | "handleDomManualDragStart"
  | "handleDomEditElementDelete"
  | "handleGroupSelection"
  | "handleUngroupSelection"
  | "setActiveGroupElement"
  | "buildDomSelectionFromTarget"
  | "buildDomSelectionForTimelineElement"
  | "updateDomEditHoverSelection"
  | "resolveImportedFontAsset"
  | "setAgentModalOpen"
  | "setAgentPromptSelectionContext"
  | "setAgentModalAnchorPoint"
  | "handleGsapUpdateProperty"
  | "handleGsapUpdateMeta"
  | "handleGsapDeleteAnimation"
  | "handleGsapDeleteAllForElement"
  | "handleGsapAddAnimation"
  | "handleGsapAddProperty"
  | "handleGsapRemoveProperty"
  | "handleGsapUpdateFromProperty"
  | "handleGsapAddFromProperty"
  | "handleGsapRemoveFromProperty"
  | "handleGsapAddKeyframe"
  | "handleGsapAddKeyframeBatch"
  | "handleGsapRemoveKeyframe"
  | "handleGsapMoveKeyframeToPlayhead"
  | "handleGsapMoveKeyframe"
  | "handleGsapResizeKeyframedTween"
  | "handleGsapConvertToKeyframes"
  | "handleGsapRemoveAllKeyframes"
  | "handleResetSelectedElementKeyframes"
  | "commitAnimatedProperty"
  | "commitAnimatedProperties"
  | "handleSetArcPath"
  | "handleUpdateArcSegment"
  | "handleUnroll"
  | "invalidateGsapCache"
  | "previewIframeRef"
  | "commitMutation"
  | "applyMarqueeSelection"
  | "handleUpdateKeyframeEase"
  | "handleUpdateSegmentEase"
  | "handleSetAllKeyframeEases"
> {}

export interface DomEditSelectionValue extends Pick<
  DomEditValue,
  | "domEditSelection"
  | "domEditGroupSelections"
  | "domEditHoverSelection"
  | "activeGroupElement"
  | "domEditSelectionRef"
  | "selectedGsapAnimations"
  | "gsapMultipleTimelines"
  | "gsapUnsupportedTimelinePattern"
  | "agentModalOpen"
  | "agentModalAnchorPoint"
  | "copiedAgentPrompt"
  | "agentPromptSelectionContext"
> {}

/** Every action that saves an edit. Undo drains them, so each counts from its call, not from its first write. */
const EDIT_COMMITS = [
  "handleDomStyleCommit",
  "handleDomStyleCommitForSelection",
  "handleDomAttributeCommit",
  "handleDomAttributeQuietCommit",
  "handleDomHtmlAttributeCommit",
  "handleDomAttributesCommit",
  "handleDomPathOffsetCommit",
  "handleDomGroupPathOffsetCommit",
  "handleDomZIndexReorderCommit",
  "handleDomBoxSizeCommit",
  "handleDomRotationCommit",
  "handleDomManualEditsReset",
  "handleDomTextCommit",
  "handleDomTextCommitForSelection",
  "handleDomRichTextCommit",
  "handleDomTextFieldStyleCommit",
  "handleDomAddTextField",
  "handleDomRemoveTextField",
  "handleDomEditElementDelete",
  "handleGroupSelection",
  "handleUngroupSelection",
  "handleGsapUpdateProperty",
  "handleGsapUpdateMeta",
  "handleGsapDeleteAnimation",
  "handleGsapDeleteAllForElement",
  "handleGsapAddAnimation",
  "handleGsapAddProperty",
  "handleGsapRemoveProperty",
  "handleGsapUpdateFromProperty",
  "handleGsapAddFromProperty",
  "handleGsapRemoveFromProperty",
  "handleGsapAddKeyframe",
  "handleGsapAddKeyframeBatch",
  "handleGsapRemoveKeyframe",
  "handleGsapMoveKeyframeToPlayhead",
  "handleGsapMoveKeyframe",
  "handleGsapResizeKeyframedTween",
  "handleGsapConvertToKeyframes",
  "handleGsapRemoveAllKeyframes",
  "handleResetSelectedElementKeyframes",
  "commitAnimatedProperty",
  "commitAnimatedProperties",
  "handleSetArcPath",
  "handleUpdateArcSegment",
  "handleUnroll",
  "commitMutation",
  "handleUpdateKeyframeEase",
  "handleUpdateSegmentEase",
  "handleSetAllKeyframeEases",
] as const satisfies ReadonlyArray<keyof DomEditActionsValue>;

// A failed edit rolls itself back and reports itself; undo only has to wait for it to settle.
function trackEditCommits(actions: DomEditActionsValue): DomEditActionsValue {
  const tracked: Record<string, unknown> = { ...actions };
  for (const key of EDIT_COMMITS) {
    const commit = actions[key] as (...args: unknown[]) => unknown;
    tracked[key] = (...args: unknown[]) => {
      const result = commit(...args);
      if (result instanceof Promise) trackStudioPendingEdit(result.catch(() => undefined));
      return result;
    };
  }
  return tracked as unknown as DomEditActionsValue;
}

const DomEditActionsContext = createStableContext<DomEditActionsValue | null>(
  "DomEditActionsContext",
  null,
);
const DomEditSelectionContext = createStableContext<DomEditSelectionValue | null>(
  "DomEditSelectionContext",
  null,
);

export function useDomEditActionsContext(): DomEditActionsValue {
  const ctx = useContext(DomEditActionsContext);
  if (!ctx) throw new Error("useDomEditActionsContext must be used within DomEditProvider");
  return ctx;
}

/**
 * Optional access — returns null outside a provider. Lets the player-package
 * <Timeline> (a public standalone export) reach the z-order persist path when
 * embedded in the NLE without hard-requiring the provider in standalone/test mounts.
 */
export function useDomEditActionsContextOptional(): DomEditActionsValue | null {
  return useContext(DomEditActionsContext);
}

export function useDomEditSelectionContext(): DomEditSelectionValue {
  const ctx = useContext(DomEditSelectionContext);
  if (!ctx) throw new Error("useDomEditSelectionContext must be used within DomEditProvider");
  return ctx;
}

/** Optional counterpart to useDomEditActionsContextOptional — same reason: the
 *  player package's own components mount outside a provider in standalone and
 *  test trees, where "no dom-edit selection" is the correct answer. */
export function useDomEditSelectionContextOptional(): DomEditSelectionValue | null {
  return useContext(DomEditSelectionContext);
}

/** @deprecated Prefer useDomEditActionsContext or useDomEditSelectionContext. */
export function useDomEditContext(): DomEditValue {
  return { ...useDomEditActionsContext(), ...useDomEditSelectionContext() };
}

export function DomEditProvider({
  value: {
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    agentModalOpen,
    agentModalAnchorPoint,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    domEditSelectionRef,
    handleTimelineElementSelect,
    handlePreviewCanvasMouseDown,
    handlePreviewCanvasPointerMove,
    handlePreviewCanvasPointerLeave,
    applyDomSelection,
    clearDomSelection,
    refreshDomEditSelectionFromPreview,
    handleDomStyleCommit,
    handleDomStyleCommitForSelection,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomZIndexReorderCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,

    handleDomTextCommit,
    handleDomTextCommitForSelection,
    handleDomRichTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    getGsapAnimationsForSelection,
    handleAskAgent,
    handleAgentModalSubmit,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomEditElementDelete,
    handleGroupSelection,
    handleUngroupSelection,
    setActiveGroupElement,
    activeGroupElement,
    buildDomSelectionFromTarget,
    buildDomSelectionForTimelineElement,
    updateDomEditHoverSelection,
    resolveImportedFontAsset,
    setAgentModalOpen,
    setAgentPromptSelectionContext,
    setAgentModalAnchorPoint,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapDeleteAllForElement,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    handleGsapAddKeyframe,
    handleGsapAddKeyframeBatch,
    handleGsapRemoveKeyframe,
    handleGsapMoveKeyframeToPlayhead,
    handleGsapMoveKeyframe,
    handleGsapResizeKeyframedTween,
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    invalidateGsapCache,
    previewIframeRef,
    commitMutation,
    applyMarqueeSelection,
    handleUpdateKeyframeEase,
    handleUpdateSegmentEase,
    handleSetAllKeyframeEases,
  },
  children,
}: {
  value: DomEditValue;
  children: ReactNode;
}) {
  const commitMutationRef = useRef(commitMutation);
  commitMutationRef.current = commitMutation;

  const stableCommitMutation = useCallback<DomEditActionsValue["commitMutation"]>(
    (mutation, options) => commitMutationRef.current(mutation, options),
    [],
  );

  const untrackedActions = useMemo<DomEditActionsValue>(
    () => ({
      handleTimelineElementSelect,
      handlePreviewCanvasMouseDown,
      handlePreviewCanvasPointerMove,
      handlePreviewCanvasPointerLeave,
      applyDomSelection,
      clearDomSelection,
      refreshDomEditSelectionFromPreview,
      handleDomStyleCommit,
      handleDomStyleCommitForSelection,
      handleDomAttributeCommit,
      handleDomAttributeLiveCommit,
      handleDomAttributeQuietCommit,
      handleDomHtmlAttributeCommit,
      handleDomAttributesCommit,
      handleDomPathOffsetCommit,
      handleDomGroupPathOffsetCommit,
      handleDomZIndexReorderCommit,
      handleDomBoxSizeCommit,
      handleDomRotationCommit,
      handleDomManualEditsReset,
      handleDomTextCommit,
      handleDomTextCommitForSelection,
      handleDomRichTextCommit,
      handleDomTextFieldStyleCommit,
      handleDomAddTextField,
      handleDomRemoveTextField,
      getGsapAnimationsForSelection,
      handleAskAgent,
      handleAgentModalSubmit,
      handleBlockedDomMove,
      handleDomManualDragStart,
      handleDomEditElementDelete,
      handleGroupSelection,
      handleUngroupSelection,
      setActiveGroupElement,
      buildDomSelectionFromTarget,
      buildDomSelectionForTimelineElement,
      updateDomEditHoverSelection,
      resolveImportedFontAsset,
      setAgentModalOpen,
      setAgentPromptSelectionContext,
      setAgentModalAnchorPoint,
      handleGsapUpdateProperty,
      handleGsapUpdateMeta,
      handleGsapDeleteAnimation,
      handleGsapDeleteAllForElement,
      handleGsapAddAnimation,
      handleGsapAddProperty,
      handleGsapRemoveProperty,
      handleGsapUpdateFromProperty,
      handleGsapAddFromProperty,
      handleGsapRemoveFromProperty,
      handleGsapAddKeyframe,
      handleGsapAddKeyframeBatch,
      handleGsapRemoveKeyframe,
      handleGsapMoveKeyframeToPlayhead,
      handleGsapMoveKeyframe,
      handleGsapResizeKeyframedTween,
      handleGsapConvertToKeyframes,
      handleGsapRemoveAllKeyframes,
      handleResetSelectedElementKeyframes,
      commitAnimatedProperty,
      commitAnimatedProperties,
      handleSetArcPath,
      handleUpdateArcSegment,
      handleUnroll,
      invalidateGsapCache,
      previewIframeRef,
      commitMutation: stableCommitMutation,
      applyMarqueeSelection,
      handleUpdateKeyframeEase,
      handleUpdateSegmentEase,
      handleSetAllKeyframeEases,
    }),
    [
      handleTimelineElementSelect,
      handlePreviewCanvasMouseDown,
      handlePreviewCanvasPointerMove,
      handlePreviewCanvasPointerLeave,
      applyDomSelection,
      clearDomSelection,
      refreshDomEditSelectionFromPreview,
      handleDomStyleCommit,
      handleDomStyleCommitForSelection,
      handleDomAttributeCommit,
      handleDomAttributeLiveCommit,
      handleDomAttributeQuietCommit,
      handleDomHtmlAttributeCommit,
      handleDomAttributesCommit,
      handleDomPathOffsetCommit,
      handleDomGroupPathOffsetCommit,
      handleDomZIndexReorderCommit,
      handleDomBoxSizeCommit,
      handleDomRotationCommit,
      handleDomManualEditsReset,
      handleDomTextCommit,
      handleDomTextCommitForSelection,
      handleDomRichTextCommit,
      handleDomTextFieldStyleCommit,
      handleDomAddTextField,
      handleDomRemoveTextField,
      getGsapAnimationsForSelection,
      handleAskAgent,
      handleAgentModalSubmit,
      handleBlockedDomMove,
      handleDomManualDragStart,
      handleDomEditElementDelete,
      handleGroupSelection,
      handleUngroupSelection,
      setActiveGroupElement,
      buildDomSelectionFromTarget,
      buildDomSelectionForTimelineElement,
      updateDomEditHoverSelection,
      resolveImportedFontAsset,
      setAgentModalOpen,
      setAgentPromptSelectionContext,
      setAgentModalAnchorPoint,
      handleGsapUpdateProperty,
      handleGsapUpdateMeta,
      handleGsapDeleteAnimation,
      handleGsapDeleteAllForElement,
      handleGsapAddAnimation,
      handleGsapAddProperty,
      handleGsapRemoveProperty,
      handleGsapUpdateFromProperty,
      handleGsapAddFromProperty,
      handleGsapRemoveFromProperty,
      handleGsapAddKeyframe,
      handleGsapAddKeyframeBatch,
      handleGsapRemoveKeyframe,
      handleGsapMoveKeyframeToPlayhead,
      handleGsapMoveKeyframe,
      handleGsapResizeKeyframedTween,
      handleGsapConvertToKeyframes,
      handleGsapRemoveAllKeyframes,
      handleResetSelectedElementKeyframes,
      commitAnimatedProperty,
      commitAnimatedProperties,
      handleSetArcPath,
      handleUpdateArcSegment,
      handleUnroll,
      invalidateGsapCache,
      previewIframeRef,
      stableCommitMutation,
      applyMarqueeSelection,
      handleUpdateKeyframeEase,
      handleUpdateSegmentEase,
      handleSetAllKeyframeEases,
    ],
  );

  const actions = useMemo(() => trackEditCommits(untrackedActions), [untrackedActions]);

  const selection = useMemo<DomEditSelectionValue>(
    () => ({
      domEditSelection,
      domEditGroupSelections,
      domEditHoverSelection,
      activeGroupElement,
      domEditSelectionRef,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
      agentModalOpen,
      agentModalAnchorPoint,
      copiedAgentPrompt,
      agentPromptSelectionContext,
    }),
    [
      domEditSelection,
      domEditGroupSelections,
      domEditHoverSelection,
      activeGroupElement,
      domEditSelectionRef,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
      agentModalOpen,
      agentModalAnchorPoint,
      copiedAgentPrompt,
      agentPromptSelectionContext,
    ],
  );
  return (
    <DomEditActionsContext value={actions}>
      <DomEditSelectionContext value={selection}>{children}</DomEditSelectionContext>
    </DomEditActionsContext>
  );
}
