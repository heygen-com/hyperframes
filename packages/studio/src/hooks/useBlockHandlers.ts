/**
 * Block drop/add handlers for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useCallback, useMemo, useState } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { addBlockToProject } from "../utils/blockInstaller";
import type { BlockParam } from "@hyperframes/core/registry";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";

interface BlockCtxDeps {
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  reloadPreview: () => void;
  showToast: (message: string, tone?: "error" | "info") => void;
}

interface UseBlockHandlersParams {
  projectId: string | null;
  blockCtxDeps: BlockCtxDeps;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  setRightCollapsed: (collapsed: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
}

export interface UseBlockHandlersResult {
  activeBlockParams: {
    blockName: string;
    blockTitle: string;
    params: BlockParam[];
    compositionPath: string;
  } | null;
  setActiveBlockParams: React.Dispatch<
    React.SetStateAction<UseBlockHandlersResult["activeBlockParams"]>
  >;
  handleAddBlock: (blockName: string) => void;
  handleTimelineBlockDrop: (
    blockName: string,
    placement: { start: number; track: number },
  ) => void;
  handlePreviewBlockDrop: (
    blockName: string,
    position: { left: number; top: number },
  ) => void;
}

export function useBlockHandlers({
  projectId,
  blockCtxDeps,
  previewIframeRef,
  setRightCollapsed,
  setRightPanelTab,
}: UseBlockHandlersParams): UseBlockHandlersResult {
  const [activeBlockParams, setActiveBlockParams] = useState<
    UseBlockHandlersResult["activeBlockParams"]
  >(null);

  const blockCtx = useMemo(
    () => ({
      activeCompPath: blockCtxDeps.activeCompPath,
      timelineElements: blockCtxDeps.timelineElements,
      readProjectFile: blockCtxDeps.readProjectFile,
      writeProjectFile: blockCtxDeps.writeProjectFile,
      recordEdit: blockCtxDeps.recordEdit,
      refreshFileTree: blockCtxDeps.refreshFileTree,
      reloadPreview: blockCtxDeps.reloadPreview,
      showToast: blockCtxDeps.showToast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      blockCtxDeps.activeCompPath,
      blockCtxDeps.timelineElements,
      blockCtxDeps.readProjectFile,
      blockCtxDeps.writeProjectFile,
      blockCtxDeps.recordEdit,
      blockCtxDeps.refreshFileTree,
      blockCtxDeps.reloadPreview,
      blockCtxDeps.showToast,
    ],
  );

  const handleAddBlock = useCallback(
    (blockName: string) => {
      if (!projectId) return;
      void (async () => {
        const result = await addBlockToProject({
          projectId,
          blockName,
          ...blockCtx,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        });
        const params = result?.block.type === "hyperframes:block" ? result.block.params : undefined;
        if (params?.length) {
          setActiveBlockParams({
            blockName: result!.block.name,
            blockTitle: result!.block.title,
            params,
            compositionPath: result!.compositionPath,
          });
          setRightCollapsed(false);
          setRightPanelTab("block-params");
        }
      })();
    },
    [projectId, blockCtx, previewIframeRef, setRightCollapsed, setRightPanelTab],
  );

  const handleTimelineBlockDrop = useCallback(
    (blockName: string, placement: { start: number; track: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        placement,
        ...blockCtx,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
      });
    },
    [projectId, blockCtx, previewIframeRef],
  );

  const handlePreviewBlockDrop = useCallback(
    (blockName: string, position: { left: number; top: number }) => {
      if (!projectId) return;
      void addBlockToProject({
        projectId,
        blockName,
        visualPosition: position,
        ...blockCtx,
        previewIframe: previewIframeRef.current,
        currentTime: usePlayerStore.getState().currentTime,
      });
    },
    [projectId, blockCtx, previewIframeRef],
  );

  return {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
    handlePreviewBlockDrop,
  };
}
