import { useCallback, type RefObject } from "react";
import type { AgentJob } from "../components/editor/agentGlyphs";
import { trackStudioEvent } from "../utils/studioTelemetry";

/**
 * Everything that changes the run queue.
 *
 * These all say the same thing to the server in different words — reorder
 * this, stop that, answer the other — and they all end the same way, by taking
 * the queue the server hands back as the new truth. Kept apart from the
 * composer's own state so the queue's rules live in one place, and so a new
 * one (answering a question, most recently) does not grow a file that is
 * already the largest in the editor.
 */
export function useAgentQueue({
  projectId,
  projectIdRef,
  showToast,
  setAgentJobs,
  activeKindRef,
  onSteered,
}: {
  projectId: string | null;
  projectIdRef: RefObject<string | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  setAgentJobs: (jobs: AgentJob[]) => void;
  /** Which harness is active, for the analytics on these actions. */
  activeKindRef: RefObject<string | null>;
  /** Close the composer that was correcting this run. */
  onSteered: () => void;
}) {
  const patchAgentJobs = useCallback(
    (path: string, init: RequestInit) => {
      const pid = projectId ?? projectIdRef.current;
      if (!pid) return;
      void fetch(`/api/projects/${pid}/agent/jobs${path}`, init)
        .then(async (response) => {
          const data = (await response.json()) as { error?: string; jobs?: AgentJob[] };
          if (!response.ok) {
            showToast(data.error ?? "Could not update the queue.", "error");
            return;
          }
          setAgentJobs(data.jobs ?? []);
        })
        .catch(() => showToast("Could not update the queue.", "error"));
    },
    [projectId, projectIdRef, showToast, setAgentJobs],
  );

  /** One `PATCH` per way of changing a run, all shaped the same. */
  const patchJob = useCallback(
    (jobId: string, body: Record<string, unknown>) =>
      patchAgentJobs(`/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    [patchAgentJobs],
  );

  /** Reorder a waiting run; `position` indexes the queue, 0 is next up. */
  const moveAgentJob = useCallback(
    (jobId: string, position: number) => patchJob(jobId, { position }),
    [patchJob],
  );

  /**
   * Correct a run. A waiting one is amended before it starts; a running one is
   * stopped and resumed with the correction, so it keeps its own context.
   */
  const steerAgentJob = useCallback(
    (jobId: string, steer: string) => {
      onSteered();
      trackStudioEvent("agent_run_steered", { harness: activeKindRef.current ?? "unknown" });
      patchJob(jobId, { steer });
    },
    [patchJob, onSteered, activeKindRef],
  );

  /**
   * Make a waiting run the one that is happening. The server stops whatever
   * holds its element and starts it; nothing elsewhere is interrupted.
   */
  const promoteAgentJob = useCallback(
    (jobId: string) => {
      trackStudioEvent("agent_run_promoted", { harness: activeKindRef.current ?? "unknown" });
      patchJob(jobId, { promote: true });
    },
    [patchJob, activeKindRef],
  );

  /**
   * Answer the question a run stopped to ask.
   *
   * `optionId` is one the agent itself offered; the server refuses anything
   * else, so a tray still showing a question that has moved on cannot talk the
   * agent into something nobody chose.
   */
  const answerAgentJob = useCallback(
    (jobId: string, optionId: string) => {
      trackStudioEvent("agent_run_answered", { harness: activeKindRef.current ?? "unknown" });
      patchJob(jobId, { answer: optionId });
    },
    [patchJob, activeKindRef],
  );

  /** Drop a queued run, or stop one that is already going. */
  const cancelAgentJob = useCallback(
    (jobId: string) => patchAgentJobs(`/${jobId}`, { method: "DELETE" }),
    [patchAgentJobs],
  );

  const clearFinishedAgentJobs = useCallback(() => {
    const pid = projectIdRef.current;
    if (!pid) return;
    void fetch(`/api/projects/${pid}/agent/jobs`, { method: "DELETE" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { jobs?: AgentJob[] } | null) => setAgentJobs(data?.jobs ?? []))
      .catch(() => undefined);
  }, [projectIdRef, setAgentJobs]);

  return {
    moveAgentJob,
    steerAgentJob,
    promoteAgentJob,
    answerAgentJob,
    cancelAgentJob,
    clearFinishedAgentJobs,
  };
}
