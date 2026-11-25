import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { normalizeStudioCompositionPath, type StudioUrlState } from "../utils/studioUrlState";

/**
 * One-time hydration of `activeCompPath` from the initial URL state, once the
 * file tree has loaded (a path that isn't in the server's compositions yet can't
 * be validated). Runs exactly once — `hydrated` flips true whether or not the
 * URL named a valid path, so a later file-tree change never re-fires it.
 */
export function useHydrateActiveCompPathFromUrl({
  hydrated,
  fileTreeLoaded,
  compositions,
  initialUrlStateRef,
  setActiveCompPath,
  setHydrated,
}: {
  hydrated: boolean;
  fileTreeLoaded: boolean;
  compositions: string[];
  initialUrlStateRef: MutableRefObject<StudioUrlState>;
  setActiveCompPath: (updater: (current: string | null) => string | null) => void;
  setHydrated: (value: boolean) => void;
}): void {
  useEffect(() => {
    if (hydrated) return;
    if (!fileTreeLoaded) return;
    const nextCompPath = normalizeStudioCompositionPath(
      initialUrlStateRef.current.activeCompPath,
      compositions,
    );
    setActiveCompPath((current) => (current === nextCompPath ? current : nextCompPath));
    setHydrated(true);
  }, [hydrated, compositions, fileTreeLoaded, initialUrlStateRef, setActiveCompPath, setHydrated]);
}
