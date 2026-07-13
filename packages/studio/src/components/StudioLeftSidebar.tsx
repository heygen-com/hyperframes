import { useCallback, type RefObject } from "react";
import { SourceEditor } from "./editor/SourceEditor";
import { LeftSidebar, type LeftSidebarHandle } from "./sidebar/LeftSidebar";
import { MediaPreview } from "./MediaPreview";
import { isMediaFile } from "../utils/mediaTypes";
import { usePanelLayoutContext } from "../contexts/PanelLayoutContext";
import { useStudioShellContext } from "../contexts/StudioContext";
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
  onAddAssetToTimeline?: (path: string) => void;
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
  onAddAssetToTimeline,
}: StudioLeftSidebarProps) {
  const {
    leftCollapsed,
    leftWidth,
    setLeftWidth,
    toggleLeftSidebar,
    handlePanelResizeStart,
    handlePanelResizeMove,
    handlePanelResizeEnd,
  } = usePanelLayoutContext();
  const { projectId, renderQueue, waitForPendingDomEditSaves } = useStudioShellContext();
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
      <div className="mr-0.5 flex w-10 flex-shrink-0 flex-col items-center rounded-lg border border-neutral-800/50 bg-neutral-950 pt-1">
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
        onImportFiles={async (files, dir) => {
          await handleImportFiles(files, dir);
        }}
        codeChildren={
          editingFile ? (
            isMediaFile(editingFile.path) ? (
              <MediaPreview projectId={projectId} filePath={editingFile.path} />
            ) : editingFile.content == null ? (
              // Never mount the editor on unloaded content: a keystroke would
              // autosave an empty document over the real file.
              <div className="flex h-full items-center justify-center text-[11px] text-neutral-600">
                Loading {editingFile.path}…
              </div>
            ) : (
              <SourceEditor
                content={editingFile.content}
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
        onAddAssetToTimeline={onAddAssetToTimeline}
      />
      {/* Vertical resize divider: 3px visible seam, 8px pointer-capture zone via
          the absolutely-positioned inner hit area. The outer element is w-[3px] so
          it contributes only 3px of gap in the flex row; the inner -left-[2.5px]
          element widens the hit area to 8px without affecting layout. */}
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        tabIndex={0}
        className="group relative w-[3px] flex-shrink-0 cursor-col-resize outline-none focus-visible:bg-studio-accent/20"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => handlePanelResizeStart("left", e)}
        onPointerMove={handlePanelResizeMove}
        onPointerUp={handlePanelResizeEnd}
        onPointerCancel={handlePanelResizeEnd}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? -16 : 16;
          const maxLeft = Math.floor(window.innerWidth * 0.5);
          setLeftWidth(Math.max(160, Math.min(maxLeft, leftWidth + delta)));
        }}
      >
        {/* Expanded hit zone: 8px wide, centered on the 3px seam */}
        <div className="absolute inset-y-0 -left-[2.5px] w-2" />
        {/* Visible hairline */}
        <div className="absolute top-1/2 left-0 h-[52px] w-[3px] -translate-y-1/2 bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
    </>
  );
}
