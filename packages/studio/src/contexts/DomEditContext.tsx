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
  | "handleDomAttributesCommit"
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
  | "handleAgentModalRun"
  | "clearFinishedAgentJobs"
  | "moveAgentJob"
  | "answerAgentJob"
  | "steerAgentJob"
  | "promoteAgentJob"
  | "handleTimelineRangeRun"
  | "beginSteerJob"
  | "cancelSteerJob"
  | "cancelAgentJob"
  | "revealAgentJobTarget"
  | "setSelectedAgentId"
  | "addCustomAgent"
  | "setSelectedModel"
  | "setSelectedEffort"
  | "refreshAgentModels"
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
  | "projectId"
  | "domEditSelection"
  | "domEditGroupSelections"
  | "domEditHoverSelection"
  | "activeGroupElement"
  | "domEditSelectionRef"
  | "selectedGsapAnimations"
  | "gsapMultipleTimelines"
  | "gsapUnsupportedTimelinePattern"
  | "agentModalOpen"
  | "steeringJob"
  | "copiedAgentPrompt"
  | "agentPromptSelectionContext"
  | "agentRunLabel"
  | "agentRunKind"
  | "agentIconUrl"
  | "agentIconUrlById"
  | "agentOptions"
  | "agentModels"
  | "selectedModel"
  | "selectedEffort"
  | "selectedAgentId"
  | "agentJobs"
> {}

const DomEditActionsContext = createContext<DomEditActionsValue | null>(null);
const DomEditSelectionContext = createContext<DomEditSelectionValue | null>(null);

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

/** Optional access — mirrors useDomEditActionsContextOptional for player-package mounts. */
export function useDomEditSelectionContextOptional(): DomEditSelectionValue | null {
  return useContext(DomEditSelectionContext);
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
    projectId,
    domEditSelection,
    domEditGroupSelections,
    domEditHoverSelection,
    agentModalOpen,
    steeringJob,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    agentRunLabel,
    agentRunKind,
    agentIconUrl,
    agentIconUrlById,
    agentOptions,
    agentModels,
    selectedModel,
    selectedEffort,
    selectedAgentId,
    agentJobs,
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
    handleDomAttributesCommit,
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
    handleAgentModalRun,
    clearFinishedAgentJobs,
    moveAgentJob,
    answerAgentJob,
    steerAgentJob,
    promoteAgentJob,
    handleTimelineRangeRun,
    beginSteerJob,
    cancelSteerJob,
    cancelAgentJob,
    revealAgentJobTarget,
    setSelectedAgentId,
    addCustomAgent,
    setSelectedModel,
    setSelectedEffort,
    refreshAgentModels,
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
      handleDomAttributesCommit,
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
      handleAgentModalRun,
      clearFinishedAgentJobs,
      moveAgentJob,
      answerAgentJob,
      steerAgentJob,
      promoteAgentJob,
      handleTimelineRangeRun,
      beginSteerJob,
      cancelSteerJob,
      cancelAgentJob,
      revealAgentJobTarget,
      setSelectedAgentId,
      addCustomAgent,
      setSelectedModel,
      setSelectedEffort,
      refreshAgentModels,
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
      handleDomStyleCommit,
      handleDomAttributeCommit,
      handleDomAttributeLiveCommit,
      handleDomHtmlAttributeCommit,
      handleDomAttributesCommit,
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
      handleAgentModalRun,
      clearFinishedAgentJobs,
      moveAgentJob,
      answerAgentJob,
      steerAgentJob,
      promoteAgentJob,
      handleTimelineRangeRun,
      beginSteerJob,
      cancelSteerJob,
      cancelAgentJob,
      revealAgentJobTarget,
      setSelectedAgentId,
      addCustomAgent,
      setSelectedModel,
      setSelectedEffort,
      refreshAgentModels,
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

  const selection = useMemo<DomEditSelectionValue>(
    () => ({
      projectId,
      domEditSelection,
      domEditGroupSelections,
      domEditHoverSelection,
      activeGroupElement,
      domEditSelectionRef,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
      agentModalOpen,
      steeringJob,
      copiedAgentPrompt,
      agentPromptSelectionContext,
      agentRunLabel,
      agentRunKind,
      agentIconUrl,
      agentIconUrlById,
      agentOptions,
      agentModels,
      selectedModel,
      selectedEffort,
      selectedAgentId,
      agentJobs,
    }),
    [
      projectId,
      domEditSelection,
      domEditGroupSelections,
      domEditHoverSelection,
      activeGroupElement,
      domEditSelectionRef,
      selectedGsapAnimations,
      gsapMultipleTimelines,
      gsapUnsupportedTimelinePattern,
      agentModalOpen,
      steeringJob,
      copiedAgentPrompt,
      agentPromptSelectionContext,
      agentRunLabel,
      agentRunKind,
      agentIconUrl,
      agentIconUrlById,
      agentOptions,
      agentModels,
      selectedModel,
      selectedEffort,
      selectedAgentId,
      agentJobs,
    ],
  );
  return (
    <DomEditActionsContext value={actions}>
      <DomEditSelectionContext value={selection}>{children}</DomEditSelectionContext>
    </DomEditActionsContext>
  );
}
