import { useEffect, useState } from "react";
import type { AgentJob } from "./agentGlyphs";
import {
  overlayPaintForSelection,
  type OverlayState,
  type OverlayTargetable,
} from "./overlayState";

/**
 * The OverlayState for the element in front of the user, kept honest over time.
 *
 * A finished run says so for a beat and then stops. Nothing else re-renders at
 * that moment — the job list is only polled, and it stops changing once the run
 * is over — so the expiry is what schedules its own repaint. Without this the
 * "Done" badge would sit on the canvas until something unrelated happened.
 */
export function useOverlayState(
  jobs: AgentJob[],
  selection: OverlayTargetable | null,
): OverlayState | null {
  const [, repaint] = useState(0);
  const paint = overlayPaintForSelection(jobs, selection);
  const expiresAt = paint?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => repaint((n) => n + 1), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  return paint?.state ?? null;
}
