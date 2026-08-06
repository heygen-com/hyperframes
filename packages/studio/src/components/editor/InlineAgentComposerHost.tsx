import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { dismissAnswer, isAnswerDismissed } from "../../utils/agentAnswers";
import { agentDraftKey } from "../../utils/agentDrafts";
import { AgentAnswerBubble } from "./AgentAnswerBubble";
import type { AgentJob } from "./agentGlyphs";
import { AgentOverlayState } from "./AgentOverlayState";
import { AgentRunTray } from "./AgentRunTray";
import {
  COMPOSER_HEIGHT,
  COMPOSER_WIDTH,
  layoutAgentSurfaces,
  resolveComposerPosition,
} from "./agentSurfaceLayout";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { AskAgentHandle, InlineAgentComposer } from "./InlineAgentComposer";
import { answerForSelection } from "./overlayState";
import { useOverlayState } from "./useOverlayState";

/** Stable empty list for mounts with no project, so the hook sees no churn. */
const EMPTY_JOBS: AgentJob[] = [];

/**
 * Canvas-side connector: renders the composer over the selected element while
 * the agent session is open, and the run tray whenever this project has runs.
 * Reads the DomEdit contexts directly so the overlay doesn't thread agent props
 * through its own signature; returns null in standalone player mounts, which
 * have no project to edit.
 */
export function InlineAgentComposerHost({
  rect,
  canvas,
  overlayEl,
}: {
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
  /** The canvas overlay these coordinates are relative to. */
  overlayEl: HTMLElement | null;
}) {
  const [dismissedAnswers, setDismissedAnswers] = useState<string[]>([]);
  // Answers are for runs this tab watched finish. History is restored from disk
  // on load, and a bubble about yesterday's edit is noise, not an answer.
  const [listeningSince] = useState(() => Date.now());
  const actions = useDomEditActionsContextOptional();
  const selectionValue = useDomEditSelectionContextOptional();
  // What the agent is doing to this element right now, painted on the element
  // rather than only in the tray. Read before the standalone-player bail-out:
  // it owns a timer, and a hook cannot sit behind a conditional return.
  const overlayState = useOverlayState(
    selectionValue?.agentJobs ?? EMPTY_JOBS,
    selectionValue?.domEditSelection ?? null,
  );
  if (!actions || !selectionValue) return null;

  // Drawn in the document, not inside the canvas overlay: that overlay is a
  // z-10 stacking context and its sibling motion path sits at z-40, so nothing
  // rendered within it can come out on top however high its own z-index is.
  const origin = overlayEl?.getBoundingClientRect();
  const toViewport = (style: CSSProperties): CSSProperties => ({
    ...style,
    position: "fixed",
    left: typeof style.left === "number" ? style.left + (origin?.left ?? 0) : style.left,
    top: typeof style.top === "number" ? style.top + (origin?.top ?? 0) : style.top,
    zIndex: 70,
  });

  const {
    projectId,
    domEditSelection,
    domEditGroupSelections,
    agentModalOpen,
    agentRunLabel,
    agentRunKind,
    agentIconUrl,
    agentIconUrlById,
    agentOptions,
    agentModels,
    selectedModel,
    selectedEffort,
    agentJobs,
    steeringJob,
  } = selectionValue;

  // The newest finished run about the element in front of the user: an answer
  // belongs next to what it is about, not only in a list they may never open.
  const answer =
    answerForSelection(agentJobs, domEditSelection, {
      since: listeningSince,
      isDismissed: (jobId) => dismissedAnswers.includes(jobId) || isAnswerDismissed(jobId),
    }) ?? undefined;

  // The composer picks its own spot — beside the element, at its top right —
  // and the bubble is placed around whatever that turned out to be, so the two
  // never land on top of each other.
  const composerOpen = agentModalOpen && (domEditSelection || steeringJob);
  const composerAt =
    rect && composerOpen
      ? (resolveComposerPosition(rect, canvas, COMPOSER_HEIGHT) as { left: number; top: number })
      : null;
  const surfaces =
    rect && (answer || composerOpen)
      ? layoutAgentSurfaces({
          rect,
          canvas,
          composer: composerAt
            ? { ...composerAt, width: COMPOSER_WIDTH, height: COMPOSER_HEIGHT }
            : null,
          bubble: answer ? { width: 268, height: 108 } : null,
        })
      : {};

  return createPortal(
    <>
      {overlayState && rect && (
        <AgentOverlayState
          state={overlayState}
          rect={rect}
          toContainerStyle={toViewport}
          // The badge takes whichever side neither the composer nor the answer
          // bubble is using, so three surfaces about one element never stack.
          pillSide={
            surfaces.composer?.side === "above" || surfaces.bubble?.side === "above"
              ? "below"
              : "above"
          }
        />
      )}
      {!agentModalOpen && domEditSelection && (
        <AskAgentHandle
          toContainerStyle={toViewport}
          rect={rect}
          canvas={canvas}
          agentKind={agentRunKind}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          label={agentRunLabel ?? "the agent"}
          onOpen={actions.handleAskAgent}
        />
      )}
      {answer && rect && (
        <AgentAnswerBubble
          job={answer}
          rect={rect}
          canvas={canvas}
          placement={surfaces.bubble}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          toContainerStyle={toViewport}
          onDismiss={() => {
            dismissAnswer(answer.id);
            setDismissedAnswers((ids) => [...ids, answer.id]);
          }}
          onFollowUp={() => {
            dismissAnswer(answer.id);
            setDismissedAnswers((ids) => [...ids, answer.id]);
            actions.handleAskAgent();
          }}
        />
      )}
      {agentModalOpen && (domEditSelection || steeringJob) && (
        <InlineAgentComposer
          toContainerStyle={toViewport}
          placement={surfaces.composer}
          selectionLabel={
            domEditGroupSelections.length > 1
              ? `${domEditGroupSelections.length} elements`
              : (domEditSelection?.label ?? steeringJob?.target ?? "this run")
          }
          // A steer belongs to its run, not to whatever is selected: keeping
          // its own draft key means a correction cannot land in the element's
          // half-typed instruction, or the other way round.
          draftKey={
            steeringJob
              ? `steer:${steeringJob.id}`
              : agentDraftKey({
                  projectId,
                  sourceFile: domEditSelection?.sourceFile,
                  selector: domEditSelection?.selector,
                  selectorIndex: domEditSelection?.selectorIndex,
                  id: domEditSelection?.id,
                })
          }
          rect={rect}
          canvas={canvas}
          runLabel={agentRunLabel}
          agentKind={agentRunKind}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          agentOptions={agentOptions}
          agentModels={agentModels}
          selectedModel={selectedModel}
          selectedEffort={selectedEffort}
          onSelectAgent={(id) => {
            actions.setSelectedAgentId(id);
            void actions.refreshAgentModels(id);
          }}
          onAddCustomAgent={actions.addCustomAgent}
          onSelectModel={(model) => {
            if (agentRunKind) actions.setSelectedModel(agentRunKind, model);
          }}
          onSelectEffort={(effort) => {
            if (agentRunKind) actions.setSelectedEffort(agentRunKind, effort);
          }}
          onRun={actions.handleAgentModalRun}
          onCopy={(instruction) => void actions.handleAgentModalSubmit(instruction)}
          steeringJob={steeringJob}
          onSteer={actions.steerAgentJob}
          onCancelSteer={actions.cancelSteerJob}
          onClose={() => {
            actions.cancelSteerJob();
            actions.setAgentModalOpen(false);
            actions.setAgentPromptSelectionContext(undefined);
          }}
        />
      )}
      <AgentRunTray
        jobs={agentJobs}
        agentIconUrl={agentIconUrl}
        onClearFinished={actions.clearFinishedAgentJobs}
        onMoveJob={actions.moveAgentJob}
        onAnswerJob={actions.answerAgentJob}
        onSteerJob={actions.beginSteerJob}
        onPromoteJob={actions.promoteAgentJob}
        onCancelJob={actions.cancelAgentJob}
        onRevealTarget={actions.revealAgentJobTarget}
      />
    </>,
    document.body,
  );
}
