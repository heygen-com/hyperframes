import type { StoryboardFrameView } from "../../hooks/useStoryboard";
import {
  AgentChatMessageButton,
  APPLY_STORYBOARD_FEEDBACK_MESSAGE,
} from "./AgentChatMessageButton";
import { FRAME_STATUS_META, FRAME_STATUS_ORDER } from "./frameStatus";
import {
  deriveStoryboardHandoffStep,
  deriveStoryboardReviewStage,
  type StoryboardHandoffStep,
  type StoryboardReviewStage,
} from "./storyboardReviewStage";

const GUIDE_COPY: Record<StoryboardReviewStage, { eyebrow: string; title: string; body: string }> =
  {
    empty: {
      eyebrow: "Waiting for a plan",
      title: "The storyboard has no frames yet",
      body: "Ask your agent to draft the story plan. Frames will appear here automatically.",
    },
    "plan-review": {
      eyebrow: "Ready for review",
      title: "Review the story plan",
      body: "Check the sequence, scene direction, and voiceover before visual work begins. Leave frame comments, save them, then reply in your terminal or IDE agent chat.",
    },
    "sketch-in-progress": {
      eyebrow: "Build in progress",
      title: "Visual sketches are in progress",
      body: "New posters appear automatically as your agent builds them. You can comment now; wait until no frames remain in Outline before approving the layouts.",
    },
    "sketch-review": {
      eyebrow: "Ready for review",
      title: "Review the visual direction",
      body: "Check composition, hierarchy, and copy. Save frame comments, then reply in your terminal or IDE agent chat.",
    },
    "animation-in-progress": {
      eyebrow: "Build in progress",
      title: "Animation is in progress",
      body: "The board refreshes as frames advance. Review completed frames now; the final review is ready when every frame is Animated.",
    },
    "final-review": {
      eyebrow: "Ready for review",
      title: "Review motion and timing",
      body: "Every frame is animated. Open a frame in Preview to review it in the timeline, or leave frame comments for another revision.",
    },
  };

const REVIEW_ACTION_COPY: Record<
  StoryboardReviewStage,
  { body: string; approvalMessage?: string }
> = {
  empty: { body: "Add comments as previews arrive." },
  "plan-review": {
    body: "Add comments where you want changes. If everything looks right, approve this pass in agent chat.",
    approvalMessage: "Approve this storyboard plan and continue to visual sketches.",
  },
  "sketch-in-progress": {
    body: "Add comments as previews arrive. You’ll be prompted to approve when this pass is ready.",
  },
  "sketch-review": {
    body: "Add comments where you want changes. If everything looks right, approve this pass in agent chat.",
    approvalMessage: "Approve these storyboard sketches and continue to animation.",
  },
  "animation-in-progress": {
    body: "Add comments as previews arrive. You’ll be prompted to approve when this pass is ready.",
  },
  "final-review": {
    body: "Add comments where you want changes. If everything looks right, approve this pass in agent chat.",
    approvalMessage: "Approve this final storyboard review and continue to rendering.",
  },
};

type ReviewStepOffset = -1 | 0 | 1;
const REVIEW_STEP_STATES: Record<
  ReviewStepOffset,
  {
    textClass: string;
    numberClass: string;
    ariaCurrent: "step" | undefined;
    marker: (number: StoryboardHandoffStep) => StoryboardHandoffStep | string;
  }
> = {
  [-1]: {
    textClass: "text-emerald-400",
    numberClass: "border-emerald-700 bg-emerald-500/10",
    ariaCurrent: undefined,
    marker: () => "✓",
  },
  [0]: {
    textClass: "text-sky-300",
    numberClass: "border-sky-500 bg-sky-500/15",
    ariaCurrent: "step",
    marker: (number) => number,
  },
  [1]: {
    textClass: "text-neutral-600",
    numberClass: "border-neutral-700",
    ariaCurrent: undefined,
    marker: (number) => number,
  },
};

const REVIEW_STEP_SEPARATOR_CLASS: Record<StoryboardHandoffStep, string> = {
  1: "invisible",
  2: "",
  3: "",
};

export interface StoryboardReviewGuideProps {
  frames: StoryboardFrameView[];
  draftCount: number;
  pendingCount: number;
  onFeedbackMessageCopied: () => void;
}

/** Stage-aware instructions plus the explicit Studio → agent handoff. */
export function StoryboardReviewGuide({
  frames,
  draftCount,
  pendingCount,
  onFeedbackMessageCopied,
}: StoryboardReviewGuideProps) {
  const summary = deriveStoryboardReviewStage(frames);
  const copy = GUIDE_COPY[summary.stage];
  const handoffStep = deriveStoryboardHandoffStep(draftCount, pendingCount);
  const progress = progressLabel(summary);

  return (
    <section className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
            {copy.eyebrow}
          </div>
          <h2 className="mt-0.5 text-sm font-semibold text-neutral-100">{copy.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">{copy.body}</p>
        </div>
        {summary.frameCount > 0 && (
          <div className="shrink-0">
            <div className="mb-1.5 text-right text-[11px] font-medium text-neutral-300">
              {progress}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5" aria-label="Frame status summary">
              {FRAME_STATUS_ORDER.map((status) => (
                <span
                  key={status}
                  className={`rounded px-2 py-1 text-[10px] font-medium ${FRAME_STATUS_META[status].chipClass}`}
                >
                  {summary.counts[status]} {FRAME_STATUS_META[status].label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {summary.frameCount > 0 && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <ReviewSteps current={handoffStep} />
          <NextAction
            stage={summary.stage}
            step={handoffStep}
            draftCount={draftCount}
            onFeedbackMessageCopied={onFeedbackMessageCopied}
          />
        </div>
      )}
    </section>
  );
}

function ReviewSteps({ current }: { current: StoryboardHandoffStep }) {
  const steps = ["Review frames", "Save feedback", "Reply in agent chat"];
  return (
    <ol className="hidden items-center gap-2 sm:flex" aria-label="Storyboard review workflow">
      {steps.map((label, index) => (
        <ReviewStep
          key={label}
          label={label}
          number={(index + 1) as StoryboardHandoffStep}
          current={current}
        />
      ))}
    </ol>
  );
}

function ReviewStep({
  label,
  number,
  current,
}: {
  label: string;
  number: StoryboardHandoffStep;
  current: StoryboardHandoffStep;
}) {
  const offset = Math.sign(number - current) as ReviewStepOffset;
  const state = REVIEW_STEP_STATES[offset];

  return (
    <li className="flex items-center gap-2">
      <span
        className={`text-neutral-700 ${REVIEW_STEP_SEPARATOR_CLASS[number]}`}
        aria-hidden="true"
      >
        →
      </span>
      <span
        aria-current={state.ariaCurrent}
        className={`flex items-center gap-1.5 text-[11px] font-medium ${state.textClass}`}
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${state.numberClass}`}
        >
          {state.marker(number)}
        </span>
        {label}
      </span>
    </li>
  );
}

function NextAction({
  stage,
  step,
  draftCount,
  onFeedbackMessageCopied,
}: {
  stage: StoryboardReviewStage;
  step: StoryboardHandoffStep;
  draftCount: number;
  onFeedbackMessageCopied: () => void;
}) {
  if (step === 3) {
    return <AgentHandoffAction onFeedbackMessageCopied={onFeedbackMessageCopied} />;
  }
  if (step === 2) return <SaveFeedbackAction draftCount={draftCount} />;
  return <ReviewFramesAction stage={stage} />;
}

function AgentHandoffAction({ onFeedbackMessageCopied }: { onFeedbackMessageCopied: () => void }) {
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-sky-900/70 bg-sky-950/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold text-sky-200">Next: return to your agent chat</div>
        <p className="mt-0.5 text-[11px] text-neutral-400">
          Feedback is saved, but the agent has not been notified. Paste this prompt in your terminal
          or IDE agent chat.
        </p>
      </div>
      <AgentChatMessageButton
        message={APPLY_STORYBOARD_FEEDBACK_MESSAGE}
        onCopied={onFeedbackMessageCopied}
      />
    </div>
  );
}

function SaveFeedbackAction({ draftCount }: { draftCount: number }) {
  return (
    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5">
      <div>
        <div className="text-xs font-semibold text-neutral-200">Next: save your feedback</div>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {draftCount} frame{draftCount === 1 ? " has" : "s have"} feedback ready. Use Save &amp;
          copy message above to prepare this batch for your agent.
        </p>
      </div>
    </div>
  );
}

function ReviewFramesAction({ stage }: { stage: StoryboardReviewStage }) {
  const copy = REVIEW_ACTION_COPY[stage];

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-xs font-semibold text-neutral-200">Next: review the frames</div>
        <p className="mt-0.5 text-[11px] text-neutral-500">{copy.body}</p>
      </div>
      {copy.approvalMessage && (
        <AgentChatMessageButton message={copy.approvalMessage} label="Copy approval message" />
      )}
    </div>
  );
}

// The label intentionally folds six workflow states into three user-facing progress formats.
// fallow-ignore-next-line complexity
function progressLabel(summary: ReturnType<typeof deriveStoryboardReviewStage>): string {
  if (summary.stage === "sketch-in-progress" || summary.stage === "sketch-review") {
    const ready = summary.frameCount - summary.counts.outline;
    return `${ready} of ${summary.frameCount} visual sketches ready`;
  }
  if (summary.stage === "animation-in-progress" || summary.stage === "final-review") {
    return `${summary.counts.animated} of ${summary.frameCount} animations ready`;
  }
  return `${summary.frameCount} plan frame${summary.frameCount === 1 ? "" : "s"} ready`;
}
