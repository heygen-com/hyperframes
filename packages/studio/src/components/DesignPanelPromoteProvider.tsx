/**
 * Wires the Design panel's promote-to-variable context. Promote/bind operates
 * on the file the selected element actually lives in — a sub-composition file
 * when you select an element inside an inlined sub-comp, not the host. So we
 * open (and persist to) an SDK session keyed on `selection.sourceFile`, not the
 * host `activeCompPath`. Declaring a variable therefore lands in the sub-comp's
 * own file, making it a knob on that reusable frame everywhere it is used. When
 * nothing is selected (or the element is top-level) the target is the active
 * composition, so behavior there is unchanged.
 */

import type { ReactNode } from "react";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { useSdkSession } from "../hooks/useSdkSession";
import { useVariablesPersist, type UseVariablesPersistParams } from "../hooks/useVariablesPersist";
import { VariablePromoteProvider } from "../contexts/VariablePromoteContext";

/** Persist wiring minus the target — this provider derives the target from the selection. */
type PersistDeps = Omit<UseVariablesPersistParams, "sdkSession" | "activeCompPath">;

export function DesignPanelPromoteProvider({
  selection,
  projectId,
  activeCompPath,
  children,
  ...persistDeps
}: PersistDeps & {
  selection: DomEditSelection | null;
  projectId: string | null;
  activeCompPath: string | null;
  children: ReactNode;
}) {
  const targetPath = selection?.sourceFile || activeCompPath || "index.html";
  const handle = useSdkSession(projectId, targetPath, persistDeps.domEditSaveTimestampRef);
  const persist = useVariablesPersist({
    ...persistDeps,
    sdkSession: handle.session,
    activeCompPath: targetPath,
  });
  return (
    <VariablePromoteProvider session={handle.session} selection={selection} persist={persist}>
      {children}
    </VariablePromoteProvider>
  );
}
