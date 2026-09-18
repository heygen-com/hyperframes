import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useHydrateActiveCompPathFromUrl } from "./useHydrateActiveCompPathFromUrl";
import { useAutoOpenRootComposition } from "./useAutoOpenRootComposition";
import { useCompositionContentLoader } from "./useCompositionContentLoader";
import type { StudioUrlState } from "../utils/studioUrlState";

/** Owns which composition is open: state, URL hydration, auto-open and content loading. */
export function useActiveComposition({
  projectId,
  initialUrlStateRef,
  fileTree,
  fileTreeLoaded,
  masterCompPath,
  setEditingFile,
  showToast,
}: {
  projectId: string | null;
  initialUrlStateRef: MutableRefObject<StudioUrlState>;
  fileTree: string[];
  fileTreeLoaded: boolean;
  masterCompPath: string | null;
  setEditingFile: (file: { path: string; content: string | null }) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
}): {
  activeCompPath: string | null;
  activeCompPathHydrated: boolean;
  setActiveCompPath: Dispatch<SetStateAction<string | null>>;
  handleSelectComposition: (comp: string) => void;
} {
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [activeCompPathHydrated, setActiveCompPathHydrated] = useState(
    () => initialUrlStateRef.current.activeCompPath == null,
  );

  useHydrateActiveCompPathFromUrl({
    hydrated: activeCompPathHydrated,
    fileTreeLoaded,
    fileTree,
    initialUrlStateRef,
    setActiveCompPath,
    setHydrated: setActiveCompPathHydrated,
  });

  const handleSelectComposition = useCompositionContentLoader({
    projectId,
    setEditingFile,
    setActiveCompPath,
    showToast,
  });

  useAutoOpenRootComposition({
    projectId,
    activeCompPath,
    activeCompPathHydrated,
    masterCompPath,
    initialUrlStateRef,
    setActiveCompPath,
    setActiveCompPathHydrated,
    onSelectComposition: handleSelectComposition,
  });

  return { activeCompPath, activeCompPathHydrated, setActiveCompPath, handleSelectComposition };
}
