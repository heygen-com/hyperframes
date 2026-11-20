import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { mergeRenderHistory, readHiddenIds } from "./renderQueueHistory";
import type { RenderJob } from "./useRenderQueue";

async function fetchHistory(projectId: string): Promise<unknown[]> {
  const response = await studioApiFetch(buildProjectApiPath(projectId, "/renders"));
  if (!response.ok)
    throw new Error(`Couldn't load render history (server error ${response.status}).`);
  const data = await response.json();
  return Array.isArray(data.renders) ? data.renders : [];
}

function historyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("Couldn't load render history"))
    return error.message;
  return "Couldn't load render history. Is the studio server running?";
}

export function useRenderHistory(
  projectId: string | null,
  setJobs: Dispatch<SetStateAction<RenderJob[]>>,
) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const scope = useMemo(
    () => ({
      projectId,
      removed: new Set<string>(),
      removedFamilies: new Set<string>(),
      active: true,
    }),
    [projectId],
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const isCurrent = useCallback(() => scopeRef.current === scope && scope.active, [scope]);
  useEffect(() => {
    scope.active = true;
    setJobs([]);
    setLoadError(null);
    return () => {
      scope.active = false;
    };
  }, [scope, setJobs]);

  const loadRenders = useCallback(
    async (onlyId?: string) => {
      if (!projectId) return;
      try {
        const rows = await fetchHistory(projectId);
        if (!isCurrent()) return;
        if (!onlyId) setLoadError(null);
        if (rows.length === 0) return;
        setJobs((previous) => {
          const hidden = new Set([...readHiddenIds(projectId), ...scope.removed]);
          return isCurrent()
            ? mergeRenderHistory(previous, rows, hidden, scope.removedFamilies, onlyId)
            : previous;
        });
      } catch (error) {
        if (!isCurrent() || onlyId) return;
        setLoadError(historyErrorMessage(error));
      }
    },
    [projectId, scope, isCurrent, setJobs],
  );
  const reloadRenders = useCallback(() => loadRenders(), [loadRenders]);
  useEffect(() => {
    void loadRenders();
  }, [loadRenders]);
  return { loadError, loadRenders, reloadRenders, scope, isCurrent };
}
