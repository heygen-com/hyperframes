import { useCallback } from "react";
import type { TimelineElement } from "../player";

/** A host's verdict on one element: editable, or blocked with a reason to show. */
export type TimelineEditPermission = true | { blocked: true; reason: string };

export type CanEditTimelineElement = (element: TimelineElement) => TimelineEditPermission;

/**
 * Refuses a write when any target element is blocked, toasting the host's
 * reason. Absent `canEdit` never refuses, so Studio itself is unchanged.
 */
export function useTimelineEditGate(
  canEdit: CanEditTimelineElement | undefined,
  showToast: (message: string, tone?: "error" | "info") => void,
) {
  return useCallback(
    (targets: readonly TimelineElement[]): boolean => {
      if (!canEdit) return true;
      for (const element of targets) {
        const verdict = canEdit(element);
        if (verdict !== true) {
          showToast(verdict.reason, "error");
          return false;
        }
      }
      return true;
    },
    [canEdit, showToast],
  );
}
