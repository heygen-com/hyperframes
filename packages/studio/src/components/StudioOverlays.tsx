import { memo, type ComponentProps } from "react";
import { LintModal } from "./LintModal";
import { AskAgentModal } from "./AskAgentModal";
import { StudioToast } from "./StudioToast";
import { StudioFeedbackCard } from "./feedback/StudioFeedbackCard";
import { buildAgentContextPreview } from "./editor/domEditingAgentPrompt";
import type { useDomEditSession } from "../hooks/useDomEditSession";
import type { useToast } from "../hooks/useToast";

type LintFindings = ComponentProps<typeof LintModal>["findings"];

interface StudioOverlaysProps {
  projectId: string;
  projectDir?: string | null;
  lintModal: LintFindings | null;
  closeLintModal: () => void;
  consoleErrors: LintFindings | null;
  clearConsoleErrors: () => void;
  domEditSession: ReturnType<typeof useDomEditSession>;
  activeCompPath: string | null;
  toasts: ReturnType<typeof useToast>["toasts"];
  dismissToast: (id: number) => void;
}

/**
 * Floating overlays for the studio shell: lint / console-error modals, the
 * ask-agent modal, and the toast. Extracted from
 * `App.tsx` to keep the shell within the studio's 600-line decomposition budget.
 */
// fallow-ignore-next-line complexity
export const StudioOverlays = memo(function StudioOverlays({
  projectId,
  projectDir,
  lintModal,
  closeLintModal,
  consoleErrors,
  clearConsoleErrors,
  domEditSession,
  activeCompPath,
  toasts,
  dismissToast,
}: StudioOverlaysProps) {
  return (
    <>
      {lintModal !== null && (
        <LintModal
          findings={lintModal}
          projectId={projectId}
          projectDir={projectDir}
          onClose={closeLintModal}
        />
      )}
      {/* One modal at a time — console errors wait behind an open lint modal
          instead of stacking two full-screen overlays. */}
      {lintModal === null && consoleErrors !== null && consoleErrors.length > 0 && (
        <LintModal
          findings={consoleErrors}
          projectId={projectId}
          projectDir={projectDir}
          title="Console errors in preview"
          promptIntro="Fix these runtime console errors from the composition preview"
          onClose={clearConsoleErrors}
        />
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
      {/* Toasts centre in the room the feedback card leaves, so the two never cover each other. */}
      <div className="pointer-events-none absolute inset-x-6 bottom-6 z-91 flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 *:pointer-events-auto">
          {toasts.map((toast) => (
            <StudioToast
              key={toast.id}
              message={toast.message}
              tone={toast.tone}
              onDismiss={() => dismissToast(toast.id)}
            />
          ))}
        </div>
        <div className="pointer-events-auto">
          <StudioFeedbackCard />
        </div>
      </div>
    </>
  );
});
