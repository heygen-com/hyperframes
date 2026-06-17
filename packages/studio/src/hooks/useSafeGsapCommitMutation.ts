import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { getStudioSaveErrorMessage, trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import type { CommitMutation, CommitMutationOptions } from "./gsapScriptCommitTypes";

type TrackGsapSaveFailure = (
  error: unknown,
  selection: DomEditSelection,
  mutation: Record<string, unknown>,
  label?: string,
) => void;

function getGsapMutationType(mutation: Record<string, unknown>): string {
  return typeof mutation.type === "string" ? mutation.type : "gsap";
}

export function useGsapSaveFailureTelemetry(activeCompPath: string | null): TrackGsapSaveFailure {
  return useCallback(
    (error, selection, mutation, label) => {
      trackStudioSaveFailure({
        source: "gsap_commit",
        error,
        filePath: selection.sourceFile ?? activeCompPath ?? "index.html",
        mutationType: getGsapMutationType(mutation),
        label,
        targetId: selection.id,
        targetSelector: selection.selector,
        targetSourceFile: selection.sourceFile,
      });
    },
    [activeCompPath],
  );
}

export function useSafeGsapCommitMutation(
  commitMutation: CommitMutation,
  trackGsapSaveFailure: TrackGsapSaveFailure,
  showToast?: (message: string, tone?: "error" | "info") => void,
) {
  return useCallback(
    (
      selection: DomEditSelection,
      mutation: Record<string, unknown>,
      options: CommitMutationOptions,
    ) => {
      void commitMutation(selection, mutation, options).catch((error) => {
        trackGsapSaveFailure(error, selection, mutation, options.label);
        showToast?.(`Couldn't save animation: ${getStudioSaveErrorMessage(error)}`, "error");
      });
    },
    [commitMutation, trackGsapSaveFailure, showToast],
  );
}
