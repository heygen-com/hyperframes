import { useEffect, useRef } from "react";

/**
 * Opens the root composition once hydration settles on no selection; fires at most once per
 * `projectId`. Relies on the caller resetting selection on an in-session project switch
 * (see `useResetSelectionOnProjectSwitch`) or a stale selection reads as "already open".
 */
export function useAutoOpenRootComposition({
  projectId,
  activeCompPath,
  activeCompPathHydrated,
  masterCompPath,
  onSelectComposition,
}: {
  projectId: string | null;
  activeCompPath: string | null;
  activeCompPathHydrated: boolean;
  masterCompPath: string | null;
  onSelectComposition: (comp: string) => void;
}): void {
  const settledForProjectRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (settledForProjectRef.current === projectId) return;
    if (!activeCompPathHydrated) return;
    if (activeCompPath !== null) {
      settledForProjectRef.current = projectId; // a URL-hydrated selection is already open
      return;
    }
    if (!masterCompPath) return; // file tree not loaded yet, or no composition at all
    settledForProjectRef.current = projectId;
    onSelectComposition(masterCompPath);
  }, [projectId, activeCompPath, activeCompPathHydrated, masterCompPath, onSelectComposition]);
}
