import { memo } from "react";
import { FileCode, Image, Film, Music, File } from "../../icons/SystemIcons";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

const FILE_ICONS: Record<string, { icon: typeof File; color: string }> = {
  html: { icon: FileCode, color: "#3B82F6" },
  css: { icon: FileCode, color: "#A855F7" },
  js: { icon: FileCode, color: "#F59E0B" },
  ts: { icon: FileCode, color: "#3B82F6" },
  json: { icon: File, color: "#22C55E" },
  png: { icon: Image, color: "#22C55E" },
  jpg: { icon: Image, color: "#22C55E" },
  svg: { icon: Image, color: "#F97316" },
  mp4: { icon: Film, color: "#A855F7" },
  mp3: { icon: Music, color: "#F59E0B" },
  wav: { icon: Music, color: "#F59E0B" },
};

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? { icon: File, color: "#737373" };
}

export const FileTree = memo(function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const sorted = [...files].sort((a, b) => {
    // index.html first, then alphabetical
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-1.5 border-b border-neutral-800 flex-shrink-0">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-caps">Files</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sorted.map((path) => {
          const { icon: Icon, color } = getFileIcon(path);
          const isActive = path === activeFile;
          const name = path.split("/").pop() ?? path;
          const dir = path.includes("/") ? path.split("/").slice(0, -1).join("/") + "/" : "";

          return (
            <button
              key={path}
              onClick={() => onSelectFile(path)}
              className={`w-full flex items-center gap-2 px-2.5 py-1 min-h-7 text-left transition-all duration-press text-xs ${
                isActive
                  ? "bg-neutral-800/60 text-neutral-200"
                  : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300 active:scale-[0.98]"
              }`}
            >
              <Icon size={12} style={{ color }} className="flex-shrink-0" />
              <span className="truncate">
                {dir && <span className="text-neutral-600">{dir}</span>}
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
