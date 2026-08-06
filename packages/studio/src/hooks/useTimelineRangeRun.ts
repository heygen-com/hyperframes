import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AgentJob, AgentKind } from "../components/editor/agentGlyphs";
import { formatTime } from "../player/lib/time";
import { trackStudioEvent } from "../utils/studioTelemetry";

/**
 * Queue a run for a stretch of the timeline rather than one element.
 *
 * Same queue, same harness, same tray as a canvas edit: a range is just a
 * different way of saying which elements. Every element in the range travels
 * with it, so all of them light up on the canvas while the run works and the
 * tray can point back at the moment it was asked about.
 *
 * A range can also be scoped to one track, which is what makes "add a clip
 * here" answerable: the track travels with the request so the agent is not
 * left guessing which one a new clip belongs on.
 */
export interface TimelineRangeRun {
  start: number;
  end: number;
  prompt: string;
  instruction: string;
  elements: Array<{ id: string; selector?: string; sourceFile?: string }>;
  /** The authored track it is scoped to, when the user picked one. */
  track?: number;
}

export function useTimelineRangeRun({
  activeCompPath,
  projectIdRef,
  selectedAgentId,
  modelByKind,
  effortByKind,
  activeKindRef,
  showToast,
  setAgentJobs,
}: {
  activeCompPath: string | null;
  projectIdRef: RefObject<string | null>;
  selectedAgentId: string | null;
  modelByKind: Partial<Record<AgentKind, string>>;
  effortByKind: Partial<Record<AgentKind, string>>;
  activeKindRef: RefObject<AgentKind | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  setAgentJobs: Dispatch<SetStateAction<AgentJob[]>>;
}): (range: TimelineRangeRun) => void {
  return useCallback(
    (range: TimelineRangeRun) => {
      const pid = projectIdRef.current;
      if (!pid) return;

      const refs = range.elements.map((element) => ({
        sourceFile: element.sourceFile ?? activeCompPath ?? undefined,
        id: element.id,
        selector: element.selector ?? `#${element.id}`,
        time: range.start,
      }));
      trackStudioEvent("agent_run_submitted", {
        harness: activeKindRef.current ?? "unknown",
        model: activeKindRef.current
          ? (modelByKind[activeKindRef.current] ?? "default")
          : "default",
        elements: refs.length,
        instruction_length: range.instruction.length,
        source: "timeline",
      });

      const window = `${formatTime(range.start)}–${formatTime(range.end)}`;
      void fetch(`/api/projects/${pid}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: range.prompt,
          instruction: range.instruction,
          target: range.track === undefined ? window : `track ${range.track} · ${window}`,
          agent: selectedAgentId ?? undefined,
          model: activeKindRef.current ? modelByKind[activeKindRef.current] : undefined,
          effort: activeKindRef.current ? effortByKind[activeKindRef.current] : undefined,
          targetRef: refs[0] ?? { time: range.start, sourceFile: activeCompPath ?? undefined },
          targetRefs: refs.slice(1),
          targetKind: "range",
        }),
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string; job?: AgentJob };
          if (!response.ok || !data.job) {
            showToast(data.error ?? "Could not start the agent.", "error");
            return;
          }
          setAgentJobs((jobs) => [data.job as AgentJob, ...jobs]);
        })
        .catch((err: unknown) => {
          showToast(err instanceof Error ? err.message : "Could not start the agent.", "error");
        });
    },
    [
      activeCompPath,
      effortByKind,
      modelByKind,
      projectIdRef,
      selectedAgentId,
      showToast,
      activeKindRef,
      setAgentJobs,
    ],
  );
}
