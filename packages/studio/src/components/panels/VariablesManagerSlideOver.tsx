import { useEffect, type MutableRefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { EditHistoryKind } from "../../utils/editHistory";
import { useVariablesManagerStore } from "../../hooks/variablesManagerStore";
import { usePreviewVariablesStore } from "../../hooks/previewVariablesStore";
import { useSdkSession } from "../../hooks/useSdkSession";
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
/** Close the manager on Escape while it is open. */
function useEscapeToClose(open: boolean, setOpen: (open: boolean) => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
}

/**
 * The file the manager should open a dedicated session for, or null to reuse the
 * host session. Non-null only when the manager is open AND targets a file other
 * than the active composition (a bound-chip open on a sub-composition element).
 */
export function resolveManagerOverridePath(
  open: boolean,
  targetPath: string | null,
  activeCompPath: string | null,
): string | null {
  if (!open || !targetPath || targetPath === activeCompPath) return null;
  return targetPath;
}

/**
 * The session + path the manager panel edits. When opened from a bound chip on a
 * sub-composition element the manager must target that element's OWN file — the
 * host session manages the wrong composition — so a dedicated session is opened
 * for the target (only while overriding). Otherwise the host session is reused.
 */
function useManagerPanelSession(
  hostSession: Composition | null,
  projectId: string | null,
  activeCompPath: string | null,
  ref: MutableRefObject<number>,
  open: boolean,
  targetPath: string | null,
): { overridePath: string | null; panelSession: Composition | null } {
  const overridePath = resolveManagerOverridePath(open, targetPath, activeCompPath);
  const overrideHandle = useSdkSession(projectId, overridePath, ref);
  return { overridePath, panelSession: overridePath ? overrideHandle.session : hostSession };
}

export function VariablesManagerSlideOver({
  sdkSession,
  projectId,
  activeCompPath,
  reloadPreview,
  domEditSaveTimestampRef,
  recordEdit,
}: {
  sdkSession: Composition | null;
  projectId: string | null;
  activeCompPath: string | null;
  reloadPreview: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
}) {
  const open = useVariablesManagerStore((s) => s.open);
  const targetPath = useVariablesManagerStore((s) => s.targetPath);
  const setOpen = useVariablesManagerStore((s) => s.setOpen);
  useEscapeToClose(open, setOpen);
  const { overridePath, panelSession } = useManagerPanelSession(
    sdkSession,
    projectId,
    activeCompPath,
    domEditSaveTimestampRef,
    open,
    targetPath,
  );

  if (!open) return null;

  const usingOverride = overridePath !== null;

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
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] font-semibold text-neutral-200">Variables manager</span>
            {usingOverride && (
              <span className="truncate font-mono text-[9px] text-neutral-500" title={overridePath}>
                {overridePath}
              </span>
            )}
          </div>
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
            sdkSession={panelSession}
            compPathOverride={usingOverride ? overridePath : null}
            reloadPreview={reloadPreview}
            domEditSaveTimestampRef={domEditSaveTimestampRef}
            recordEdit={recordEdit}
          />
        </div>
      </div>
    </div>
  );
}
