import { memo, useRef, useEffect } from "react";
import { RenderQueueItem } from "./RenderQueueItem";
import type { FfmpegStatus } from "./useFfmpegStatus";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import type { RenderJob, ResolutionPreset } from "./useRenderQueue";
import type { AdvancedRenderSettings } from "./renderSettings";
import { RenderExportSettings } from "./RenderExportSettings";

export interface CompositionDimensions {
  width: number;
  height: number;
}

export type StartRenderHandler = (
  format: "mp4" | "webm" | "mov" | "gif",
  quality: "draft" | "standard" | "high",
  resolution: ResolutionPreset | "auto",
  fps: 24 | 30 | 60,
  gpu?: boolean,
  gifLoop?: number,
  advanced?: AdvancedRenderSettings,
) => void | Promise<void>;

export interface RenderQueueProps {
  jobs: RenderJob[];
  projectId: string;
  onDelete: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onClearCompleted: () => void;
  onStartRender: StartRenderHandler;
  isRendering: boolean;
  /** History fetch failure (null when the last load succeeded). */
  loadError?: string | null;
  /** Retry a failed history load. */
  onRetryLoad?: () => void;
  /** Failure of a delete/cancel action, shown inline until dismissed. */
  actionError?: string | null;
  onDismissActionError?: () => void;
  /**
   * Authored dimensions of the active composition determine the
   * matching preset (landscape / portrait / square) when the user selects
   * a 1080p or 4K scale. `null` falls back to landscape (legacy default).
   */
  compositionDimensions?: CompositionDimensions | null;
  /**
   * Encoder availability, owned by useRenderQueue so the panel's Export button
   * and the header's agree. `null` means "no answer", not "missing".
   */
  ffmpeg: FfmpegStatus | null;
  ffmpegChecking: boolean;
  onRecheckFfmpeg: () => void;
}

function RenderJobList({
  jobs,
  projectId,
  onDelete,
  onCancel,
  onClearCompleted,
  loadError,
  onRetryLoad,
}: Pick<
  RenderQueueProps,
  "jobs" | "projectId" | "onDelete" | "onCancel" | "onClearCompleted" | "loadError" | "onRetryLoad"
>) {
  if (loadError && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 gap-2" role="alert">
        <p className="text-step-10 text-danger-ink text-center">{loadError}</p>
        {onRetryLoad && (
          <Button size="sm" variant="secondary" onClick={onRetryLoad}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-5"
        >
          <rect
            x="2"
            y="2"
            width="20"
            height="20"
            rx="2.18"
            ry="2.18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-step-10 text-text-5 text-center">No renders yet</p>
      </div>
    );
  }
  const completedCount = jobs.filter((j) => j.status !== "rendering").length;
  return (
    <div>
      {completedCount > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <span className="text-step-10 text-text-4">
            {jobs.length} render{jobs.length === 1 ? "" : "s"}
          </span>
          {/* "Hide", not "Clear": files stay on disk (delete is per-row
              and confirmed); hidden rows don't resurrect on reload. */}
          <Tooltip label="Hide finished renders from this list (files stay on disk)">
            <Button size="sm" variant="ghost" onClick={onClearCompleted}>
              Hide finished
            </Button>
          </Tooltip>
        </div>
      )}
      {jobs.map((job) => (
        <RenderQueueItem
          key={job.id}
          job={job}
          projectId={projectId}
          onDelete={() => onDelete(job.id)}
          onCancel={() => onCancel?.(job.id)}
        />
      ))}
    </div>
  );
}

export const RenderQueue = memo(function RenderQueue({
  jobs,
  projectId,
  onDelete,
  onCancel,
  onClearCompleted,
  onStartRender,
  isRendering,
  loadError,
  onRetryLoad,
  actionError,
  onDismissActionError,
  compositionDimensions,
  ffmpeg,
  ffmpegChecking,
  onRecheckFfmpeg,
}: RenderQueueProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new jobs are added.
  // Runs in an effect to avoid side effects during the render phase.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [jobs.length]);

  const lastRenderDurationMs = [...jobs]
    .reverse()
    .find((j) => j.status === "complete" && j.durationMs !== undefined)?.durationMs;

  return (
    <div className="flex flex-col h-full">
      <div className="max-h-full overflow-y-auto px-3 py-3 border-b border-border shrink-0">
        <RenderExportSettings
          onStartRender={onStartRender}
          isRendering={isRendering}
          compositionDimensions={compositionDimensions}
          lastRenderDurationMs={lastRenderDurationMs}
          ffmpeg={ffmpeg}
          ffmpegChecking={ffmpegChecking}
          onRecheckFfmpeg={onRecheckFfmpeg}
        />
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 px-3 py-2 border-b border-border bg-danger/10"
        >
          <span className="text-step-10 text-danger-ink">{actionError}</span>
          {onDismissActionError && (
            <IconButton
              size="sm"
              onClick={onDismissActionError}
              aria-label="Dismiss error"
              className="shrink-0"
              icon={
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              }
            />
          )}
        </div>
      )}

      {/* Job list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        <RenderJobList
          jobs={jobs}
          projectId={projectId}
          onDelete={onDelete}
          onCancel={onCancel}
          onClearCompleted={onClearCompleted}
          loadError={loadError}
          onRetryLoad={onRetryLoad}
        />
      </div>
    </div>
  );
});
