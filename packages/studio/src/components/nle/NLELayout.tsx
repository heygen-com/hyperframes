import { useCallback, memo } from "react";
import { PreviewPane, type PreviewPaneProps } from "./PreviewPane";
import { TimelinePane, type TimelinePaneProps } from "./TimelinePane";
import { NLEProvider, useNLEContext, type NLEProviderProps } from "./NLEContext";

// The layout hosts both panes, so its view props are just the union of theirs
// (they share onSelectTimelineElement with an identical signature).
type NLELayoutViewProps = PreviewPaneProps & TimelinePaneProps;

type NLELayoutProps = NLELayoutViewProps &
  Pick<
    NLEProviderProps,
    | "projectId"
    | "refreshKey"
    | "activeCompositionPath"
    | "onIframeRef"
    | "onCompositionChange"
    | "onCompIdToSrcChange"
    | "onCompositionLoadingChange"
  >;

export function NLELayout({
  projectId,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
  onCompositionChange,
  onCompIdToSrcChange,
  onCompositionLoadingChange,
  ...viewProps
}: NLELayoutProps) {
  return (
    <NLEProvider
      projectId={projectId}
      refreshKey={refreshKey}
      activeCompositionPath={activeCompositionPath}
      onIframeRef={onIframeRef}
      onCompositionChange={onCompositionChange}
      onCompIdToSrcChange={onCompIdToSrcChange}
      onCompositionLoadingChange={onCompositionLoadingChange}
    >
      <NLELayoutInner {...viewProps} />
    </NLEProvider>
  );
}

const NLELayoutInner = memo(function NLELayoutInner({
  portrait,
  previewOverlay,
  timelineToolbar,
  timelineFooter,
  renderClipContent,
  onFileDrop,
  onDeleteElement,
  onAssetDrop,
  onBlockDrop,
  onPreviewBlockDrop,
  onBlockedEditAttempt,
  onSelectTimelineElement,
}: NLELayoutViewProps) {
  const { compositionStack, updateCompositionStack, containerRef } = useNLEContext();

  // Keyboard: Escape to pop composition level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && compositionStack.length > 1) {
        updateCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    [compositionStack.length, updateCompositionStack],
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full min-h-0 bg-neutral-950"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <PreviewPane
        portrait={portrait}
        previewOverlay={previewOverlay}
        onSelectTimelineElement={onSelectTimelineElement}
        onPreviewBlockDrop={onPreviewBlockDrop}
      />
      <TimelinePane
        timelineToolbar={timelineToolbar}
        timelineFooter={timelineFooter}
        renderClipContent={renderClipContent}
        onFileDrop={onFileDrop}
        onDeleteElement={onDeleteElement}
        onAssetDrop={onAssetDrop}
        onBlockDrop={onBlockDrop}
        onBlockedEditAttempt={onBlockedEditAttempt}
        onSelectTimelineElement={onSelectTimelineElement}
      />
    </div>
  );
});
