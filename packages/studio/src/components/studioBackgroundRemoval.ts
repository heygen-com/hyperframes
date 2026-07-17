import { waitForMediaJob } from "./studioMediaJobs";
import type {
  BackgroundRemovalProgress,
  BackgroundRemovalResult,
} from "./editor/propertyPanelTypes";

/**
 * POST a background-removal job for `inputPath`, then poll it to completion
 * via `waitForMediaJob`. Aborts any in-flight removal tracked by
 * `abortRef` before starting a new one (only one removal proceeds at a time).
 */
// fallow-ignore-next-line complexity
export async function removeBackgroundViaApi(
  projectId: string,
  inputPath: string,
  options: {
    createBackgroundPlate?: boolean;
    quality?: "fast" | "balanced" | "best";
    onProgress?: (progress: BackgroundRemovalProgress) => void;
  },
  deps: {
    refreshFileTree: () => Promise<void>;
    showToast: (message: string, kind: "info" | "error") => void;
    abortRef: { current: AbortController | null };
  },
): Promise<BackgroundRemovalResult> {
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
  deps.showToast("Removing background...", "info");
  deps.abortRef.current?.abort();
  const controller = new AbortController();
  deps.abortRef.current = controller;
  try {
    const result = await waitForMediaJob(data.jobId, options.onProgress, controller.signal);
    await deps.refreshFileTree();
    deps.showToast(`Created transparent asset: ${result.outputPath.split("/").pop()}`, "info");
    return result;
  } finally {
    if (deps.abortRef.current === controller) {
      deps.abortRef.current = null;
    }
  }
}
