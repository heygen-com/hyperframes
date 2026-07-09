import { useEffect, type MutableRefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "../../utils/editHistory";
import { useVariablesManagerStore } from "../../hooks/variablesManagerStore";
import { usePreviewVariablesStore } from "../../hooks/previewVariablesStore";
import { VariablesPanel } from "./VariablesPanel";

/**
 * Inspector-header button that opens the Variables manager. Not a tab — it also
 * carries the global "previewing N overrides" signal (accent styling) so that
 * state stays visible while the manager is closed.
 */
export function VariablesManagerTrigger() {
  const setOpen = useVariablesManagerStore((s) => s.setOpen);
  const overrideCount = usePreviewVariablesStore((s) =>
    s.values ? Object.keys(s.values).length : 0,
  );
  return (
    <button
      type="button"
      title="Manage template variables — declare, preview with values, dev handoff"
      onClick={() => setOpen(true)}
      className={`ml-auto flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] font-medium transition-colors ${
        overrideCount > 0
          ? "border-studio-accent/40 bg-studio-accent/15 text-studio-accent"
          : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
      }`}
    >
      ◆ Variables
      {overrideCount > 0 && <span>· {overrideCount}</span>}
    </button>
  );
}

/**
 * Summonable overlay that hosts the full Variables manager (VariablesPanel).
 *
 * Replaces the dedicated Variables tab: the same declare / edit / remove /
 * preview-override / handoff / other-composition surface, now opened on demand
 * from the Design panel instead of occupying a permanent tab. Per-element
 * creation and default-editing stay inline in the Design panel; this overlay is
 * the list-oriented "manage everything" view. Closes on backdrop click or Esc.
 */
export function VariablesManagerSlideOver({
  sdkSession,
  reloadPreview,
  domEditSaveTimestampRef,
  recordEdit,
}: {
  sdkSession: Composition | null;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
}) {
  const open = useVariablesManagerStore((s) => s.open);
  const setOpen = useVariablesManagerStore((s) => s.setOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-label="Variables manager"
    >
      <button
        type="button"
        aria-label="Close variables manager"
        className="absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
      />
      <div className="relative flex h-full w-[360px] max-w-[90vw] flex-col border-l border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="text-[11px] font-semibold text-neutral-200">Variables manager</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-6 rounded px-2 text-[11px] text-neutral-400 hover:text-neutral-200"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <VariablesPanel
            sdkSession={sdkSession}
            reloadPreview={reloadPreview}
            domEditSaveTimestampRef={domEditSaveTimestampRef}
            recordEdit={recordEdit}
          />
        </div>
      </div>
    </div>
  );
}
