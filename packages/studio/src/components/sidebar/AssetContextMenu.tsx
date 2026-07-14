export function ContextMenu({
  x,
  y,
  asset,
  onClose,
  onCopy,
  onDelete,
  onRename,
  onAddAtPlayhead,
}: {
  x: number;
  y: number;
  asset: string;
  onClose: () => void;
  onCopy: (path: string) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAtPlayhead?: (path: string) => void;
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
        {onAddAtPlayhead && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddAtPlayhead(asset);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            Add at playhead
          </button>
        )}
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
