import { memo, useState, useCallback } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { CompositionsTab } from "./CompositionsTab";
import { AssetsTab } from "./AssetsTab";

type SidebarTab = "compositions" | "assets";

const STORAGE_KEY = "hf-studio-sidebar-tab";

function getPersistedTab(): SidebarTab {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "assets" ? "assets" : "compositions";
}

interface LeftSidebarProps {
  width?: number;
  projectId: string;
  compositions: string[];
  assets: string[];
  activeComposition: string | null;
  onSelectComposition: (comp: string) => void;
  onImportFiles?: (files: FileList) => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  width = 240,
  projectId,
  compositions,
  assets,
  activeComposition,
  onSelectComposition,
  onImportFiles,
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
      {/* Tabs */}
      <div className="flex border-b border-neutral-800/50 flex-shrink-0">
        <button
          type="button"
          onClick={() => selectTab("compositions")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "compositions"
              ? "text-neutral-200 border-b-2 border-blue-500"
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
              ? "text-neutral-200 border-b-2 border-blue-500"
              : "text-neutral-500 hover:text-neutral-400"
          }`}
        >
          Assets
        </button>
      </div>

      {/* Tab content */}
      {tab === "compositions" ? (
        <CompositionsTab
          projectId={projectId}
          compositions={compositions}
          activeComposition={activeComposition}
          onSelect={onSelectComposition}
        />
      ) : (
        <AssetsTab projectId={projectId} assets={assets} onImport={onImportFiles} />
      )}
    </div>
  );
});
