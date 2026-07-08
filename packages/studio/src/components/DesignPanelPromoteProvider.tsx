/**
 * Wires the Design panel's promote-to-variable context: instantiates the
 * single-writer variables persist path and feeds it to VariablePromoteProvider,
 * so schema edits from Design-panel controls (declare + bind, or edit a bound
 * variable's default) flow through the same path the Variables tab uses.
 */

import type { ReactNode } from "react";
import type { DomEditSelection } from "./editor/domEditingTypes";
import { useVariablesPersist, type UseVariablesPersistParams } from "../hooks/useVariablesPersist";
import { VariablePromoteProvider } from "../contexts/VariablePromoteContext";

export function DesignPanelPromoteProvider({
  selection,
  children,
  ...persistParams
}: UseVariablesPersistParams & {
  selection: DomEditSelection | null;
  children: ReactNode;
}) {
  const persist = useVariablesPersist(persistParams);
  return (
    <VariablePromoteProvider
      session={persistParams.sdkSession}
      selection={selection}
      persist={persist}
    >
      {children}
    </VariablePromoteProvider>
  );
}
