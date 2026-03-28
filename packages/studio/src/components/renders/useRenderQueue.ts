import { useState, useEffect, useCallback, useRef } from "react";

export interface RenderJob {
  id: string;
  status: "rendering" | "complete" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  filename: string;
  createdAt: number;
  durationMs?: number;
}

export function useRenderQueue(projectId: string | null) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobRef = useRef<string | null>(null);

  // Load completed renders from the server
  const loadRenders = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/renders`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.renders)) {
        setJobs((prev) => {
          const existing = new Set(prev.map((j) => j.id));
          const fromServer: RenderJob[] = data.renders
            .filter((r: { id: string }) => !existing.has(r.id))
            .map((r: { id: string; filename: string; createdAt: number; size: number }) => ({
              id: r.id,
              status: "complete" as const,
              progress: 100,
              filename: r.filename,
              createdAt: r.createdAt,
            }));
          return [...prev, ...fromServer];
        });
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    loadRenders();
  }, [loadRenders]);

  // Start a render and track progress via SSE
  const startRender = useCallback(
    async (fps = 30, quality = "standard", format: "mp4" | "webm" = "mp4") => {
      if (!projectId) return;

      const startTime = Date.now();
      const res = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fps, quality, format }),
      });
      if (!res.ok) return;
      const { jobId } = await res.json();

      const ext = format === "webm" ? ".webm" : ".mp4";
      const job: RenderJob = {
        id: jobId,
        status: "rendering",
        progress: 0,
        filename: `${jobId}${ext}`,
        createdAt: startTime,
      };
      setJobs((prev) => [...prev, job]);
      activeJobRef.current = jobId;

      // Track progress via SSE
      const es = new EventSource(`/api/render/${jobId}/progress`);
      eventSourceRef.current = es;

      es.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    progress: data.progress ?? j.progress,
                    stage: data.stage ?? data.message ?? j.stage,
                    status:
                      data.status === "complete"
                        ? "complete"
                        : data.status === "failed"
                          ? "failed"
                          : j.status,
                    durationMs: data.status === "complete" ? Date.now() - startTime : undefined,
                  }
                : j,
            ),
          );
          if (data.status === "complete" || data.status === "failed") {
            es.close();
            activeJobRef.current = null;
          }
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        es.close();
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId && j.status === "rendering" ? { ...j, status: "failed" } : j,
          ),
        );
        activeJobRef.current = null;
      };

      return jobId;
    },
    [projectId],
  );

  const deleteRender = useCallback(async (jobId: string) => {
    try {
      await fetch(`/api/render/${jobId}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const clearCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === "rendering"));
  }, []);

  // Clean up EventSource on unmount or projectId change
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [projectId]);

  return {
    jobs,
    startRender,
    deleteRender,
    clearCompleted,
    isRendering: jobs.some((j) => j.status === "rendering"),
  };
}
