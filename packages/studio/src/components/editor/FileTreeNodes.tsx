import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  PencilSimple,
  Copy,
  Trash,
  FilePlus,
  FolderSimplePlus,
  FolderSimple,
} from "@phosphor-icons/react";
import { ChevronDown, ChevronRight } from "../../icons/SystemIcons";
import {
  FileIcon,
  buildTree as _buildTree,
  sortChildren,
  isActiveInSubtree,
  type TreeNode,
  type ContextMenuState,
  type InlineInputState,
} from "./FileTreeIcons";

export type { ContextMenuState, InlineInputState };
export { buildTree, sortChildren, isActiveInSubtree } from "./FileTreeIcons";

const SZ_ICON = 14;

// ── Context Menu Component ──

export function ContextMenu({
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

export function InlineInput({
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
        <FolderSimple size={SZ_ICON} weight="duotone" color="#6B7280" className="flex-shrink-0" />
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

export function DeleteConfirm({
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

// ── TreeFile ──

export const TreeFile = memo(function TreeFile({
  node,
  depth,
  activeFile,
  onSelectFile,
  onContextMenu,
  inlineInput,
  onDragStart,
  lintInfo,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isFolder: boolean) => void;
  inlineInput: InlineInputState | null;
  onDragStart: (e: React.DragEvent, path: string) => void;
  lintInfo?: { count: number; messages: string[] };
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
      <span className="truncate flex-1">{node.name}</span>
      {lintInfo && lintInfo.count > 0 && (
        <span
          className="flex-shrink-0 min-w-[16px] rounded-full bg-amber-500/20 px-1 text-[8px] font-bold text-amber-400 text-center mr-1"
          title={lintInfo.messages.join("\n")}
        >
          {lintInfo.count}
        </span>
      )}
    </button>
  );
});

// ── TreeFolder ──

export const TreeFolder = memo(function TreeFolder({
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
  lintFindingsByFile,
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
  lintFindingsByFile?: Map<string, { count: number; messages: string[] }>;
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
          {inlineInput &&
            (inlineInput.mode === "new-file" || inlineInput.mode === "new-folder") &&
            inlineInput.parentPath === node.fullPath && (
              <InlineInput
                defaultValue=""
                depth={depth + 1}
                isFolder={inlineInput.mode === "new-folder"}
                onCommit={(name) => {
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
                lintInfo={lintFindingsByFile?.get(child.fullPath)}
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
                lintFindingsByFile={lintFindingsByFile}
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
                lintInfo={lintFindingsByFile?.get(child.fullPath)}
              />
            ),
          )}
        </>
      )}
    </>
  );
});
