import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";

export function useGsapInteractionFailureTelemetry(
  activeCompPath: string | null,
  showToast: (message: string, tone?: "error" | "info") => void,
) {
  return useCallback(
    (error: unknown, selection: DomEditSelection, mutationType: string, label: string) => {
      trackStudioSaveFailure({
        source: "gsap_commit",
        error,
        filePath: selection.sourceFile ?? activeCompPath ?? "index.html",
        mutationType,
        label,
        targetId: selection.id,
        targetSelector: selection.selector,
        targetSourceFile: selection.sourceFile,
      });
      showToast("Failed to save animated edit.", "error");
    },
    [activeCompPath, showToast],
  );
}
