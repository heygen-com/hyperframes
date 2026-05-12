import type { RefObject } from "react";
import { SourceEditor } from "./editor/SourceEditor";
import { LeftSidebar, type LeftSidebarHandle } from "./sidebar/LeftSidebar";
import { MediaPreview } from "./MediaPreview";
import { isMediaFile } from "../utils/mediaTypes";
import type { EditingFile } from "../utils/studioHelpers";

export interface StudioLeftSidebarProps {
  collapsed: boolean;
  leftSidebarRef: RefObject<LeftSidebarHandle | null>;
  width: number;
  projectId: string;
  compositions: string[];
  assets: string[];
  editingFile: EditingFile | null;
  fileTree: string[];
  onSelectComposition: (comp: string) => void;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDuplicateFile: (path: string) => void;
  onMoveFile: (oldPath: string, newPath: string) => void;
  onImportFiles: (files: FileList, dir?: string) => void;
  onContentChange: (content: string) => void;
  onLint: () => void;
  linting: boolean;
  onToggleCollapse: () => void;
}

export function StudioLeftSidebar({
  collapsed,
  leftSidebarRef,
  width,
  projectId,
  compositions,
  assets,
  editingFile,
  fileTree,
  onSelectComposition,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onMoveFile,
  onImportFiles,
  onContentChange,
  onLint,
  linting,
  onToggleCollapse,
}: StudioLeftSidebarProps) {
  if (collapsed) {
    return (
      <div className="flex w-10 flex-shrink-0 flex-col items-center border-r border-neutral-800/50 bg-neutral-950 pt-1">
        <button
          type="button"
          onClick={onToggleCollapse}
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
    <LeftSidebar
      ref={leftSidebarRef}
      width={width}
      projectId={projectId}
      compositions={compositions}
      assets={assets}
      activeComposition={editingFile?.path ?? null}
      onSelectComposition={onSelectComposition}
      fileTree={fileTree}
      editingFile={editingFile}
      onSelectFile={onSelectFile}
      onCreateFile={onCreateFile}
      onCreateFolder={onCreateFolder}
      onDeleteFile={onDeleteFile}
      onRenameFile={onRenameFile}
      onDuplicateFile={onDuplicateFile}
      onMoveFile={onMoveFile}
      onImportFiles={onImportFiles}
      codeChildren={
        editingFile ? (
          isMediaFile(editingFile.path) ? (
            <MediaPreview projectId={projectId} filePath={editingFile.path} />
          ) : (
            <SourceEditor
              content={editingFile.content ?? ""}
              filePath={editingFile.path}
              onChange={onContentChange}
            />
          )
        ) : undefined
      }
      onLint={onLint}
      linting={linting}
      onToggleCollapse={onToggleCollapse}
    />
  );
}
