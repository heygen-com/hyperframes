import {
  memo,
  useState,
  useCallback,
  useImperativeHandle,
  useRef,
  forwardRef,
  type ReactNode,
} from "react";
import { CompositionsTab } from "./CompositionsTab";
import { AssetsTab } from "./AssetsTab";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { BlocksTab, type BlockPreviewInfo } from "./BlocksTab";
import { FileTree } from "../editor/FileTree";
import { STUDIO_BLOCKS_PANEL_ENABLED } from "../editor/manualEditingAvailability";
import { Tooltip } from "../ui";

export type SidebarTab = "compositions" | "assets" | "code" | "blocks";

export interface LeftSidebarHandle {
  selectTab: (tab: SidebarTab) => void;
  getTab: () => SidebarTab;
}

const STORAGE_KEY = "hf-studio-sidebar-tab";

function getPersistedTab(): SidebarTab {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "assets") return "assets";
  if (stored === "code") return "code";
  if (stored === "blocks") return "blocks";
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
  onRenderComposition?: (comp: string) => void;
  isRendering?: boolean;
  onLint?: () => void;
  linting?: boolean;
  lintFindingCount?: number;
  lintFindingsByFile?: Map<string, { count: number; messages: string[] }>;
  onToggleCollapse?: () => void;
  onAddBlock?: (blockName: string) => void;
  onPreviewBlock?: (preview: BlockPreviewInfo | null) => void;
  takeoverContent?: ReactNode;
  onAddAssetToTimeline?: (path: string) => void;
}

export const LeftSidebar = memo(
  forwardRef<LeftSidebarHandle, LeftSidebarProps>(function LeftSidebar(
    {
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
      onRenderComposition,
      isRendering,
      onLint,
      linting,
      lintFindingCount,
      lintFindingsByFile,
      onToggleCollapse,
      onAddBlock,
      onPreviewBlock,
      takeoverContent,
      onAddAssetToTimeline,
    },
    ref,
  ) {
    const [tab, setTab] = useState<SidebarTab>(getPersistedTab);
    const tabRef = useRef(tab);
    tabRef.current = tab;

    const selectTab = useCallback((t: SidebarTab) => {
      setTab(t);
      localStorage.setItem(STORAGE_KEY, t);
      trackStudioEvent("tab_switch", { panel: "left_sidebar", tab: t });
    }, []);

    const getTab = useCallback(() => tabRef.current, []);

    useImperativeHandle(ref, () => ({ selectTab, getTab }), [selectTab, getTab]);

    return (
      <div
        className="flex flex-col h-full overflow-hidden rounded-lg border border-neutral-800/50 bg-neutral-950"
        style={{ width }}
      >
        {takeoverContent ? (
          <div className="flex min-h-0 flex-1">{takeoverContent}</div>
        ) : (
          <>
            {/* Tabs — Code first */}
            <div className="border-b border-neutral-800/50 px-3 py-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div
                  className="grid min-w-0 flex-1 gap-0.5 rounded-[18px] bg-neutral-900 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  style={{
                    gridTemplateColumns: STUDIO_BLOCKS_PANEL_ENABLED
                      ? "1fr 1fr 1fr 1fr"
                      : "1fr 1fr 1fr",
                  }}
                >
                  <Tooltip label="Source code editor" side="bottom">
                    <button
                      type="button"
                      onClick={() => selectTab("code")}
                      className={`rounded-[14px] px-1.5 py-2 text-[10px] font-semibold truncate transition-all ${
                        tab === "code"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:text-neutral-200"
                      }`}
                    >
                      Code
                    </button>
                  </Tooltip>
                  <Tooltip label="Compositions and sub-compositions" side="bottom">
                    <button
                      type="button"
                      onClick={() => selectTab("compositions")}
                      className={`rounded-[14px] px-1.5 py-2 text-[10px] font-semibold truncate transition-all ${
                        tab === "compositions"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:text-neutral-200"
                      }`}
                    >
                      Comps
                    </button>
                  </Tooltip>
                  <Tooltip label="Videos, images, audio, fonts" side="bottom">
                    <button
                      type="button"
                      onClick={() => selectTab("assets")}
                      className={`rounded-[14px] px-1.5 py-2 text-[10px] font-semibold truncate transition-all ${
                        tab === "assets"
                          ? "bg-neutral-800 text-white"
                          : "text-neutral-500 hover:text-neutral-200"
                      }`}
                    >
                      Assets
                    </button>
                  </Tooltip>
                  {STUDIO_BLOCKS_PANEL_ENABLED && (
                    <Tooltip label="Browse blocks and components" side="bottom">
                      <button
                        type="button"
                        onClick={() => selectTab("blocks")}
                        className={`rounded-[14px] px-1.5 py-2 text-[10px] font-semibold truncate transition-all ${
                          tab === "blocks"
                            ? "bg-neutral-800 text-white"
                            : "text-neutral-500 hover:text-neutral-200"
                        }`}
                      >
                        Catalog
                      </button>
                    </Tooltip>
                  )}
                </div>
                {onToggleCollapse && (
                  <button
                    type="button"
                    onClick={onToggleCollapse}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-transparent text-neutral-500 transition-colors hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-300"
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
            </div>

            {/* Tab content */}
            {tab === "compositions" && (
              <CompositionsTab
                projectId={projectId}
                compositions={compositions}
                activeComposition={activeComposition}
                onSelect={onSelectComposition}
                onRenderComposition={onRenderComposition}
                isRendering={isRendering}
                lintFindingsByFile={lintFindingsByFile}
              />
            )}
            {tab === "assets" && (
              <AssetsTab
                projectId={projectId}
                assets={assets}
                onImport={onImportFiles}
                onDelete={onDeleteFile}
                onRename={onRenameFile}
                onAddAssetToTimeline={onAddAssetToTimeline}
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
                      lintFindingsByFile={lintFindingsByFile}
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

            {STUDIO_BLOCKS_PANEL_ENABLED && tab === "blocks" && (
              <BlocksTab onAddBlock={onAddBlock} onPreviewBlock={onPreviewBlock} />
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
                  {!linting && lintFindingCount != null && lintFindingCount > 0 && (
                    <span className="ml-1 min-w-[16px] rounded-full bg-amber-500/20 px-1 text-[9px] font-bold text-amber-400">
                      {lintFindingCount}
                    </span>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }),
);
