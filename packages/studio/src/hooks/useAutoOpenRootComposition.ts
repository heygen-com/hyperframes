import { useEffect, useRef } from "react";

/**
 * Opens the root composition once hydration settles on no selection; fires at most once per
 * `projectId`. Known gap: `activeCompPath`/`activeCompPathHydrated` in App.tsx are never reset
 * on a projectId change, so switching projects in-session while something is already open in
 * the old one still skips auto-open for the new one (activeCompPath reads as "already set").
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
