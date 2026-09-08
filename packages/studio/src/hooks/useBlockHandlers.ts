/**
 * Block drop/add handlers for the Studio.
 * Extracted from App.tsx to keep file sizes under the 600-line limit.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { addBlockToProject } from "../utils/blockInstaller";
import type { BlockParam } from "@hyperframes/core/registry";
import type { EditHistoryKind } from "../utils/editHistory";
import type { RightPanelTab } from "../utils/studioHelpers";
import type { MediaOverlayPlacement } from "../components/editor/propertyPanelTypes";

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
  handleTimelineBlockDrop: (blockName: string, placement: { start: number; track: number }) => void;
  handleAddMediaOverlay: (blockName: string, placement: MediaOverlayPlacement) => Promise<void>;
  handlePreviewBlockDrop: (blockName: string, position: { left: number; top: number }) => void;
}

/**
 * Run `install`, and lower `latch` however it ends.
 *
 * Module scope rather than in the hook that owns the latch: the React Compiler
 * cannot reorder across a `finally`, so a `try`/`finally` anywhere inside a hook
 * makes it decline the whole hook and silently drop every memo in it.
 */
async function runAndRelease<T>(
  latch: React.RefObject<boolean>,
  install: () => Promise<T>,
): Promise<T> {
  try {
    return await install();
  } finally {
    latch.current = false;
  }
}

export function useBlockHandlers({
  projectId,
  blockCtxDeps,
  previewIframeRef,
  setRightCollapsed,
  setRightPanelTab,
}: UseBlockHandlersParams): UseBlockHandlersResult {
  const [activeBlockParams, setActiveBlockParams] =
    useState<UseBlockHandlersResult["activeBlockParams"]>(null);

  // The caller rebuilds `blockCtxDeps` every render, so this repacks it into an
  // object keyed on the eight fields that actually matter. Destructured first so
  // the dependency list is eight plain names: a list of member expressions had to
  // be suppressed to stand, and a suppression is a bail-out the React Compiler
  // counts, which cost this hook its memoization anyway.
  const {
    activeCompPath,
    timelineElements,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    refreshFileTree,
    reloadPreview,
    showToast,
  } = blockCtxDeps;

  const blockCtx = useMemo(
    () => ({
      activeCompPath,
      timelineElements,
      readProjectFile,
      writeProjectFile,
      recordEdit,
      refreshFileTree,
      reloadPreview,
      showToast,
    }),
    [
      activeCompPath,
      timelineElements,
      readProjectFile,
      writeProjectFile,
      recordEdit,
      refreshFileTree,
      reloadPreview,
      showToast,
    ],
  );

  // Block installs hit the server and end in a full preview reload; without a
  // guard, repeat drops while one is in flight stack duplicate installs.
  const installingBlockRef = useRef(false);
  const runBlockInstall = useCallback(
    async <T>(blockName: string, install: () => Promise<T>): Promise<T | null> => {
      if (installingBlockRef.current) {
        blockCtx.showToast("A block is already installing — one moment…", "info");
        return null;
      }
      installingBlockRef.current = true;
      blockCtx.showToast(`Adding ${blockName}…`, "info");
      // Every caller drops this promise: three do `void runBlockInstall(...)` and
      // the fourth is awaited from an unawaited JSX handler. A rejection there is
      // an unhandled rejection, and the user is left with the "Adding…" toast and
      // no second one. Report it on the surface the install itself reports on and
      // resolve to null, which every caller already reads as "nothing installed".
      return await runAndRelease(installingBlockRef, install).catch((error: unknown) => {
        blockCtx.showToast(error instanceof Error ? error.message : `Failed to add ${blockName}`);
        return null;
      });
    },
    [blockCtx],
  );

  const handleAddBlock = useCallback(
    (blockName: string) => {
      if (!projectId) return;
      // fallow-ignore-next-line complexity
      void (async () => {
        const result = await runBlockInstall(blockName, () =>
          addBlockToProject({
            projectId,
            blockName,
            ...blockCtx,
            previewIframe: previewIframeRef.current,
            currentTime: usePlayerStore.getState().currentTime,
          }),
        );
        if (result === null) return;
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
    [projectId, blockCtx, previewIframeRef, runBlockInstall, setRightCollapsed, setRightPanelTab],
  );

  const handleTimelineBlockDrop = useCallback(
    (blockName: string, placement: { start: number; track: number }) => {
      if (!projectId) return;
      void runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          placement,
          ...blockCtx,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      );
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall],
  );

  const handleAddMediaOverlay = useCallback(
    async (blockName: string, placement: MediaOverlayPlacement) => {
      if (!projectId) return;
      const { compositionPath, ...timelinePlacement } = placement;
      await runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          ...blockCtx,
          activeCompPath: compositionPath ?? blockCtx.activeCompPath,
          placement: timelinePlacement,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      );
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall],
  );

  const handlePreviewBlockDrop = useCallback(
    (blockName: string, position: { left: number; top: number }) => {
      if (!projectId) return;
      void runBlockInstall(blockName, () =>
        addBlockToProject({
          projectId,
          blockName,
          visualPosition: position,
          ...blockCtx,
          previewIframe: previewIframeRef.current,
          currentTime: usePlayerStore.getState().currentTime,
        }),
      );
    },
    [projectId, blockCtx, previewIframeRef, runBlockInstall],
  );

  return {
    activeBlockParams,
    setActiveBlockParams,
    handleAddBlock,
    handleTimelineBlockDrop,
    handleAddMediaOverlay,
    handlePreviewBlockDrop,
  };
}
