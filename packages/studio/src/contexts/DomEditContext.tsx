// fallow-ignore-file code-duplication
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import type { useDomEditSession } from "../hooks/useDomEditSession";

type DomEditValue = ReturnType<typeof useDomEditSession>;

export interface DomEditActionsValue extends Pick<
  DomEditValue,
  | "handleTimelineElementSelect"
  | "handlePreviewCanvasMouseDown"
  | "handlePreviewCanvasPointerMove"
  | "handlePreviewCanvasPointerLeave"
  | "applyDomSelection"
  | "clearDomSelection"
  | "handleDomStyleCommit"
  | "handleDomAttributeCommit"
  | "handleDomAttributeLiveCommit"
  | "handleDomHtmlAttributeCommit"
  | "handleDomPathOffsetCommit"
  | "handleDomGroupPathOffsetCommit"
  | "handleDomZIndexReorderCommit"
  | "handleDomBoxSizeCommit"
  | "handleDomRotationCommit"
  | "handleDomManualEditsReset"
  | "handleDomTextCommit"
  | "handleDomTextFieldStyleCommit"
  | "handleDomAddTextField"
  | "handleDomRemoveTextField"
  | "handleAskAgent"
  | "handleAgentModalSubmit"
  | "handleBlockedDomMove"
  | "handleDomManualDragStart"
  | "handleDomEditElementDelete"
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
  | "handleGsapConvertToKeyframes"
  | "handleGsapRemoveAllKeyframes"
  | "handleResetSelectedElementKeyframes"
  | "commitAnimatedProperty"
  | "handleSetArcPath"
  | "handleUpdateArcSegment"
  | "handleUnroll"
  | "invalidateGsapCache"
  | "previewIframeRef"
  | "commitMutation"
  | "applyMarqueeSelection"
  | "handleUpdateKeyframeEase"
> {}

export interface DomEditSelectionValue extends Pick<
  DomEditValue,
  | "domEditSelection"
  | "domEditGroupSelections"
  | "domEditHoverSelection"
  | "domEditSelectionRef"
  | "selectedGsapAnimations"
  | "gsapMultipleTimelines"
  | "gsapUnsupportedTimelinePattern"
  | "agentModalOpen"
  | "agentModalAnchorPoint"
  | "copiedAgentPrompt"
  | "agentPromptSelectionContext"
> {}

const DomEditActionsContext = createContext<DomEditActionsValue | null>(null);
const DomEditSelectionContext = createContext<DomEditSelectionValue | null>(null);

export function useDomEditActionsContext(): DomEditActionsValue {
  const ctx = useContext(DomEditActionsContext);
  if (!ctx) throw new Error("useDomEditActionsContext must be used within DomEditProvider");
  return ctx;
}

export function useDomEditSelectionContext(): DomEditSelectionValue {
  const ctx = useContext(DomEditSelectionContext);
  if (!ctx) throw new Error("useDomEditSelectionContext must be used within DomEditProvider");
  return ctx;
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
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomHtmlAttributeCommit,
    handleDomPathOffsetCommit,
    handleDomGroupPathOffsetCommit,
    handleDomZIndexReorderCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomManualEditsReset,

    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    handleAgentModalSubmit,
    handleBlockedDomMove,
    handleDomManualDragStart,
    handleDomEditElementDelete,
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
    handleGsapConvertToKeyframes,
    handleGsapRemoveAllKeyframes,
    handleResetSelectedElementKeyframes,
    commitAnimatedProperty,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    invalidateGsapCache,
    previewIframeRef,
    commitMutation,
    applyMarqueeSelection,
    handleUpdateKeyframeEase,
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

  const actions = useMemo<DomEditActionsValue>(
    () => ({
      handleTimelineElementSelect,
      handlePreviewCanvasMouseDown,
      handlePreviewCanvasPointerMove,
      handlePreviewCanvasPointerLeave,
      applyDomSelection,
      clearDomSelection,
      handleDomStyleCommit,
      handleDomAttributeCommit,
      handleDomAttributeLiveCommit,
      handleDomHtmlAttributeCommit,
      handleDomPathOffsetCommit,
      handleDomGroupPathOffsetCommit,
      handleDomZIndexReorderCommit,
      handleDomBoxSizeCommit,
      handleDomRotationCommit,
      handleDomManualEditsReset,
      handleDomTextCommit,
      handleDomTextFieldStyleCommit,
      handleDomAddTextField,
      handleDomRemoveTextField,
      handleAskAgent,
      handleAgentModalSubmit,
      handleBlockedDomMove,
      handleDomManualDragStart,
      handleDomEditElementDelete,
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
      handleGsapConvertToKeyframes,
      handleGsapRemoveAllKeyframes,
      handleResetSelectedElementKeyframes,
      commitAnimatedProperty,
      handleSetArcPath,
      handleUpdateArcSegment,
      handleUnroll,
      invalidateGsapCache,
      previewIframeRef,
      commitMutation: stableCommitMutation,
      applyMarqueeSelection,
      handleUpdateKeyframeEase,
    }),
    [
      handleTimelineElementSelect,
      handlePreviewCanvasMouseDown,
      handlePreviewCanvasPointerMove,
      handlePreviewCanvasPointerLeave,
      applyDomSelection,
      clearDomSelection,
      handleDomStyleCommit,
      handleDomAttributeCommit,
      handleDomAttributeLiveCommit,
      handleDomHtmlAttributeCommit,
      handleDomPathOffsetCommit,
      handleDomGroupPathOffsetCommit,
      handleDomZIndexReorderCommit,
      handleDomBoxSizeCommit,
      handleDomRotationCommit,
      handleDomManualEditsReset,
      handleDomTextCommit,
      handleDomTextFieldStyleCommit,
      handleDomAddTextField,
      handleDomRemoveTextField,
      handleAskAgent,
      handleAgentModalSubmit,
      handleBlockedDomMove,
      handleDomManualDragStart,
      handleDomEditElementDelete,
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
      handleGsapConvertToKeyframes,
      handleGsapRemoveAllKeyframes,
      handleResetSelectedElementKeyframes,
      commitAnimatedProperty,
      handleSetArcPath,
      handleUpdateArcSegment,
      handleUnroll,
      invalidateGsapCache,
      previewIframeRef,
      stableCommitMutation,
      applyMarqueeSelection,
      handleUpdateKeyframeEase,
    ],
  );

  const selection = useMemo<DomEditSelectionValue>(
    () => ({
      domEditSelection,
      domEditGroupSelections,
      domEditHoverSelection,
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
