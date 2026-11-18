import { buildProjectApiPath } from "../../utils/projectRouting";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { CanvasResolution } from "@hyperframes/parsers";
import { trackStudioRenderStart } from "../../telemetry/events";
import { getAnonymousId } from "../../telemetry/config";
import { browserTelemetryAllowed } from "../../telemetry/policy";
import { generateId } from "../../utils/generateId";
import { readServerError } from "./serverError";
import { ffmpegInstallMessage, useFfmpegStatus } from "./useFfmpegStatus";
import { requestStudioFeedback, type FeedbackContext } from "../feedback/feedbackTrigger";
import { studioApiFetch } from "../../utils/studioApiFetch";
import type { StudioRenderFormat } from "./renderSettings";
import {
  cancelledRenderOutcome,
  readHiddenIds,
  removeDeletedRenderFamily,
  renderQueueFamilyKey,
  upsertSessionRender,
  writeHiddenIds,
} from "./renderQueueHistory";
import { useRenderHistory } from "./useRenderHistory";

export interface RenderJob {
  id: string;
  status: "rendering" | "complete" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  error?: string;
  filename: string;
  createdAt: number;
  durationMs?: number;
  /** `"directory"` for PNG-sequence output: no inline preview, downloads as a ZIP. */
  kind?: "file" | "directory";
  frameCount?: number;
  size?: number;
  audioSidecar?: boolean;
}

// The CLI consumes this same source through @hyperframes/core's re-export.
// Importing from the browser-safe parsers package avoids the core barrel's
// Node-only transitive modules without duplicating the preset union in Studio.
export type ResolutionPreset = CanvasResolution;

export interface StartRenderOptions {
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: StudioRenderFormat;
  /** `"auto"` (default) renders at the composition's authored dimensions. */
  resolution?: ResolutionPreset | "auto";
  gpu?: boolean;
  gifLoop?: number;
  /**
   * Render a specific composition file. Omit it to render the composition the
   * user currently has open — only the sidebar's per-composition Render button
   * names one, because it renders a card the user is not looking at.
   */
  composition?: string;
  /**
   * Composition-variable overrides ({variableId: value}), forwarded to the
   * render route and injected as window.__hfVariables — the same channel
   * `hyperframes render --variables` uses.
   */
  variables?: Record<string, unknown>;
}

export function useRenderQueue(
  projectId: string | null,
  // A ref, not the value: the render target has to be read at click time, and
  // threading the value through would rebuild every callback below on each
  // composition switch.
  activeCompPathRef: { current: string | null },
) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const { loadError, loadRenders, reloadRenders, scope, isCurrent } = useRenderHistory(
    projectId,
    setJobs,
  );
  // Failure of a user action (delete/cancel), surfaced inline in the panel.
  const [actionError, setActionError] = useState<string | null>(null);
  // Owned here rather than in the panel: Studio renders from three places —
  // the panel's Export button, the header's, and each composition card in the
  // left sidebar — and a check living in one of them leaves the rest free to
  // start a render this machine cannot finish. Every caller routes through
  // `startRender`, so that is where the refusal belongs. Call sites still
  // read `ffmpegMissing` to put the prompt on screen, because a refusal the
  // user cannot see reads as a broken button.
  const { status: ffmpeg, checking: ffmpegChecking, recheck: recheckFfmpeg } = useFfmpegStatus();
  // A null status means the probe gave no answer (older server, failed
  // request), which is not evidence of a missing encoder. Unknown fails open.
  const ffmpegMissing = ffmpeg !== null && !ffmpeg.ok;
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobRef = useRef<string | null>(null);
  // Renders started in THIS tab, mapped to the settings they ran with.
  // `loadRenders` also injects finished jobs from disk history, and those must
  // never trigger a feedback prompt — the user did not just watch them happen.
  const sessionJobs = useRef(new Map<string, FeedbackContext>());
  const promptedJobIds = useRef(new Set<string>());
  useEffect(() => {
    setActionError(null);
    sessionJobs.current.clear();
    promptedJobIds.current.clear();
  }, [scope]);

  /**
   * The one way a render started here enters the list. Every start path — the
   * happy one and all three failure shortcuts — goes through here, so both
   * "this render belongs to this session" and "these are the settings it ran
   * with" have a single owner. A report about a render is only actionable if
   * it arrives with the settings that produced it.
   */
  const addSessionJob = useCallback(
    (job: RenderJob, settings: FeedbackContext) => {
      if (!isCurrent()) return;
      sessionJobs.current.set(job.id, settings);
      setJobs((previous) => {
        if (!isCurrent()) return previous;
        const hidden = new Set([...readHiddenIds(projectId ?? ""), ...scope.removed]);
        return upsertSessionRender(previous, job, hidden, scope.removedFamilies);
      });
    },
    [isCurrent, projectId, scope],
  );

  const closeActiveEventSource = useCallback((jobId?: string) => {
    if (jobId && activeJobRef.current !== jobId) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    activeJobRef.current = null;
  }, []);

  // Start a render and track progress via SSE
  // Pre-existing branchy fetch/poll flow — the variables passthrough added one branch.
  const startRender = useCallback(
    // fallow-ignore-next-line complexity
    async (opts: StartRenderOptions = {}) => {
      if (!projectId) return;
      // The server would answer this with a 503 anyway. Refusing here keeps
      // the reason and the fix in the message, and keeps a control that
      // forgot to disable itself from producing a mystery failure.
      if (ffmpegMissing) {
        addSessionJob(
          {
            id: generateId(),
            status: "failed",
            progress: 0,
            error: ffmpegInstallMessage(ffmpeg),
            filename: "Export blocked",
            createdAt: Date.now(),
          },
          {},
        );
        return;
      }

      const fps = opts.fps ?? 30;
      const quality = opts.quality ?? "standard";
      const format = opts.format ?? "mp4";
      const resolution = opts.resolution;
      // Which composition a render targets belongs here, with the same
      // argument the FFmpeg gate above makes: Studio starts renders from three
      // controls, and a default living in one of them leaves the others
      // exporting a file the user is not looking at. The header's Export
      // passed no options at all, so every render it started went to
      // index.html no matter which composition was selected (#3549).
      const composition = opts.composition ?? activeCompPathRef.current ?? undefined;

      trackStudioRenderStart({
        fps,
        quality,
        format,
        resolution,
        composition,
      });

      const startTime = Date.now();
      // Travels with any feedback about this render. Settings only: the
      // composition path is a name the user chose, not file contents.
      const settings: FeedbackContext = {
        render_format: format,
        render_quality: quality,
        render_fps: fps,
        render_resolution: resolution ?? "auto",
        render_composition: composition ?? "index.html",
        render_has_variables: Boolean(opts.variables && Object.keys(opts.variables).length > 0),
      };
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
        gpu?: boolean;
        gifLoop?: number;
        telemetryDistinctId?: string;
        telemetryOptOut?: boolean;
      } = {
        fps,
        quality,
        format,
      };
      // The id is MINTED by getAnonymousId(), so calling it unconditionally
      // created a telemetry identity for a profile that had opted out — and
      // then shipped it to the server. The server's own policy cannot see this
      // browser's localStorage or DoNotTrack, so it has to be told: an
      // explicit `telemetryOptOut` suppresses the render outcome, which
      // omitting the id alone does NOT (an old client omits it too, and that
      // falls back to the install id).
      if (browserTelemetryAllowed()) {
        // So the server-emitted render_complete/render_error is attributed to
        // this browser user (same id studio_* events use), making the render
        // funnel joinable. Matches studio_render_start fired just above.
        body.telemetryDistinctId = getAnonymousId();
      } else {
        body.telemetryOptOut = true;
      }
      if (resolution && resolution !== "auto") body.resolution = resolution;
      if (composition) body.composition = composition;
      if (opts.gpu) body.gpu = true;
      if (format === "gif" && opts.gifLoop !== undefined) body.gifLoop = opts.gifLoop;
      if (opts.variables && Object.keys(opts.variables).length > 0) {
        body.variables = opts.variables;
      }
      let res: Response;
      try {
        res = await studioApiFetch(buildProjectApiPath(projectId, `/render`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // The cause used to be discarded. Every failure — a dead server, an
        // aborted request, a DNS error, a mid-render crash — surfaced as the
        // same sentence, and this string is what travels into the feedback
        // report too, so field reports of a render that fails *every time*
        // still carried nothing to act on. Keep the CLI guidance, name the
        // cause after it.
        const cause = err instanceof Error ? err.message : String(err);
        const failedJob: RenderJob = {
          id: generateId(),
          status: "failed",
          progress: 0,
          error: `Could not reach render server: ${cause}. Use \`hyperframes render\` from the CLI instead.`,
          filename: "Export failed",
          createdAt: startTime,
        };
        addSessionJob(failedJob, settings);
        return;
      }
      if (!res.ok) {
        const failedJob: RenderJob = {
          id: generateId(),
          status: "failed",
          progress: 0,
          error: await readServerError(res),
          filename: "Export failed",
          createdAt: startTime,
        };
        addSessionJob(failedJob, settings);
        return;
      }
      const { jobId, filename } = await res.json();
      if (!isCurrent()) return;

      const FORMAT_EXT: Record<StudioRenderFormat, string> = {
        mp4: ".mp4",
        webm: ".webm",
        mov: ".mov",
        gif: ".gif",
        "png-sequence": "",
      };
      const job: RenderJob = {
        id: jobId,
        status: "rendering",
        progress: 0,
        filename: typeof filename === "string" ? filename : `${jobId}${FORMAT_EXT[format]}`,
        createdAt: startTime,
        ...(format === "png-sequence" ? { kind: "directory" as const } : {}),
      };
      addSessionJob(job, settings);
      activeJobRef.current = jobId;

      // Track progress via SSE
      const es = new EventSource(`/api/render/${jobId}/progress`);
      eventSourceRef.current = es;
      let finished = false;

      es.addEventListener("progress", (event) => {
        if (!isCurrent() || finished) return;
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
            finished = true;
            closeActiveEventSource(jobId);
            if (data.status === "complete" && format === "png-sequence") void loadRenders(jobId);
          }
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        es.close();
        if (!isCurrent() || finished) return;
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
    [
      projectId,
      activeCompPathRef,
      closeActiveEventSource,
      addSessionJob,
      ffmpeg,
      ffmpegMissing,
      isCurrent,
      loadRenders,
    ],
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
        const res = await studioApiFetch(`/api/render/${jobId}/cancel`, { method: "POST" });
        if (!isCurrent()) return;
        if (!res.ok && res.status !== 404) {
          setActionError("Couldn't cancel on the server. The render may still be running.");
          return;
        }
        // Reconcile with the status the route reports: if the render actually
        // finished (or failed) before the cancel landed, don't leave the row
        // stuck on the optimistic "cancelled" — reload to pick up the real
        // outcome (and the finished file's metadata).
        if (res.ok) {
          const status = cancelledRenderOutcome(await res.json().catch(() => null));
          if (!isCurrent()) return;
          if (status) {
            setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status } : job)));
            void loadRenders();
          }
        }
      } catch {
        if (isCurrent())
          setActionError("Couldn't reach the server to cancel. The render may still be running.");
      }
    },
    [closeActiveEventSource, loadRenders, isCurrent],
  );

  const deleteRender = useCallback(
    async (jobId: string) => {
      const family = renderQueueFamilyKey(jobs.find((job) => job.id === jobId));
      setActionError(null);
      closeActiveEventSource(jobId);
      try {
        const res = await studioApiFetch(`/api/render/${jobId}`, { method: "DELETE" });
        if (!isCurrent()) return;
        if (!res.ok) {
          setActionError("Couldn't delete the render. It's still on disk.");
          return;
        }
      } catch {
        if (isCurrent()) setActionError("Couldn't reach the server to delete the render.");
        return;
      }
      if (!isCurrent()) return;
      scope.removed.add(jobId);
      if (family) scope.removedFamilies.add(family);
      setJobs((prev) =>
        isCurrent() ? removeDeletedRenderFamily(prev, jobId, family, scope.removed) : prev,
      );
    },
    [closeActiveEventSource, scope, isCurrent, jobs],
  );

  // Hide finished rows from the list (view-only — files stay on disk and can
  // be recovered from the renders/ directory). Remembered per project so the
  // rows don't resurrect from history on reload.
  const clearCompleted = useCallback(() => {
    setJobs((prev) => {
      if (!isCurrent()) return prev;
      const finished = prev.filter((j) => j.status !== "rendering");
      for (const job of finished) scope.removed.add(job.id);
      if (projectId && finished.length > 0) {
        const hidden = readHiddenIds(projectId);
        for (const j of finished) hidden.add(j.id);
        writeHiddenIds(projectId, hidden);
      }
      return prev.filter((j) => j.status === "rendering");
    });
  }, [projectId, scope, isCurrent]);

  const dismissActionError = useCallback(() => setActionError(null), []);

  // Ask for feedback the moment a render this tab started reaches its outcome.
  // Watching the list (rather than each of the four places a job can finish)
  // keeps one trigger for every path, including SSE drops and cancels-that-
  // finished-anyway. `requestStudioFeedback` decides whether to actually ask.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status === "rendering" || job.status === "cancelled") continue;
      const settings = sessionJobs.current.get(job.id);
      if (!settings || promptedJobIds.current.has(job.id)) continue;
      promptedJobIds.current.add(job.id);
      requestStudioFeedback({
        reason: job.status === "complete" ? "render_complete" : "render_failed",
        renderId: job.id,
        detail: job.error,
        context: {
          ...settings,
          // How far it got and how long it took separate "died on frame one"
          // from "died during encode", which need different fixes.
          render_progress: job.progress,
          render_duration_ms: job.durationMs ?? Date.now() - job.createdAt,
          render_stage: job.stage,
          render_error: job.error,
          // Earlier renders this session: a first-render failure and a
          // failure after nine successes are different bugs.
          renders_this_session: sessionJobs.current.size,
        },
      });
    }
  }, [jobs]);

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
      reloadRenders,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender: startRender as (options: unknown) => Promise<void>,
      // Every Export control reads these, so no caller has to decide for
      // itself whether this machine can encode.
      ffmpeg,
      ffmpegMissing,
      ffmpegChecking,
      recheckFfmpeg,
    }),
    [
      jobs,
      isRendering,
      loadError,
      actionError,
      dismissActionError,
      reloadRenders,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender,
      ffmpeg,
      ffmpegMissing,
      ffmpegChecking,
      recheckFfmpeg,
    ],
  );
}
