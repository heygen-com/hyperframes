import { Plus, ChevronRight, ChevronDown, Folder } from "lucide-react";
import { useState, useMemo } from "react";
import type { ProjectFile } from "../api/files";

interface FileTreeProps {
  files: ProjectFile[];
  activeFile: string | null;
  onFileClick: (filename: string) => void;
  onNewFile: (filename: string) => void;
}

const FILE_COLORS: Record<string, string> = {
  html: "bg-orange-400",
  css: "bg-blue-400",
  javascript: "bg-yellow-400",
  typescript: "bg-blue-500",
  json: "bg-green-400",
  xml: "bg-purple-400",
  plaintext: "bg-neutral-400",
};

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  language?: string;
  children: TreeNode[];
}

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.filename.split("/");
    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path,
          isFolder: !isFile,
          language: isFile ? file.language : undefined,
          children: [],
        };
        currentLevel.push(existing);
      }
      currentLevel = existing.children;
    }
  }

  // Sort: folders first, then files, alphabetically
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      // index.html at root always first
      if (a.path === "index.html") return -1;
      if (b.path === "index.html") return 1;
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }
  sortNodes(root);

  return root;
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  expandedFolders: Set<string>;
  onFileClick: (path: string) => void;
  onToggleFolder: (path: string) => void;
}

function TreeItem({ node, depth, activeFile, expandedFolders, onFileClick, onToggleFolder }: TreeItemProps) {
  const isExpanded = expandedFolders.has(node.path);
  const paddingLeft = 12 + depth * 12;

  if (node.isFolder) {
    return (
      <>
        <button
          onClick={() => onToggleFolder(node.path)}
          className="w-full text-left py-1.5 text-sm flex items-center gap-1.5 text-neutral-500 hover:bg-neutral-100 transition-colors"
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          <Folder className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              expandedFolders={expandedFolders}
              onFileClick={onFileClick}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </>
    );
  }

  return (
    <button
      onClick={() => onFileClick(node.path)}
      className={`w-full text-left py-1.5 text-sm flex items-center gap-2 transition-colors ${
        activeFile === node.path
          ? "bg-blue-50 text-blue-700"
          : "text-neutral-600 hover:bg-neutral-100"
      }`}
      style={{ paddingLeft: paddingLeft + 16 }}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${FILE_COLORS[node.language || ""] || FILE_COLORS.plaintext}`}
      />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree({ files, activeFile, onFileClick, onNewFile }: FileTreeProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(files), [files]);

  function handleCreate() {
    const name = newFileName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    onNewFile(name);
    setNewFileName("");
    setIsCreating(false);
  }

  function handleToggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div className="w-52 flex-shrink-0 border-r border-neutral-200 bg-neutral-50 flex flex-col">
      <div className="px-3 py-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
        Files
      </div>
      <div className="flex-1 overflow-y-auto">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            expandedFolders={expandedFolders}
            onFileClick={onFileClick}
            onToggleFolder={handleToggleFolder}
          />
        ))}
      </div>

      <div className="border-t border-neutral-200 p-2">
        {isCreating ? (
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setIsCreating(false); setNewFileName(""); }
            }}
            onBlur={handleCreate}
            placeholder="path/to/file.ext"
            className="w-full bg-white border border-neutral-300 rounded px-2 py-1 text-sm text-neutral-800 placeholder-neutral-400 outline-none focus:border-blue-500"
          />
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-sm text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New File
          </button>
        )}
      </div>
    </div>
  );
}
