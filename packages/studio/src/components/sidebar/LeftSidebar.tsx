import { memo, useState, useCallback, type ReactNode } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { CompositionsTab } from "./CompositionsTab";
import { AssetsTab } from "./AssetsTab";
import { FileTree } from "../editor/FileTree";

type SidebarTab = "compositions" | "assets" | "code";

const STORAGE_KEY = "hf-studio-sidebar-tab";

function getPersistedTab(): SidebarTab {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "assets") return "assets";
  if (stored === "code") return "code";
  return "compositions";
}

interface LeftSidebarProps {
  width?: number;
  projectId: string;
  compositions: string[];
  assets: string[];
  activeComposition: string | null;
  onSelectComposition: (comp: string) => void;
  onImportFiles?: (files: FileList, dir?: string) => void;
  fileTree?: string[];
  editingFile?: { path: string; content: string | null } | null;
  onSelectFile?: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDuplicateFile?: (path: string) => void;
  onMoveFile?: (oldPath: string, newPath: string) => void;
  codeChildren?: ReactNode;
  onLint?: () => void;
  linting?: boolean;
  onToggleCollapse?: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  width = 240,
  projectId,
  compositions,
  assets,
  activeComposition,
  onSelectComposition,
  onImportFiles,
  fileTree: fileProp,
  editingFile,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onMoveFile,
  codeChildren,
  onLint,
  linting,
  onToggleCollapse,
}: LeftSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>(getPersistedTab);

  const selectTab = useCallback((t: SidebarTab) => {
    setTab(t);
    localStorage.setItem(STORAGE_KEY, t);
  }, []);

  // Keyboard shortcuts: Cmd+1 for Compositions, Cmd+2 for Assets
  useMountEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "1") {
        e.preventDefault();
        selectTab("compositions");
      }
      if (e.key === "2") {
        e.preventDefault();
        selectTab("assets");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div
      className="flex flex-col h-full bg-neutral-950 border-r border-neutral-800/50"
      style={{ width }}
    >
      {/* Tabs — Code first */}
      <div className="flex border-b border-neutral-800/50 flex-shrink-0">
        <button
          type="button"
          onClick={() => selectTab("code")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "code"
              ? "text-neutral-200 border-b-2 border-studio-accent"
              : "text-neutral-500 hover:text-neutral-400"
          }`}
        >
          Code
        </button>
        <button
          type="button"
          onClick={() => selectTab("compositions")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "compositions"
              ? "text-neutral-200 border-b-2 border-studio-accent"
              : "text-neutral-500 hover:text-neutral-400"
          }`}
        >
          Compositions
        </button>
        <button
          type="button"
          onClick={() => selectTab("assets")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "assets"
              ? "text-neutral-200 border-b-2 border-studio-accent"
              : "text-neutral-500 hover:text-neutral-400"
          }`}
        >
          Assets
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mx-1 my-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-300"
            title="Hide sidebar"
            aria-label="Hide sidebar"
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
              <path d="m14 7-5 5 5 5" />
              <path d="M19 4v16" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === "compositions" && (
        <CompositionsTab
          projectId={projectId}
          compositions={compositions}
          activeComposition={activeComposition}
          onSelect={onSelectComposition}
        />
      )}
      {tab === "assets" && (
        <AssetsTab
          projectId={projectId}
          assets={assets}
          onImport={onImportFiles}
          onDelete={onDeleteFile}
          onRename={onRenameFile}
        />
      )}
      {tab === "code" && (
        <div className="flex flex-1 min-h-0">
          {(fileProp?.length ?? 0) > 0 && (
            <div className="w-[160px] flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
              <FileTree
                files={fileProp ?? []}
                activeFile={editingFile?.path ?? null}
                onSelectFile={onSelectFile ?? (() => {})}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onDuplicateFile={onDuplicateFile}
                onMoveFile={onMoveFile}
                onImportFiles={onImportFiles}
              />
            </div>
          )}
          <div className="flex-1 overflow-hidden min-w-0">
            {codeChildren ?? (
              <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lint button pinned at the bottom */}
      {onLint && (
        <div className="border-t border-neutral-800 p-2 flex-shrink-0">
          <button
            onClick={onLint}
            disabled={linting}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium text-neutral-500 hover:text-amber-300 hover:bg-neutral-800 transition-colors disabled:opacity-40"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            {linting ? "Linting…" : "Lint"}
          </button>
        </div>
      )}
    </div>
  );
});
