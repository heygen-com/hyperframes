import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { trackStudioRenderStart } from "../../telemetry/events";

export interface RenderJob {
  id: string;
  status: "rendering" | "complete" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  error?: string;
  filename: string;
  createdAt: number;
  durationMs?: number;
}

// Mirrors `CanvasResolution` from @hyperframes/core. Kept local because
// studio's tsconfig doesn't include node types, and the core barrel
// transitively pulls in modules with `node:fs` imports. Drift risk is
// low (6 string literals kept in sync manually with CANVAS_DIMENSIONS).
export type ResolutionPreset =
  | "landscape"
  | "portrait"
  | "landscape-4k"
  | "portrait-4k"
  | "square"
  | "square-4k";

export interface StartRenderOptions {
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
  /** `"auto"` (default) renders at the composition's authored dimensions. */
  resolution?: ResolutionPreset | "auto";
  /** Render a specific composition file instead of index.html. */
  composition?: string;
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
            .map(
              (r: {
                id: string;
                filename: string;
                createdAt: number;
                size: number;
                status?: string;
                durationMs?: number;
              }) => ({
                id: r.id,
                status: (r.status === "failed" ? "failed" : "complete") as "complete" | "failed",
                progress: 100,
                filename: r.filename,
                createdAt: r.createdAt,
                durationMs: r.durationMs,
              }),
            );
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
    async (opts: StartRenderOptions = {}) => {
      if (!projectId) return;

      const fps = opts.fps ?? 30;
      const quality = opts.quality ?? "standard";
      const format = opts.format ?? "mp4";
      const resolution = opts.resolution;
      const composition = opts.composition;

      trackStudioRenderStart({
        fps,
        quality,
        format,
        resolution,
        composition,
      });

      const startTime = Date.now();
      // "auto" / undefined means "render at the composition's authored size".
      // Omit the field entirely — sending "auto" would trip the route's
      // enum validation set.
      const body: {
        fps: number;
        quality: string;
        format: string;
        resolution?: string;
        composition?: string;
      } = {
        fps,
        quality,
        format,
      };
      if (resolution && resolution !== "auto") body.resolution = resolution;
      if (composition) body.composition = composition;
      let res: Response;
      try {
        res = await fetch(`/api/projects/${projectId}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        const failedJob: RenderJob = {
          id: crypto.randomUUID(),
          status: "failed",
          progress: 0,
          error: "Could not reach render server. Use `hyperframes render` from the CLI instead.",
          filename: "Export failed",
          createdAt: startTime,
        };
        setJobs((prev) => [...prev, failedJob]);
        return;
      }
      if (!res.ok) {
        const failedJob: RenderJob = {
          id: crypto.randomUUID(),
          status: "failed",
          progress: 0,
          error: `Server error (${res.status}). Check the terminal for details.`,
          filename: "Export failed",
          createdAt: startTime,
        };
        setJobs((prev) => [...prev, failedJob]);
        return;
      }
      const { jobId } = await res.json();

      const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };
      const ext = FORMAT_EXT[format] ?? ".mp4";
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
                    error: data.error ?? j.error,
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
            j.id === jobId && j.status === "rendering"
              ? {
                  ...j,
                  status: "failed" as const,
                  error: "Connection lost. Is the render server running?",
                }
              : j,
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

  const isRendering = jobs.some((j) => j.status === "rendering");
  return useMemo(
    () => ({
      jobs,
      isRendering,
      deleteRender,
      clearCompleted,
      startRender: startRender as (options: unknown) => Promise<void>,
    }),
    [jobs, isRendering, deleteRender, clearCompleted, startRender],
  );
}
