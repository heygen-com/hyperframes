import type { ComponentProps } from "react";
import { LintModal } from "./LintModal";
import { AskAgentModal } from "./AskAgentModal";
import { StudioGlobalDragOverlay } from "./StudioGlobalDragOverlay";
import { StudioToast } from "./StudioToast";
import { buildAgentContextPreview } from "./editor/domEditingAgentPrompt";
import type { useDomEditSession } from "../hooks/useDomEditSession";
import type { useToast } from "../hooks/useToast";

type LintFindings = ComponentProps<typeof LintModal>["findings"];

export interface StudioOverlaysProps {
  projectId: string;
  lintModal: LintFindings | null;
  closeLintModal: () => void;
  consoleErrors: LintFindings | null;
  clearConsoleErrors: () => void;
  domEditSession: ReturnType<typeof useDomEditSession>;
  activeCompPath: string | null;
  dragOverlayActive: boolean;
  appToast: ReturnType<typeof useToast>["appToast"];
  dismissToast: () => void;
}

/**
 * Floating overlays for the studio shell: lint / console-error modals, the
 * ask-agent modal, the global drag overlay, and the toast. Extracted from
 * `App.tsx` to keep the shell within the studio's 600-line decomposition budget.
 */
// fallow-ignore-next-line complexity
export function StudioOverlays({
  projectId,
  lintModal,
  closeLintModal,
  consoleErrors,
  clearConsoleErrors,
  domEditSession,
  activeCompPath,
  dragOverlayActive,
  appToast,
  dismissToast,
}: StudioOverlaysProps) {
  return (
    <>
      {lintModal !== null && (
        <LintModal findings={lintModal} projectId={projectId} onClose={closeLintModal} />
      )}
      {consoleErrors !== null && consoleErrors.length > 0 && (
        <LintModal findings={consoleErrors} projectId={projectId} onClose={clearConsoleErrors} />
      )}
      {domEditSession.agentModalOpen && domEditSession.domEditSelection && (
        <AskAgentModal
          selectionLabel={domEditSession.domEditSelection.label}
          contextPreview={buildAgentContextPreview(domEditSession.domEditSelection, activeCompPath)}
          anchorPoint={domEditSession.agentModalAnchorPoint}
          onSubmit={domEditSession.handleAgentModalSubmit}
          onClose={() => {
            domEditSession.setAgentModalOpen(false);
            domEditSession.setAgentPromptSelectionContext(undefined);
            domEditSession.setAgentModalAnchorPoint(null);
          }}
        />
      )}
      {dragOverlayActive && <StudioGlobalDragOverlay />}
      {appToast && (
        <StudioToast message={appToast.message} tone={appToast.tone} onDismiss={dismissToast} />
      )}
    </>
  );
}
