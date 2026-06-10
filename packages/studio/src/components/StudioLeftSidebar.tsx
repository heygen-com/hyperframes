import { useCallback, type RefObject } from "react";
import { SourceEditor } from "./editor/SourceEditor";
import { LeftSidebar, type LeftSidebarHandle } from "./sidebar/LeftSidebar";
import { MediaPreview } from "./MediaPreview";
import { isMediaFile } from "../utils/mediaTypes";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useStudioContext } from "../contexts/StudioContext";
import { useFileManagerContext } from "../contexts/FileManagerContext";
import { getPersistedRenderSettings } from "./renders/renderSettings";
import type { BlockPreviewInfo } from "./sidebar/BlocksTab";

export interface StudioLeftSidebarProps {
  leftSidebarRef: RefObject<LeftSidebarHandle | null>;
  onSelectComposition: (comp: string) => void;
  onAddBlock: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
  onLint: () => void;
  linting: boolean;
  lintFindingCount?: number;
  lintFindingsByFile?: Map<string, { count: number; messages: string[] }>;
}

// fallow-ignore-next-line complexity
export function StudioLeftSidebar({
  leftSidebarRef,
  onSelectComposition,
  onAddBlock,
  onPreviewBlock,
  onLint,
  linting,
  lintFindingCount,
  lintFindingsByFile,
}: StudioLeftSidebarProps) {
  const {
    leftCollapsed,
    leftWidth,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  } = usePanelLayoutContext();
  const { projectId, renderQueue, waitForPendingDomEditSaves } = useStudioContext();
  const {
    compositions,
    assets,
    editingFile,
    fileTree,
    revealSourceOffset,
    handleFileSelect,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFile,
    handleRenameFile,
    handleDuplicateFile,
    handleMoveFile,
    handleImportFiles,
    handleContentChange,
  } = useFileManagerContext();

  const handleRenderComposition = useCallback(
    async (comp: string) => {
      await waitForPendingDomEditSaves();
      const { format, quality, fps } = getPersistedRenderSettings();
      await renderQueue.startRender({ composition: comp, format, quality, fps });
    },
    [renderQueue, waitForPendingDomEditSaves],
  );

  if (leftCollapsed) {
    return (
      <div className="flex w-10 flex-shrink-0 flex-col items-center border-r border-neutral-800/50 bg-neutral-950 pt-1">
        <button
          type="button"
          onClick={toggleLeftSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-300"
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 4v16" />
            <path d="m10 7 5 5-5 5" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <LeftSidebar
        ref={leftSidebarRef}
        width={leftWidth}
        projectId={projectId}
        compositions={compositions}
        assets={assets}
        activeComposition={editingFile?.path ?? null}
        onSelectComposition={onSelectComposition}
        fileTree={fileTree}
        editingFile={editingFile}
        onSelectFile={handleFileSelect}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onDeleteFile={handleDeleteFile}
        onRenameFile={handleRenameFile}
        onDuplicateFile={handleDuplicateFile}
        onMoveFile={handleMoveFile}
        onImportFiles={handleImportFiles}
        codeChildren={
          editingFile ? (
            isMediaFile(editingFile.path) ? (
              <MediaPreview projectId={projectId} filePath={editingFile.path} />
            ) : (
              <SourceEditor
                content={editingFile.content ?? ""}
                filePath={editingFile.path}
                onChange={handleContentChange}
                revealOffset={revealSourceOffset}
              />
            )
          ) : undefined
        }
        onRenderComposition={handleRenderComposition}
        isRendering={renderQueue.isRendering}
        onLint={onLint}
        linting={linting}
        lintFindingCount={lintFindingCount}
        lintFindingsByFile={lintFindingsByFile}
        onToggleCollapse={toggleLeftSidebar}
        onAddBlock={onAddBlock}
        onPreviewBlock={onPreviewBlock}
      />
      <div
        className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => handlePanelResizeStart("left", e)}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
      >
        <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
    </>
  );
}
