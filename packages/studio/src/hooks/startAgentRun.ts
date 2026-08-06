import type { AgentJob } from "../components/editor/agentGlyphs";

/**
 * Ask the server to start a run, and take the job it hands back.
 *
 * Both ways of asking (one element on the canvas, a stretch of the timeline)
 * differ only in what they put in the body: the call, the failure handling and
 * what happens to the new job are the same, and were the same in two places
 * before this existed.
 */
export function startAgentRun({
  projectId,
  body,
  showToast,
  onStarted,
}: {
  projectId: string;
  body: Record<string, unknown>;
  showToast: (message: string, tone?: "error" | "info") => void;
  onStarted: (job: AgentJob) => void;
}): void {
  void fetch(`/api/projects/${projectId}/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (response) => {
      const data = (await response.json()) as { error?: string; job?: AgentJob };
      if (!response.ok || !data.job) {
        showToast(data.error ?? "Could not start the agent.", "error");
        return;
      }
      onStarted(data.job);
    })
    .catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : "Could not start the agent.", "error");
    });
}
