import { useEffect, useRef } from "react";
import { trackStudioEvent } from "../utils/studioTelemetry";

/** Reports `sdk_absent_read_recovery`: recovery is the path leaving `fileTree`, not a later read of it succeeding. */
export function useAbsentReadRecoveryTelemetry(
  projectId: string | null,
  fileTree: readonly string[],
  fileTreeLoaded: boolean,
) {
  const refreshedPathsRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    refreshedPathsRef.current.clear();
    pendingRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!fileTreeLoaded || pendingRef.current.size === 0) return;
    for (const [path, startedAt] of pendingRef.current) {
      if (fileTree.includes(path)) continue;
      pendingRef.current.delete(path);
      trackStudioEvent("sdk_absent_read_recovery", {
        stage: "tree_corrected",
        elapsed_ms: performance.now() - startedAt,
      });
    }
  }, [fileTree, fileTreeLoaded]);

  /** No-ops without `onAbsentRead`, so a collaborator-less caller can't double-count. */
  function triggerOnce(path: string, onAbsentRead: ((path: string) => void) | undefined): void {
    if (!onAbsentRead) return;
    if (refreshedPathsRef.current.has(path)) return;
    refreshedPathsRef.current.add(path);
    pendingRef.current.set(path, performance.now());
    trackStudioEvent("sdk_absent_read_recovery", { stage: "triggered" });
    onAbsentRead(path);
  }

  return { triggerOnce };
}
