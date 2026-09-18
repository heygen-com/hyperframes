import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useResetSelectionOnProjectSwitch } from "./useResetSelectionOnProjectSwitch";
import type { StudioUrlState } from "../utils/studioUrlState";

/**
 * Opens the root composition once hydration settles on no selection; fires at most once per
 * `projectId`. Also resets the selection on an in-session project switch (via
 * `useResetSelectionOnProjectSwitch`) — without that, a stale selection from the previous
 * project reads as "already open" and this hook settles without ever firing for the new one.
 */
export function useAutoOpenRootComposition({
  projectId,
  activeCompPath,
  activeCompPathHydrated,
  masterCompPath,
  initialUrlStateRef,
  setActiveCompPath,
  setActiveCompPathHydrated,
  onSelectComposition,
}: {
  projectId: string | null;
  activeCompPath: string | null;
  activeCompPathHydrated: boolean;
  masterCompPath: string | null;
  initialUrlStateRef: MutableRefObject<StudioUrlState>;
  setActiveCompPath: Dispatch<SetStateAction<string | null>>;
  setActiveCompPathHydrated: Dispatch<SetStateAction<boolean>>;
  onSelectComposition: (comp: string) => void;
}): void {
  useResetSelectionOnProjectSwitch({
    projectId,
    initialUrlStateRef,
    setActiveCompPath,
    setActiveCompPathHydrated,
  });

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
