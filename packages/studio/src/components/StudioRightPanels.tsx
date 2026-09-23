import { useCallback } from "react";
import type { StudioRightPanelsProps } from "./StudioRightPanels.types";

import { PropertyPanel } from "./editor/PropertyPanel";
import { LayersPanel } from "./editor/LayersPanel";
import { CaptionPropertyPanel } from "../captions/components/CaptionPropertyPanel";
import { BlockParamsPanel } from "./editor/BlockParamsPanel";
import { RenderQueuePanel } from "./renders/RenderQueuePanel";
import { SlideshowPanel } from "./panels/SlideshowPanel";
import { VariablesPanel } from "./panels/VariablesPanel";
import { Dock } from "./dock/Dock";
import { useDockLayoutStore } from "./dock/dockLayoutStore";
import type { RenderJob } from "./renders/useRenderQueue";
import { useSlideshowPersist } from "../hooks/useSlideshowPersist";
import { useSlideshowTabState } from "../hooks/useSlideshowTabState";
import {
  useBlockParamsDismissal,
  useCaptionDesignFocus,
  useSlideshowDockPanel,
} from "../hooks/useRightPanelIntents";
import { DesignPanelPromoteProvider } from "./DesignPanelPromoteProvider";
import { useStudioPlaybackContext, useStudioShellContext } from "../contexts/StudioContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { useDomEditContext } from "../contexts/DomEditContext";
import { usePlayerStore } from "../player";
import {
  applyColorGradingScopeUpdate,
  EMPTY_COLOR_GRADING_SCOPE_RESULT,
  type ColorGradingScope,
} from "./studioColorGradingScope";
import { timelineKeysForSelections } from "../utils/studioHelpers";
import { canHideSelections } from "../utils/timelineInspector";
import { useRemoveBackground } from "../hooks/useRemoveBackground";

// fallow-ignore-next-line complexity
export function StudioRightPanels({
  activeBlockParams,
  onCloseBlockParams,
  onDismissBlockParams,
  recordingState,
  recordingDuration,
  onToggleRecording,
  sdkSession,
  publishSdkSession,
  forceReloadSdkSession,
  reloadPreview,
  recordEdit,
  onToggleElementHidden,
  onAutoGroupCarveSources,
  onAddMediaOverlay,
}: StudioRightPanelsProps) {
  const {
    previewIframeRef,
    projectId,
    activeCompPath,
    showToast,
    waitForPendingDomEditSaves,
    renderQueue,
  } = useStudioShellContext();
  const { captionEditMode, refreshKey } = useStudioPlaybackContext();

  const {
    domEditSelection,
    domEditGroupSelections,
    copiedAgentPrompt,
    clearDomSelection,
    handleUngroupSelection,
    handleGroupSelection,
    handleDomStyleCommit,
    handleDomAttributeCommit,
    handleDomAttributeLiveCommit,
    handleDomAttributeQuietCommit,
    handleDomHtmlAttributeCommit,
    handleDomAttributesCommit,
    handleDomPathOffsetCommit,
    handleDomBoxSizeCommit,
    handleDomRotationCommit,
    handleDomTextCommit,
    handleDomTextFieldStyleCommit,
    handleDomAddTextField,
    handleDomRemoveTextField,
    handleAskAgent,
    selectedGsapAnimations,
    gsapMultipleTimelines,
    gsapUnsupportedTimelinePattern,
    handleGsapUpdateProperty,
    handleGsapUpdateMeta,
    handleGsapDeleteAnimation,
    handleGsapAddAnimation,
    handleGsapAddProperty,
    handleGsapRemoveProperty,
    handleGsapUpdateFromProperty,
    handleGsapAddFromProperty,
    handleGsapRemoveFromProperty,
    commitAnimatedProperty,
    commitAnimatedProperties,
    handleSetArcPath,
    handleUpdateArcSegment,
    handleUnroll,
    handleUpdateKeyframeEase,
    handleUpdateSegmentEase,
    handleSetAllKeyframeEases,
    handleGsapAddKeyframe,
    handleGsapRemoveKeyframe,
    handleGsapConvertToKeyframes,
  } = useDomEditContext();

  const {
    assets,
    fontAssets,
    projectDir,
    handleImportFiles,
    handleImportFonts,
    refreshFileTree,
    readProjectFile,
    writeProjectFile,
    fileTree,
    editingFile,
  } = useFileManagerContext();

  // Discrete ops (toggle, reorder, add/delete, hotspot): persist immediately,
  // no coalescing — each is a distinct user action that deserves its own undo entry.
  const onPersistSlideshow = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    publishSdkSession,
  });

  // Notes path: persists are debounced in SlideshowPanel; coalesceKey ensures
  // rapid writes collapse into a single undo entry via the save-queue infra.
  const onPersistSlideshowNotes = useSlideshowPersist({
    sdkSession,
    activeCompPath,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    publishSdkSession,
    coalesceKey: activeCompPath ? `slideshow-notes:${activeCompPath}` : "slideshow-notes",
  });

  const renderJobs = renderQueue.jobs as RenderJob[];
  const slideshowVisible = useDockLayoutStore((state) => state.visiblePanels.has("slideshow"));
  const { isSlideshowComposition, slideshowScenes } = useSlideshowTabState({
    editingFileContent: editingFile?.content,
    previewIframeRef,
    refreshKey,
    slideshowVisible,
  });
  useSlideshowDockPanel(isSlideshowComposition);
  useBlockParamsDismissal({
    hasBlockParams: activeBlockParams != null,
    onDismiss: onDismissBlockParams,
  });
  useCaptionDesignFocus(captionEditMode);

  const handleApplyColorGradingScope = useCallback(
    async (scope: ColorGradingScope, value: string | null) =>
      applyColorGradingScopeUpdate({
        scope,
        value,
        selectedSourceFile: domEditSelection?.sourceFile || activeCompPath || "index.html",
        fileTree,
        projectId,
        waitForPendingDomEditSaves,
        readProjectFile,
        writeProjectFile,
        recordEdit,
        reloadPreview,
        showToast,
      }).catch((error) => {
        showToast(
          `Couldn't apply color grading: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return EMPTY_COLOR_GRADING_SCOPE_RESULT;
      }),
    [
      activeCompPath,
      domEditSelection?.sourceFile,
      fileTree,
      projectId,
      readProjectFile,
      recordEdit,
      reloadPreview,
      showToast,
      waitForPendingDomEditSaves,
      writeProjectFile,
    ],
  );

  const handleRemoveBackground = useRemoveBackground(projectId, refreshFileTree, showToast);

  /**
   * A dial being dragged writes to the preview and stops there.
   *
   * Every one of these panels previews on each pointermove and commits on
   * release. Persisting the moves too put a fragment of the drag in the undo
   * stack — and since those writes race, history could not coalesce them
   * reliably, so undo took back a sliver of the gesture rather than the gesture.
   * The release's own commit is what reaches the file and the undo stack.
   */
  const setAttributeWhileDragging = useCallback(
    (attr: string, value: string | null) =>
      handleDomAttributeLiveCommit(attr, value, undefined, { previewOnly: true }),
    [handleDomAttributeLiveCommit],
  );
  const handleHideAllSelected = () => {
    // Audio has no visual to hide, and `data-hidden` on an audio element is what
    // MUTES it — preview silences it and the render drops it from the mix. The
    // timeline withholds the eye on an audio track for that reason
    // (`visible={!isAudioTrack}`), and the single-selection panel gates the same
    // write on `audioSelection`; this multi-selection path was the way back to
    // it. Checked here as well as in the panel because the button is not the
    // only caller.
    if (!canHideSelections(domEditGroupSelections)) {
      showToast("Audio can't be hidden — use the group's own controls", "info");
      return;
    }
    const { elements } = usePlayerStore.getState();
    const keys = timelineKeysForSelections(domEditGroupSelections, elements, activeCompPath);
    if (keys.length > 0) void onToggleElementHidden?.(keys, true);
  };
  const propertyPanel = (
    <DesignPanelPromoteProvider
      selection={domEditGroupSelections.length > 1 ? null : domEditSelection}
      projectId={projectId}
      activeCompPath={activeCompPath}
      showToast={showToast}
      readProjectFile={readProjectFile}
      writeProjectFile={writeProjectFile}
      recordEdit={recordEdit}
      reloadPreview={reloadPreview}
      forceReloadSharedSdkSession={forceReloadSdkSession}
    >
      <PropertyPanel
        projectId={projectId}
        projectDir={projectDir}
        assets={assets}
        element={domEditGroupSelections.length > 1 ? null : domEditSelection}
        multiSelectCount={domEditGroupSelections.length}
        multiSelectedElements={domEditGroupSelections}
        onGroupSelection={handleGroupSelection}
        onHideAllSelected={handleHideAllSelected}
        copiedAgentPrompt={copiedAgentPrompt}
        onClearSelection={clearDomSelection}
        onToggleElementHidden={onToggleElementHidden}
        onAutoGroupCarveSources={onAutoGroupCarveSources}
        onUngroup={handleUngroupSelection}
        onSetStyle={handleDomStyleCommit}
        onSetAttribute={handleDomAttributeCommit}
        onSetAttributes={handleDomAttributesCommit}
        onSetAttributeLive={setAttributeWhileDragging}
        onSetAttributeQuiet={handleDomAttributeQuietCommit}
        onApplyColorGradingScope={handleApplyColorGradingScope}
        onSetHtmlAttribute={handleDomHtmlAttributeCommit}
        onRemoveBackground={handleRemoveBackground}
        onSetManualOffset={handleDomPathOffsetCommit}
        onSetManualSize={handleDomBoxSizeCommit}
        onSetManualRotation={handleDomRotationCommit}
        onSetText={handleDomTextCommit}
        onSetTextFieldStyle={handleDomTextFieldStyleCommit}
        onAddTextField={handleDomAddTextField}
        onRemoveTextField={handleDomRemoveTextField}
        onAskAgent={handleAskAgent}
        onImportAssets={handleImportFiles}
        onAddMediaOverlay={onAddMediaOverlay}
        fontAssets={fontAssets}
        onImportFonts={handleImportFonts}
        previewIframeRef={previewIframeRef}
        gsapAnimations={selectedGsapAnimations}
        gsapMultipleTimelines={gsapMultipleTimelines}
        gsapUnsupportedTimelinePattern={gsapUnsupportedTimelinePattern}
        onUpdateGsapProperty={handleGsapUpdateProperty}
        onUpdateGsapMeta={handleGsapUpdateMeta}
        onDeleteGsapAnimation={handleGsapDeleteAnimation}
        onAddGsapProperty={handleGsapAddProperty}
        onRemoveGsapProperty={handleGsapRemoveProperty}
        onUpdateGsapFromProperty={handleGsapUpdateFromProperty}
        onAddGsapFromProperty={handleGsapAddFromProperty}
        onRemoveGsapFromProperty={handleGsapRemoveFromProperty}
        onAddGsapAnimation={handleGsapAddAnimation}
        onCommitAnimatedProperty={commitAnimatedProperty}
        onCommitAnimatedProperties={commitAnimatedProperties}
        onAddKeyframe={handleGsapAddKeyframe}
        onRemoveKeyframe={handleGsapRemoveKeyframe}
        onConvertToKeyframes={(animId, duration) =>
          handleGsapConvertToKeyframes(animId, undefined, duration)
        }
        onSeekToTime={(t) => usePlayerStore.getState().requestSeek(t)}
        onSetArcPath={handleSetArcPath}
        onUpdateArcSegment={handleUpdateArcSegment}
        onUnroll={handleUnroll}
        onUpdateKeyframeEase={handleUpdateKeyframeEase}
        onUpdateSegmentEase={handleUpdateSegmentEase}
        onSetAllKeyframeEases={handleSetAllKeyframeEases}
        recordingState={recordingState}
        recordingDuration={recordingDuration}
        onToggleRecording={onToggleRecording}
      />
    </DesignPanelPromoteProvider>
  );

  let designBody = propertyPanel;
  if (captionEditMode) {
    designBody = <CaptionPropertyPanel iframeRef={previewIframeRef} />;
  } else if (activeBlockParams) {
    designBody = (
      <BlockParamsPanel
        blockName={activeBlockParams.blockName}
        blockTitle={activeBlockParams.blockTitle}
        params={activeBlockParams.params}
        compositionPath={activeBlockParams.compositionPath}
        onClose={onCloseBlockParams ?? (() => {})}
      />
    );
  }

  return (
    <>
      <Dock.Panel id="design">{designBody}</Dock.Panel>
      <Dock.Panel id="layers">
        <LayersPanel />
      </Dock.Panel>
      <Dock.Panel
        id="renders"
        title={renderJobs.length > 0 ? `Renders (${renderJobs.length})` : undefined}
      >
        <RenderQueuePanel />
      </Dock.Panel>
      <Dock.Panel id="variables">
        <VariablesPanel
          sdkSession={sdkSession}
          publishSdkSession={publishSdkSession}
          reloadPreview={reloadPreview}
          recordEdit={recordEdit}
        />
      </Dock.Panel>
      <Dock.Panel id="slideshow">
        <SlideshowPanel
          scenes={slideshowScenes}
          onPersist={onPersistSlideshow}
          onPersistNotes={onPersistSlideshowNotes}
        />
      </Dock.Panel>
    </>
  );
}
