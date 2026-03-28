import { memo, useState, useCallback } from "react";
import {
  FileCode,
  Image,
  Film,
  Music,
  File,
  ChevronDown,
  ChevronRight,
} from "../../icons/SystemIcons";

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
  md: { icon: File, color: "#737373" },
  png: { icon: Image, color: "#22C55E" },
  jpg: { icon: Image, color: "#22C55E" },
  jpeg: { icon: Image, color: "#22C55E" },
  webp: { icon: Image, color: "#22C55E" },
  gif: { icon: Image, color: "#22C55E" },
  svg: { icon: Image, color: "#F97316" },
  mp4: { icon: Film, color: "#A855F7" },
  webm: { icon: Film, color: "#A855F7" },
  mov: { icon: Film, color: "#A855F7" },
  mp3: { icon: Music, color: "#F59E0B" },
  wav: { icon: Music, color: "#F59E0B" },
  ogg: { icon: Music, color: "#F59E0B" },
  m4a: { icon: Music, color: "#F59E0B" },
  woff: { icon: File, color: "#525252" },
  woff2: { icon: File, color: "#525252" },
  ttf: { icon: File, color: "#525252" },
};

function getFileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? { icon: File, color: "#737373" };
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), isFile: false };
  for (const file of files) {
    const parts = file.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          isFile: isLast,
        });
      }
      current = current.children.get(part)!;
      if (isLast) current.isFile = true;
    }
  }
  return root;
}

function sortChildren(children: Map<string, TreeNode>): TreeNode[] {
  return Array.from(children.values()).sort((a, b) => {
    // index.html always first
    if (a.name === "index.html") return -1;
    if (b.name === "index.html") return 1;
    // Directories before files
    if (!a.isFile && b.isFile) return -1;
    if (a.isFile && !b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeFolder({
  node,
  depth,
  activeFile,
  onSelectFile,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const children = sortChildren(node.children);
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 min-h-7 text-left text-xs text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-300 transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <Chevron size={10} className="flex-shrink-0 text-neutral-600" />
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {isOpen &&
        children.map((child) =>
          child.isFile && child.children.size === 0 ? (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ) : child.children.size > 0 ? (
            <TreeFolder
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              defaultOpen={isActiveInSubtree(child, activeFile)}
            />
          ) : (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ),
        )}
    </>
  );
}

function TreeFile({
  node,
  depth,
  activeFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  const { icon: Icon, color } = getFileIcon(node.name);
  const isActive = node.fullPath === activeFile;

  return (
    <button
      onClick={() => onSelectFile(node.fullPath)}
      className={`w-full flex items-center gap-2 py-1 min-h-7 text-left transition-all text-xs ${
        isActive
          ? "bg-neutral-800/60 text-neutral-200"
          : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300"
      }`}
      style={{ paddingLeft: `${8 + depth * 12 + 14}px` }}
    >
      <Icon size={12} style={{ color }} className="flex-shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function isActiveInSubtree(node: TreeNode, activeFile: string | null): boolean {
  if (!activeFile) return false;
  if (node.fullPath === activeFile) return true;
  for (const child of node.children.values()) {
    if (isActiveInSubtree(child, activeFile)) return true;
  }
  return false;
}

export const FileTree = memo(function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const tree = buildTree(files);
  const children = sortChildren(tree.children);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-1.5 border-b border-neutral-800 flex-shrink-0">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-caps">Files</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {children.map((child) =>
          child.isFile && child.children.size === 0 ? (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ) : (
            <TreeFolder
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              defaultOpen={isActiveInSubtree(child, activeFile)}
            />
          ),
        )}
      </div>
    </div>
  );
});
