import { X } from "lucide-react";

interface FileTabsProps {
  openFiles: string[];
  activeFile: string | null;
  dirtyFiles: Set<string>;
  onTabClick: (filename: string) => void;
  onTabClose: (filename: string) => void;
}

function getDisplayName(path: string, allPaths: string[]): string {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  // Check if there are duplicate filenames - if so, show parent folder
  const duplicates = allPaths.filter((p) => {
    const n = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
    return n === name;
  });
  if (duplicates.length > 1 && path.includes("/")) {
    const parts = path.split("/");
    return parts.slice(-2).join("/");
  }
  return name;
}

export function FileTabs({ openFiles, activeFile, dirtyFiles, onTabClick, onTabClose }: FileTabsProps) {
  return (
    <div className="flex items-center bg-neutral-100 border-b border-neutral-200 overflow-x-auto">
      {openFiles.map((filename) => (
        <div
          key={filename}
          onClick={() => onTabClick(filename)}
          title={filename}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer border-r border-neutral-200 min-w-0 ${
            activeFile === filename
              ? "bg-white text-neutral-800"
              : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <span className="truncate">{getDisplayName(filename, openFiles)}</span>
          {dirtyFiles.has(filename) && (
            <span className="w-2 h-2 rounded-full bg-neutral-400 flex-shrink-0" />
          )}
          {openFiles.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(filename);
              }}
              className="ml-1 p-0.5 rounded hover:bg-neutral-200 flex-shrink-0 text-neutral-400 hover:text-neutral-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
