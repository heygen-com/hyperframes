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
        className="absolute bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[140px] text-xs"
        style={{ left: x, top: y }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(asset);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition-colors"
        >
          Copy path
        </button>
        {onRename && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            Rename
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(asset);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-neutral-800 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function DeleteConfirm({
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
          className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
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
