import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { trackStudioRenderStart } from "../../telemetry/events";
import { getAnonymousId } from "../../telemetry/config";
import { generateId } from "../../utils/generateId";

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
  /**
   * Composition-variable overrides ({variableId: value}), forwarded to the
   * render route and injected as window.__hfVariables — the same channel
   * `hyperframes render --variables` uses.
   */
  variables?: Record<string, unknown>;
}

// "Hide" (formerly "Clear") is a view operation, not a delete: hidden ids are
// remembered here so hidden renders don't resurrect from the on-disk history
// on the next load. Per-project key so projects don't hide each other's rows.
function hiddenIdsKey(projectId: string): string {
  return `hf-studio-hidden-renders:${projectId}`;
}

function readHiddenIds(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(hiddenIdsKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHiddenIds(projectId: string, ids: Set<string>): void {
  try {
    // Cap the list so it doesn't grow unbounded across months of renders.
    window.localStorage.setItem(hiddenIdsKey(projectId), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* localStorage may be unavailable or full */
  }
}

export function useRenderQueue(projectId: string | null) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  // History fetch failure — distinguished from "no renders yet" so the panel
  // never shows a false empty state.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Failure of a user action (delete/cancel), surfaced inline in the panel.
  const [actionError, setActionError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobRef = useRef<string | null>(null);

  const closeActiveEventSource = useCallback((jobId?: string) => {
    if (jobId && activeJobRef.current !== jobId) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    activeJobRef.current = null;
  }, []);

  // Load completed renders from the server
  const loadRenders = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/renders`);
      if (!res.ok) {
        setLoadError(`Couldn't load render history (server error ${res.status}).`);
        return;
      }
      const data = await res.json();
      setLoadError(null);
      if (Array.isArray(data.renders)) {
        const hidden = readHiddenIds(projectId);
        setJobs((prev) => {
          const existing = new Set(prev.map((j) => j.id));
          const fromServer: RenderJob[] = data.renders
            .filter((r: { id: string }) => !existing.has(r.id) && !hidden.has(r.id))
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
      setLoadError("Couldn't load render history. Is the studio server running?");
    }
  }, [projectId]);

  useEffect(() => {
    loadRenders();
  }, [loadRenders]);

  // Start a render and track progress via SSE
  // Pre-existing branchy fetch/poll flow — the variables passthrough added one branch.
  const startRender = useCallback(
    // fallow-ignore-next-line complexity
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
        variables?: Record<string, unknown>;
        telemetryDistinctId: string;
      } = {
        fps,
        quality,
        format,
        // So the server-emitted render_complete/render_error is attributed to
        // this browser user (same id studio_* events use), making the render
        // funnel joinable. Matches studio_render_start fired just above.
        telemetryDistinctId: getAnonymousId(),
      };
      if (resolution && resolution !== "auto") body.resolution = resolution;
      if (composition) body.composition = composition;
      if (opts.variables && Object.keys(opts.variables).length > 0) {
        body.variables = opts.variables;
      }
      let res: Response;
      try {
        res = await fetch(`/api/projects/${projectId}/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        const failedJob: RenderJob = {
          id: generateId(),
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
          id: generateId(),
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
          const terminal =
            data.status === "complete" || data.status === "failed" || data.status === "cancelled";
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    progress: data.progress ?? j.progress,
                    stage: data.stage ?? data.message ?? j.stage,
                    status: terminal ? (data.status as RenderJob["status"]) : j.status,
                    durationMs: data.status === "complete" ? Date.now() - startTime : undefined,
                    error: data.error ?? j.error,
                  }
                : j,
            ),
          );
          if (terminal) {
            closeActiveEventSource(jobId);
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
    [projectId, closeActiveEventSource],
  );

  // Cancel an in-flight render. The job row stays (as "cancelled") so the
  // user sees the outcome; the SSE stream is closed either way.
  const cancelRender = useCallback(
    async (jobId: string) => {
      setActionError(null);
      closeActiveEventSource(jobId);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId && j.status === "rendering" ? { ...j, status: "cancelled" } : j,
        ),
      );
      try {
        const res = await fetch(`/api/render/${jobId}/cancel`, { method: "POST" });
        if (!res.ok && res.status !== 404) {
          setActionError("Couldn't cancel on the server — the render may still be running.");
          return;
        }
        // Reconcile with the status the route reports: if the render actually
        // finished (or failed) before the cancel landed, don't leave the row
        // stuck on the optimistic "cancelled" — reload to pick up the real
        // outcome (and the finished file's metadata).
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { status?: string } | null;
          if (body?.status && body.status !== "cancelled") {
            void loadRenders();
          }
        }
      } catch {
        setActionError("Couldn't reach the server to cancel — the render may still be running.");
      }
    },
    [closeActiveEventSource, loadRenders],
  );

  const deleteRender = useCallback(
    async (jobId: string) => {
      setActionError(null);
      closeActiveEventSource(jobId);
      try {
        const res = await fetch(`/api/render/${jobId}`, { method: "DELETE" });
        if (!res.ok) {
          setActionError("Couldn't delete the render — it's still on disk.");
          return;
        }
      } catch {
        setActionError("Couldn't reach the server to delete the render.");
        return;
      }
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    },
    [closeActiveEventSource],
  );

  // Hide finished rows from the list (view-only — files stay on disk and can
  // be recovered from the renders/ directory). Remembered per project so the
  // rows don't resurrect from history on reload.
  const clearCompleted = useCallback(() => {
    setJobs((prev) => {
      const finished = prev.filter((j) => j.status !== "rendering");
      if (projectId && finished.length > 0) {
        const hidden = readHiddenIds(projectId);
        for (const j of finished) hidden.add(j.id);
        writeHiddenIds(projectId, hidden);
      }
      return prev.filter((j) => j.status === "rendering");
    });
  }, [projectId]);

  const dismissActionError = useCallback(() => setActionError(null), []);

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
      loadError,
      actionError,
      dismissActionError,
      reloadRenders: loadRenders,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender: startRender as (options: unknown) => Promise<void>,
    }),
    [
      jobs,
      isRendering,
      loadError,
      actionError,
      dismissActionError,
      loadRenders,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender,
    ],
  );
}
