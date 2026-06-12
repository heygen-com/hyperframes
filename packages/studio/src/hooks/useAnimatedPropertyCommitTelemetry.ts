import { useCallback } from "react";
import { useStudioContext } from "../contexts/StudioContext";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";

type CommitAnimatedProperty = (
  selection: DomEditSelection,
  property: string,
  value: number,
) => Promise<void>;

export function useAnimatedPropertyCommitTelemetry(
  onCommitAnimatedProperty: CommitAnimatedProperty | undefined,
) {
  const { showToast } = useStudioContext();

  const commitAnimatedPropertyWithTelemetry = useCallback(
    async (selection: DomEditSelection, property: string, value: number) => {
      if (!onCommitAnimatedProperty) return;
      try {
        await onCommitAnimatedProperty(selection, property, value);
      } catch (error) {
        trackStudioSaveFailure({
          source: "animated_property",
          error,
          filePath: selection.sourceFile ?? undefined,
          mutationType: property,
          label: `Edit ${property}`,
          targetId: selection.id,
          targetSelector: selection.selector,
          targetSourceFile: selection.sourceFile,
        });
        showToast?.("Failed to save animated property.", "error");
      }
    },
    [onCommitAnimatedProperty, showToast],
  );

  const commitAnimatedPropertySafely = useCallback(
    (selection: DomEditSelection, property: string, value: number) => {
      void commitAnimatedPropertyWithTelemetry(selection, property, value);
    },
    [commitAnimatedPropertyWithTelemetry],
  );

  return { commitAnimatedPropertySafely, commitAnimatedPropertyWithTelemetry };
}
