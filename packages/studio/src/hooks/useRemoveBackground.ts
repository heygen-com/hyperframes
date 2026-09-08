import { useCallback, useEffect, useRef } from "react";
import { waitForMediaJob } from "../components/studioMediaJobs";
import type { BackgroundRemovalProgress } from "../components/editor/propertyPanelTypes";

interface RemoveBackgroundOptions {
  createBackgroundPlate?: boolean;
  quality?: "fast" | "balanced" | "best";
  onProgress?: (progress: BackgroundRemovalProgress) => void;
}

/**
 * Await one accepted job and report it, releasing the in-flight controller
 * whichever way it ends.
 *
 * A plain function rather than a `try`/`finally` inside the hook's callback:
 * the React Compiler cannot reorder across a `finally` and declines the whole
 * function. `release` is called on success, on failure, and on abort.
 */
async function awaitRemoval(
  jobId: string,
  options: RemoveBackgroundOptions,
  signal: AbortSignal,
  release: () => void,
  refreshFileTree: () => Promise<void>,
  showToast: (message: string, kind?: "info" | "error") => void,
) {
  try {
    const result = await waitForMediaJob(jobId, options.onProgress, signal);
    await refreshFileTree();
    showToast(`Created transparent asset: ${result.outputPath.split("/").pop()}`, "info");
    return result;
  } finally {
    release();
  }
}

/**
 * One removal in flight at a time: starting a second one aborts whichever job
 * is still running, so a stale progress callback can't overwrite a newer
 * result. Unmounting aborts too, or the job would keep running against a
 * panel that is no longer there to show its progress.
 */
export function useRemoveBackground(
  projectId: string,
  refreshFileTree: () => Promise<void>,
  showToast: (message: string, kind?: "info" | "error") => void,
) {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  return useCallback(
    // fallow-ignore-next-line complexity
    async (inputPath: string, options: RemoveBackgroundOptions) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/media/remove-background`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputPath,
            createBackgroundPlate: options.createBackgroundPlate === true,
            quality: options.quality ?? "balanced",
          }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!response.ok || !data.jobId) {
        throw new Error(data.error || `Background removal failed (${response.status})`);
      }
      showToast("Removing background...", "info");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return awaitRemoval(
        data.jobId,
        options,
        controller.signal,
        () => {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        },
        refreshFileTree,
        showToast,
      );
    },
    [projectId, refreshFileTree, showToast],
  );
}
