// Composition drill-down stack management for NLEContext/EditorShell
import { useState, useCallback, useRef, useEffect } from "react";
import { usePlayerStore } from "../../player";
import type { CompositionLevel } from "./CompositionBreadcrumb";
import { encodePreviewPath } from "../../player/components/thumbnailUtils";

interface UseCompositionStackOptions {
  projectId: string;
  activeCompositionPath?: string | null;
  onCompositionChange?: (compositionPath: string | null) => void;
}

interface UseCompositionStackResult {
  compositionStack: CompositionLevel[];
  updateCompositionStack: React.Dispatch<React.SetStateAction<CompositionLevel[]>>;
  handleNavigateComposition: (index: number) => void;
  handleDrillDown: (element: { id: string; compositionSrc?: string }) => void;
  masterSeekRef: React.MutableRefObject<number>;
  compIdToSrc: Map<string, string>;
  setCompIdToSrc: React.Dispatch<React.SetStateAction<Map<string, string>>>;
}

export function useCompositionStack({
  projectId,
  activeCompositionPath,
  onCompositionChange,
}: UseCompositionStackOptions): UseCompositionStackResult {
  const [compositionStack, setCompositionStack] = useState<CompositionLevel[]>([
    {
      id: "master",
      label: "Master",
      previewUrl: `/api/projects/${projectId}/preview`,
    },
  ]);

  const onCompositionChangeRef = useRef(onCompositionChange);
  onCompositionChangeRef.current = onCompositionChange;

  const updateCompositionStack: typeof setCompositionStack = useCallback((action) => {
    setCompositionStack((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      const id = next[next.length - 1]?.id;
      queueMicrotask(() => onCompositionChangeRef.current?.(id === "master" ? null : id));
      return next;
    });
  }, []);

  const masterSeekRef = useRef(0);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());

  const compIdToSrcRef = useRef(compIdToSrc);
  compIdToSrcRef.current = compIdToSrc;

  const handleNavigateComposition = useCallback(
    (index: number) => {
      if (index === 0 && masterSeekRef.current > 0) {
        usePlayerStore.getState().setCurrentTime(masterSeekRef.current);
      }
      usePlayerStore.getState().setElements([]);
      updateCompositionStack((prev) => prev.slice(0, index + 1));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDrillDown = useCallback(
    (element: { id: string; compositionSrc?: string }) => {
      if (!element.compositionSrc) return;
      masterSeekRef.current = usePlayerStore.getState().currentTime;

      const compId = element.id;
      let resolvedPath = compIdToSrcRef.current.get(compId);

      if (!resolvedPath) {
        const src = element.compositionSrc;
        const compMatch = src.match(/compositions\/.*\.html/);
        resolvedPath = compMatch ? compMatch[0] : src;
      }

      usePlayerStore.getState().setElements([]);

      updateCompositionStack((prev) => {
        const currentId = prev[prev.length - 1].id;
        if (currentId === resolvedPath && prev.length > 1) {
          return prev.slice(0, -1);
        }
        const label =
          resolvedPath
            .split("/")
            .pop()
            ?.replace(/\.html$/, "") || resolvedPath;
        const previewUrl = `/api/projects/${projectId}/preview/comp/${encodePreviewPath(resolvedPath)}`;
        return [...prev, { id: resolvedPath, label, previewUrl }];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  // Navigate to a composition when activeCompositionPath changes.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const master: CompositionLevel = {
      id: "master",
      label: "Master",
      previewUrl: `/api/projects/${projectId}/preview`,
    };
    if (activeCompositionPath === "index.html") {
      usePlayerStore.getState().setElements([]);
      updateCompositionStack([master]);
    } else if (activeCompositionPath && activeCompositionPath.startsWith("compositions/")) {
      const label = activeCompositionPath.replace(/^compositions\//, "").replace(/\.html$/, "");
      const previewUrl = `/api/projects/${projectId}/preview/comp/${encodePreviewPath(activeCompositionPath)}`;
      usePlayerStore.getState().setElements([]);
      updateCompositionStack((prev) => {
        if (prev[prev.length - 1]?.id === activeCompositionPath) return prev;
        return [master, { id: activeCompositionPath, label, previewUrl }];
      });
    } else if (!activeCompositionPath) {
      usePlayerStore.getState().setElements([]);
      updateCompositionStack([master]);
    }
  }, [activeCompositionPath, projectId, updateCompositionStack]);

  return {
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown,
    masterSeekRef,
    compIdToSrc,
    setCompIdToSrc,
  };
}
