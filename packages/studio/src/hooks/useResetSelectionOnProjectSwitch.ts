import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { readStudioUrlStateFromWindow, type StudioUrlState } from "../utils/studioUrlState";

/**
 * Resets selection when `projectId` switches in-session. Runs during render, not an
 * effect, so useAutoOpenRootComposition never sees a stale activeCompPath in that commit.
 */
export function useResetSelectionOnProjectSwitch({
  projectId,
  initialUrlStateRef,
  setActiveCompPath,
  setActiveCompPathHydrated,
}: {
  projectId: string | null;
  initialUrlStateRef: MutableRefObject<StudioUrlState>;
  setActiveCompPath: Dispatch<SetStateAction<string | null>>;
  setActiveCompPathHydrated: Dispatch<SetStateAction<boolean>>;
}): void {
  const previousProjectIdRef = useRef(projectId);

  if (previousProjectIdRef.current !== projectId) {
    const isSwitch = previousProjectIdRef.current !== null;
    previousProjectIdRef.current = projectId;
    if (isSwitch) {
      initialUrlStateRef.current = readStudioUrlStateFromWindow();
      setActiveCompPath(null);
      setActiveCompPathHydrated(initialUrlStateRef.current.activeCompPath == null);
    }
  }
}
