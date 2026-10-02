import { memo, useCallback, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { formatSyncOffset } from "@hyperframes/core/media-link";
import { useContextMenuDismiss } from "../../hooks/useContextMenuDismiss";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { clipSyncState, type ClipSyncState } from "./clipSync";
import { useMenuKeyboardNav } from "./menuKeyboardNav";

const stop = (e: SyntheticEvent) => e.stopPropagation();

const MENU_ROW =
  "block w-full px-3 py-1.5 text-left text-xs text-neutral-300 outline-hidden hover:bg-neutral-800 focus-visible:bg-neutral-800 disabled:opacity-40";

function SyncMenu({
  x,
  y,
  el,
  sync,
  onClose,
}: {
  x: number;
  y: number;
  el: TimelineElement;
  sync: ClipSyncState<TimelineElement>;
  onClose: () => void;
}) {
  const menuRef = useContextMenuDismiss(onClose);
  useMenuKeyboardNav(menuRef);
  const { onLinkEdit } = useTimelineEditContextOptional();
  const { moveStart, slipMediaStart } = sync;
  const menuWidth = 170;
  const menuHeight = 66;
  const left = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const top = y + menuHeight > window.innerHeight ? Math.max(0, y - menuHeight) : y;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Out of sync"
      className="fixed z-200 min-w-[170px] rounded-sm border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
      style={{ left, top }}
    >
      <button
        type="button"
        role="menuitem"
        className={MENU_ROW}
        disabled={!onLinkEdit || moveStart === null}
        title={moveStart === null ? "Would move the clip before 0:00" : undefined}
        onClick={() => {
          if (moveStart !== null)
            void onLinkEdit?.({ kind: "move-into-sync", element: el, start: moveStart });
          onClose();
        }}
      >
        Move into Sync
      </button>
      <button
        type="button"
        role="menuitem"
        className={MENU_ROW}
        disabled={!onLinkEdit || slipMediaStart === null}
        title={slipMediaStart === null ? "Would slip before the start of the file" : undefined}
        onClick={() => {
          if (slipMediaStart !== null) {
            void onLinkEdit?.({ kind: "slip-into-sync", element: el, mediaStart: slipMediaStart });
          }
          onClose();
        }}
      >
        Slip into Sync
      </button>
    </div>,
    document.body,
  );
}

/**
 * Premiere's red out-of-sync number, at the start of each half of a source pair
 * that drifted. The whole badge opens Move / Slip into Sync (Premiere's own hit
 * target is a sliver at the badge edge, a known complaint).
 */
export const OutOfSyncBadge = memo(function OutOfSyncBadge({ el }: { el: TimelineElement }) {
  const visible = useLinkedClipPreferences((s) => s.syncIndicatorsVisible);
  const fps = useLinkedClipPreferences((s) => s.compositionFps);
  const elements = usePlayerStore((s) => s.elements);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const sync = visible ? clipSyncState(el, elements, fps) : null;
  if (!sync) return null;
  const label = formatSyncOffset(sync.frames, fps);
  const partnerName = sync.partner.label || sync.partner.id;
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuAt({ x: e.clientX, y: e.clientY });
  };
  return (
    <>
      <span
        role="button"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-label={`Out of sync with ${partnerName} by ${label} frames`}
        title={`Out of sync with ${partnerName} by ${label} — click for Move or Slip into Sync`}
        data-testid="out-of-sync-badge"
        className="absolute bottom-0.5 left-1 z-[7] cursor-pointer rounded-[3px] bg-red-600 px-1 font-mono text-[9px] leading-[14px] text-white tabular-nums"
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={open}
        onContextMenu={open}
      >
        {label}
      </span>
      {menuAt && <SyncMenu x={menuAt.x} y={menuAt.y} el={el} sync={sync} onClose={closeMenu} />}
    </>
  );
});
