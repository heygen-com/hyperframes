import { X } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditingTypes";

/** The action buttons in the inspector header: Ungroup (groups only), copy, clear. */
export function InspectorHeaderActions({
  element,
  copied,
  onCopy,
  onClear,
  onUngroup,
}: {
  element: DomEditSelection;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
  onUngroup?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {onUngroup && element.dataAttributes["hf-group"] != null && (
        <button
          type="button"
          onClick={onUngroup}
          title="Ungroup (⌘⇧G)"
          className="flex h-6 items-center rounded px-2 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
        >
          Ungroup
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          copied
            ? "text-studio-accent"
            : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
        }`}
        title={copied ? "Copied!" : "Copy element info to clipboard"}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="5" y="5" width="9" height="9" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
      >
        <X size={13} />
      </button>
    </div>
  );
}
