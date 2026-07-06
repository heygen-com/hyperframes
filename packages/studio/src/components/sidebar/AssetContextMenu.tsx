import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { filename } from "./assetHelpers";

/** Reject names that would escape the asset directory or break paths. */
function isValidAssetName(name: string): boolean {
  return name.length > 0 && !/[/\\]/.test(name) && !name.includes("..");
}

// fallow-ignore-next-line complexity
export function ContextMenu({
  x,
  y,
  asset,
  onClose,
  onCopy,
  onDelete,
  onRename,
}: {
  x: number;
  y: number;
  asset: string;
  onClose: () => void;
  onCopy: (path: string) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [mode, setMode] = useState<"menu" | "confirm-delete" | "rename">("menu");
  const [renameDraft, setRenameDraft] = useState(() => filename(asset));
  const [renameError, setRenameError] = useState<string | null>(null);

  // Clamp the menu inside the viewport once it has a size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - margin),
      y: Math.min(y, window.innerHeight - rect.height - margin),
    });
  }, [x, y, mode]);

  // Keyboard contract: Escape backs out one level (rename/delete-confirm →
  // menu → closed), arrows move between menu items.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (mode !== "menu") {
          setMode("menu");
        } else {
          onClose();
        }
        return;
      }
      if (mode !== "menu" || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const idx = items.findIndex((el) => el === document.activeElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = items[(idx + delta + items.length) % items.length];
      next.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [mode, onClose]);

  // Move focus into the menu on open so arrow keys work immediately.
  useEffect(() => {
    if (mode === "menu") {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
  }, [mode]);

  const commitRename = useCallback(() => {
    const trimmed = renameDraft.trim();
    if (trimmed === filename(asset)) {
      onClose();
      return;
    }
    if (!isValidAssetName(trimmed)) {
      setRenameError("Name can't contain / or ..");
      return;
    }
    const dir = asset.includes("/") ? asset.slice(0, asset.lastIndexOf("/") + 1) : "";
    onRename?.(asset, `${dir}${trimmed}`);
    onClose();
  }, [renameDraft, asset, onRename, onClose]);

  const itemCls =
    "w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 focus-visible:bg-neutral-800 outline-none active:bg-neutral-700/70 transition-colors";

  return (
    <div
      className="fixed inset-0 z-[200]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Actions for ${filename(asset)}`}
        className="absolute bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[160px] text-xs"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "menu" && (
          <>
            <button
              role="menuitem"
              onClick={() => {
                onCopy(asset);
                onClose();
              }}
              className={itemCls}
            >
              Copy path
            </button>
            {onRename && (
              <button role="menuitem" onClick={() => setMode("rename")} className={itemCls}>
                Rename
              </button>
            )}
            {onDelete && (
              <button
                role="menuitem"
                onClick={() => setMode("confirm-delete")}
                className={`${itemCls} text-red-400`}
              >
                Delete
              </button>
            )}
          </>
        )}
        {mode === "confirm-delete" && (
          <DeleteConfirm
            name={filename(asset)}
            onConfirm={() => {
              onDelete?.(asset);
              onClose();
            }}
            onCancel={() => setMode("menu")}
          />
        )}
        {mode === "rename" && (
          <div className="px-2 py-1.5 flex flex-col gap-1">
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => {
                setRenameDraft(e.target.value);
                setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setMode("menu");
                }
              }}
              aria-label={`Rename ${filename(asset)}`}
              className="w-full bg-neutral-800 border border-neutral-600 rounded px-1.5 py-1 text-[11px] text-white focus:border-studio-accent/60 focus:outline-none"
            />
            {renameError && <span className="text-[10px] text-red-400">{renameError}</span>}
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => setMode("menu")}
                className="px-2 py-0.5 text-[10px] rounded text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={commitRename}
                className="px-2 py-0.5 text-[10px] rounded bg-studio-accent/80 hover:bg-studio-accent text-white transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-2 py-1.5 bg-red-950/30 border-l-2 border-red-500 flex items-center justify-between gap-2">
      <span className="text-[10px] text-red-400 truncate">Delete {name}?</span>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onConfirm}
          className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 active:bg-red-700 transition-colors"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-0.5 text-[10px] rounded text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
