import { useMemo, type ComponentProps } from "react";
import { StudioLeftPanels } from "../components/StudioLeftPanels";
import { StudioRightPanels } from "../components/StudioRightPanels";
import { useStableHandlers } from "./useStableHandlers";

/** Both side panels as one element that changes only when a panel's data does, never for a new handler. */
export function useStudioSidePanels(
  left: ComponentProps<typeof StudioLeftPanels>,
  right: ComponentProps<typeof StudioRightPanels>,
) {
  const stableLeft = useStableHandlers(left);
  const stableRight = useStableHandlers(right);
  return useMemo(
    () => (
      <>
        <StudioLeftPanels {...stableLeft} />
        <StudioRightPanels {...stableRight} />
      </>
    ),
    [stableLeft, stableRight],
  );
}
