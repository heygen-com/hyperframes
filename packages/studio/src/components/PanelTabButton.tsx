import { Tooltip } from "./ui";

/** Tab-bar button for the right inspector panel header. */
export function PanelTabButton({
  label,
  tooltip,
  active,
  onClick,
}: {
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`h-8 rounded-xl px-3 text-[11px] font-medium transition-colors active:scale-[0.98] ${
          active
            ? "bg-neutral-800 text-white"
            : "text-neutral-500 hover:bg-neutral-800/70 hover:text-neutral-200"
        }`}
      >
        {label}
      </button>
    </Tooltip>
  );
}
