import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  FileHtml,
  FileCss,
  FileJs,
  FileJsx,
  FileTs,
  FileTsx,
  FileTxt,
  FileMd,
  FileSvg,
  FilePng,
  FileJpg,
  FileVideo,
  FileCode,
  File,
  Waveform,
  TextAa,
  Image as PhImage,
  PencilSimple,
  Copy,
  Trash,
  Plus,
  FolderSimplePlus,
  FilePlus,
  FolderSimple,
} from "@phosphor-icons/react";
import { ChevronDown, ChevronRight } from "../../icons/SystemIcons";

// ── Types ──

export interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDuplicateFile?: (path: string) => void;
  onMoveFile?: (oldPath: string, newPath: string) => void;
  onImportFiles?: (files: FileList, dir?: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetIsFolder: boolean;
}

interface InlineInputState {
  /** Parent folder path (empty string for root) */
  parentPath: string;
  /** "file" or "folder" creation, or "rename" */
  mode: "new-file" | "new-folder" | "rename";
  /** For rename mode, the original full path */
  originalPath?: string;
  /** For rename mode, the original name */
  originalName?: string;
  onCommit?: (name: string) => void;
  onCancel?: () => void;
}

// ── Constants ──

const SZ = 14;
const W = "duotone" as const;

// ── FileIcon ──

function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const c = "flex-shrink-0";
  if (ext === "html") return <FileHtml size={SZ} weight={W} color="#E44D26" className={c} />;
  if (ext === "css") return <FileCss size={SZ} weight={W} color="#264DE4" className={c} />;
  if (ext === "js" || ext === "mjs" || ext === "cjs")
    return <FileJs size={SZ} weight={W} color="#F0DB4F" className={c} />;
  if (ext === "jsx") return <FileJsx size={SZ} weight={W} color="#61DAFB" className={c} />;
  if (ext === "ts" || ext === "mts")
    return <FileTs size={SZ} weight={W} color="#3178C6" className={c} />;
  if (ext === "tsx") return <FileTsx size={SZ} weight={W} color="#3178C6" className={c} />;
  if (ext === "json") return <FileCode size={SZ} weight={W} color="#4ADE80" className={c} />;
  if (ext === "svg") return <FileSvg size={SZ} weight={W} color="#F97316" className={c} />;
  if (ext === "md" || ext === "mdx")
    return <FileMd size={SZ} weight={W} color="#9CA3AF" className={c} />;
  if (ext === "txt") return <FileTxt size={SZ} weight={W} color="#9CA3AF" className={c} />;
  if (ext === "png") return <FilePng size={SZ} weight={W} color="#22C55E" className={c} />;
  if (ext === "jpg" || ext === "jpeg")
    return <FileJpg size={SZ} weight={W} color="#22C55E" className={c} />;
  if (ext === "webp" || ext === "gif" || ext === "ico")
    return <PhImage size={SZ} weight={W} color="#22C55E" className={c} />;
  if (ext === "mp4" || ext === "webm" || ext === "mov")
    return <FileVideo size={SZ} weight={W} color="#A855F7" className={c} />;
  if (ext === "mp3" || ext === "wav" || ext === "ogg" || ext === "m4a")
    return <Waveform size={SZ} weight={W} color="#3CE6AC" className={c} />;
  if (ext === "woff" || ext === "woff2" || ext === "ttf" || ext === "otf")
    return <TextAa size={SZ} weight={W} color="#6B7280" className={c} />;
  return <File size={SZ} weight={W} color="#6B7280" className={c} />;
}

// ── Tree Helpers ──

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

function isActiveInSubtree(node: TreeNode, activeFile: string | null): boolean {
  if (!activeFile) return false;
  if (node.fullPath === activeFile) return true;
  for (const child of node.children.values()) {
    if (isActiveInSubtree(child, activeFile)) return true;
  }
  return false;
}

// ── Context Menu Component ──

function ContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDuplicate,
  onDelete,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDuplicate: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(state.x, window.innerWidth - 180);
  const adjustedY = Math.min(state.y, window.innerHeight - 200);

  const parentPath = state.targetIsFolder
    ? state.targetPath
    : state.targetPath.includes("/")
      ? state.targetPath.slice(0, state.targetPath.lastIndexOf("/"))
      : "";

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-md shadow-lg py-1 min-w-[160px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {state.targetIsFolder && (
        <>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
            onClick={() => {
              onNewFile(state.targetPath);
              onClose();
            }}
          >
            <FilePlus size={12} weight="duotone" className="text-neutral-500" />
            New File
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
            onClick={() => {
              onNewFolder(state.targetPath);
              onClose();
            }}
          >
            <FolderSimplePlus size={12} weight="duotone" className="text-neutral-500" />
            New Folder
          </button>
          <div className="border-t border-neutral-700 my-1" />
        </>
      )}
      {!state.targetIsFolder && (
        <>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
            onClick={() => {
              onNewFile(parentPath);
              onClose();
            }}
          >
            <FilePlus size={12} weight="duotone" className="text-neutral-500" />
            New File
          </button>
          <div className="border-t border-neutral-700 my-1" />
        </>
      )}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
        onClick={() => {
          onRename(state.targetPath);
          onClose();
        }}
      >
        <PencilSimple size={12} weight="duotone" className="text-neutral-500" />
        Rename
      </button>
      {!state.targetIsFolder && (
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 cursor-pointer text-left"
          onClick={() => {
            onDuplicate(state.targetPath);
            onClose();
          }}
        >
          <Copy size={12} weight="duotone" className="text-neutral-500" />
          Duplicate
        </button>
      )}
      <div className="border-t border-neutral-700 my-1" />
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 cursor-pointer text-left"
        onClick={() => {
          onDelete(state.targetPath);
          onClose();
        }}
      >
        <Trash size={12} weight="duotone" />
        Delete
      </button>
    </div>
  );
}

// ── Inline Input (for new file/folder/rename) ──

function InlineInput({
  defaultValue,
  depth,
  isFolder,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  depth: number;
  isFolder: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const [value, setValue] = useState(defaultValue);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select just the filename (not extension) for rename
    if (defaultValue && defaultValue.includes(".")) {
      const dotIdx = defaultValue.lastIndexOf(".");
      el.setSelectionRange(0, dotIdx);
    } else {
      el.select();
    }
  }, [defaultValue]);

  const commit = (name: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !(/[/\\]/.test(trimmed) || trimmed.includes(".."))) commit(trimmed);
      else onCancel();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== defaultValue && !(/[/\\]/.test(trimmed) || trimmed.includes("..")))
      commit(trimmed);
    else onCancel();
  };

  return (
    <div
      className="flex items-center gap-2 py-0.5 min-h-7"
      style={{ paddingLeft: `${8 + depth * 12 + (isFolder ? 0 : 14)}px` }}
    >
      {isFolder ? (
        <FolderSimple size={SZ} weight="duotone" color="#6B7280" className="flex-shrink-0" />
      ) : (
        <FileIcon path={value} />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex-1 min-w-0 bg-neutral-800 text-neutral-200 text-xs px-1.5 py-0.5 rounded border border-neutral-600 outline-none focus:border-[#3CE6AC]"
        spellCheck={false}
      />
    </div>
  );
}

// ── Delete Confirmation ──

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      className="mx-1 my-0.5 p-2 bg-neutral-800 border border-neutral-700 rounded-md text-xs"
    >
      <p className="text-neutral-300 mb-2">
        Delete <span className="font-medium text-neutral-100">{name}</span>?
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={onCancel}
          className="flex-1 px-2 py-1 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-2 py-1 rounded bg-red-900/60 text-red-300 hover:bg-red-800/60 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── TreeFolder ──

function TreeFolder({
  node,
  depth,
  activeFile,
  onSelectFile,
  defaultOpen,
  onContextMenu,
  inlineInput,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  dragOverFolder,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  defaultOpen: boolean;
  onContextMenu: (e: React.MouseEvent, path: string, isFolder: boolean) => void;
  inlineInput: InlineInputState | null;
  onDragStart: (e: React.DragEvent, path: string) => void;
  onDragOver: (e: React.DragEvent, folderPath: string) => void;
  onDrop: (e: React.DragEvent, folderPath: string) => void;
  onDragLeave: () => void;
  dragOverFolder: string | null;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const children = useMemo(() => sortChildren(node.children), [node.children]);
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const isDragOver = dragOverFolder === node.fullPath;
  const isRenaming = inlineInput?.mode === "rename" && inlineInput.originalPath === node.fullPath;

  if (isRenaming) {
    return (
      <InlineInput
        defaultValue={inlineInput.originalName ?? node.name}
        depth={depth}
        isFolder={true}
        onCommit={(name) => {
          inlineInput?.onCommit?.(name);
        }}
        onCancel={() => {
          inlineInput?.onCancel?.();
        }}
      />
    );
  }

  return (
    <>
      <button
        draggable
        onDragStart={(e) => onDragStart(e, node.fullPath)}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.fullPath, true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDragOver(e, node.fullPath);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDrop(e, node.fullPath);
        }}
        onDragLeave={onDragLeave}
        className={`w-full flex items-center gap-1.5 px-2.5 py-1 min-h-7 text-left text-xs text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-300 transition-colors ${
          isDragOver ? "bg-[#3CE6AC]/10 outline outline-1 outline-[#3CE6AC]/40" : ""
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <Chevron size={10} className="flex-shrink-0 text-neutral-600" />
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {isOpen && (
        <>
          {/* Inline input for new file/folder inside this folder */}
          {inlineInput &&
            (inlineInput.mode === "new-file" || inlineInput.mode === "new-folder") &&
            inlineInput.parentPath === node.fullPath && (
              <InlineInput
                defaultValue=""
                depth={depth + 1}
                isFolder={inlineInput.mode === "new-folder"}
                onCommit={(name) => {
                  // onCommit is handled by the parent FileTree component
                  // via the inlineInputCommit callback
                  inlineInput?.onCommit?.(name);
                }}
                onCancel={() => {
                  inlineInput?.onCancel?.();
                }}
              />
            )}
          {children.map((child) =>
            child.isFile && child.children.size === 0 ? (
              <TreeFile
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                inlineInput={inlineInput}
                onDragStart={onDragStart}
              />
            ) : child.children.size > 0 ? (
              <TreeFolder
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
                defaultOpen={isActiveInSubtree(child, activeFile)}
                onContextMenu={onContextMenu}
                inlineInput={inlineInput}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragLeave={onDragLeave}
                dragOverFolder={dragOverFolder}
              />
            ) : (
              <TreeFile
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                inlineInput={inlineInput}
                onDragStart={onDragStart}
              />
            ),
          )}
        </>
      )}
    </>
  );
}

// ── TreeFile ──

function TreeFile({
  node,
  depth,
  activeFile,
  onSelectFile,
  onContextMenu,
  inlineInput,
  onDragStart,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isFolder: boolean) => void;
  inlineInput: InlineInputState | null;
  onDragStart: (e: React.DragEvent, path: string) => void;
}) {
  const isActive = node.fullPath === activeFile;
  const isRenaming = inlineInput?.mode === "rename" && inlineInput.originalPath === node.fullPath;

  if (isRenaming) {
    return (
      <InlineInput
        defaultValue={inlineInput.originalName ?? node.name}
        depth={depth}
        isFolder={false}
        onCommit={(name) => {
          inlineInput?.onCommit?.(name);
        }}
        onCancel={() => {
          inlineInput?.onCancel?.();
        }}
      />
    );
  }

  return (
    <button
      draggable
      onDragStart={(e) => onDragStart(e, node.fullPath)}
      onClick={() => onSelectFile(node.fullPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, node.fullPath, false);
      }}
      className={`w-full flex items-center gap-2 py-1 min-h-7 text-left transition-all text-xs ${
        isActive
          ? "bg-neutral-800/60 text-neutral-200"
          : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300"
      }`}
      style={{ paddingLeft: `${8 + depth * 12 + 14}px` }}
    >
      <FileIcon path={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ── Main FileTree Component ──

export const FileTree = memo(function FileTree({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onMoveFile,
  onImportFiles,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const children = useMemo(() => sortChildren(tree.children), [tree]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);

  const hasFileOps = !!(
    onCreateFile ||
    onCreateFolder ||
    onDeleteFile ||
    onRenameFile ||
    onDuplicateFile
  );

  // ── Context Menu handlers ──

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isFolder: boolean) => {
      if (!hasFileOps) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, targetPath: path, targetIsFolder: isFolder });
    },
    [hasFileOps],
  );

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  // ── New File ──

  const handleNewFile = useCallback(
    (parentPath: string) => {
      setInlineInput({
        parentPath,
        mode: "new-file",
        onCommit: (name: string) => {
          const fullPath = parentPath ? `${parentPath}/${name}` : name;
          onCreateFile?.(fullPath);
          setInlineInput(null);
        },
        onCancel: () => setInlineInput(null),
      });
    },
    [onCreateFile],
  );

  // ── New Folder ──

  const handleNewFolder = useCallback(
    (parentPath: string) => {
      setInlineInput({
        parentPath,
        mode: "new-folder",
        onCommit: (name: string) => {
          const fullPath = parentPath ? `${parentPath}/${name}` : name;
          onCreateFolder?.(fullPath);
          setInlineInput(null);
        },
        onCancel: () => setInlineInput(null),
      });
    },
    [onCreateFolder],
  );

  // ── Rename ──

  const handleRename = useCallback(
    (path: string) => {
      const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      setInlineInput({
        parentPath,
        mode: "rename",
        originalPath: path,
        originalName: name,
        onCommit: (newName: string) => {
          if (newName !== name) {
            const newPath = parentPath ? `${parentPath}/${newName}` : newName;
            onRenameFile?.(path, newPath);
          }
          setInlineInput(null);
        },
        onCancel: () => setInlineInput(null),
      });
    },
    [onRenameFile],
  );

  // ── Duplicate ──

  const handleDuplicate = useCallback(
    (path: string) => {
      onDuplicateFile?.(path);
    },
    [onDuplicateFile],
  );

  // ── Delete ──

  const handleDelete = useCallback((path: string) => {
    setDeleteTarget(path);
  }, []);

  // Since DeleteConfirm is rendered inside TreeFile, we need callbacks on that component.
  // Instead, let's use a portal-style approach: render the confirm at the FileTree level.
  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      onDeleteFile?.(deleteTarget);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDeleteFile]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  // ── Drag and Drop ──

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    dragSourceRef.current = path;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", path);
  }, []);

  const handleDragOver = useCallback((_e: React.DragEvent, folderPath: string) => {
    setDragOverFolder(folderPath);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, folderPath: string) => {
      // External files from desktop — import into the target folder
      if (e.dataTransfer.files.length > 0 && !dragSourceRef.current) {
        e.preventDefault();
        onImportFiles?.(e.dataTransfer.files, folderPath || undefined);
        setDragOverFolder(null);
        return;
      }

      const sourcePath = dragSourceRef.current;
      if (!sourcePath || !onMoveFile) {
        setDragOverFolder(null);
        return;
      }
      // Extract filename from source path
      const fileName = sourcePath.includes("/")
        ? sourcePath.slice(sourcePath.lastIndexOf("/") + 1)
        : sourcePath;
      const newPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      // Don't move to same location or into own subtree
      if (newPath !== sourcePath && !folderPath.startsWith(sourcePath + "/")) {
        onMoveFile(sourcePath, newPath);
      }
      setDragOverFolder(null);
      dragSourceRef.current = null;
    },
    [onMoveFile, onImportFiles],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  // ── Root-level context menu (right-click on empty space) ──

  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!hasFileOps) return;
      // Only trigger if clicking directly on the container, not on a file/folder button
      if (e.target === e.currentTarget) {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, targetPath: "", targetIsFolder: true });
      }
    },
    [hasFileOps],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* FILES header with action buttons */}
      {hasFileOps && (
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-neutral-800/50 flex-shrink-0">
          <span className="text-[10px] font-semibold tracking-wider text-neutral-600 uppercase">
            Files
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => handleNewFile("")}
              className="p-0.5 rounded hover:bg-neutral-800 text-neutral-600 hover:text-neutral-400 transition-colors"
              title="New File"
            >
              <Plus size={12} weight="bold" />
            </button>
            <button
              onClick={() => handleNewFolder("")}
              className="p-0.5 rounded hover:bg-neutral-800 text-neutral-600 hover:text-neutral-400 transition-colors"
              title="New Folder"
            >
              <FolderSimplePlus size={12} weight="duotone" />
            </button>
          </div>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto py-1 transition-colors ${
          dragOverFolder === ""
            ? "bg-[#3CE6AC]/5 outline outline-1 outline-[#3CE6AC]/30 -outline-offset-1"
            : ""
        }`}
        onContextMenu={handleRootContextMenu}
        onDragOver={(e) => {
          e.preventDefault();
          // Show root highlight when dragging over the background (not a child folder)
          if (e.target === e.currentTarget) setDragOverFolder("");
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDragOverFolder(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(e, "");
        }}
      >
        {/* Root-level inline input for new file/folder */}
        {inlineInput &&
          (inlineInput.mode === "new-file" || inlineInput.mode === "new-folder") &&
          inlineInput.parentPath === "" && (
            <InlineInput
              defaultValue=""
              depth={0}
              isFolder={inlineInput.mode === "new-folder"}
              onCommit={(name) => inlineInput.onCommit?.(name)}
              onCancel={() => inlineInput.onCancel?.()}
            />
          )}
        {children.map((child) =>
          child.isFile && child.children.size === 0 ? (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              onContextMenu={handleContextMenu}
              inlineInput={inlineInput}
              onDragStart={handleDragStart}
            />
          ) : (
            <TreeFolder
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              defaultOpen={isActiveInSubtree(child, activeFile)}
              onContextMenu={handleContextMenu}
              inlineInput={inlineInput}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragLeave={handleDragLeave}
              dragOverFolder={dragOverFolder}
            />
          ),
        )}
      </div>

      {/* Delete confirmation overlay */}
      {deleteTarget && (
        <div className="border-t border-neutral-800/50 flex-shrink-0">
          <DeleteConfirm
            name={
              deleteTarget.includes("/")
                ? deleteTarget.slice(deleteTarget.lastIndexOf("/") + 1)
                : deleteTarget
            }
            onConfirm={handleDeleteConfirm}
            onCancel={handleDeleteCancel}
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={handleCloseContextMenu}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
});
