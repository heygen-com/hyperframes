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
  onAddCompositionToTimeline?: (path: string) => void;
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
  onAddCompositionToTimeline,
}: StudioLeftSidebarProps) {
  const {
    effectiveLeftCollapsed,
    leftWidth,
    adjustPanelWidth,
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

  if (effectiveLeftCollapsed) {
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
        onAddCompositionToTimeline={onAddCompositionToTimeline}
      />
      {/* Vertical resize divider: 3px visible seam, 13px pointer-capture zone via
          the absolutely-positioned inner hit area. The outer element is w-[3px] so
          it contributes only 3px of gap in the flex row; the inner -left-[2px]
          element widens the hit area without affecting layout. */}
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
          adjustPanelWidth("left", delta);
        }}
      >
        {/* Expanded hit zone, deliberately asymmetric: 2px into the sidebar card,
            the 3px seam, then 8px into the preview pane's p-2 stage gutter — the
            only dead space adjacent to this seam. It stops at 13px rather than the
            24px WCAG 2.2 (2.5.8) target because the next pixel on either side is
            live: the sidebar's scrolling tab content on the left, the preview
            stage on the right. Silently stealing their clicks is the worse bug. */}
        <div className="absolute inset-y-0 -left-[2px] w-[13px]" />
        {/* Visible hairline */}
        <div className="absolute top-1/2 left-0 h-[52px] w-[3px] -translate-y-1/2 bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
      </div>
    </>
  );
}
