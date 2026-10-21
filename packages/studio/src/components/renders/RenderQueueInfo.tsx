import type { RenderJob } from "./useRenderQueue";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function RenderQueueInfo({ job }: { job: RenderJob }) {
  const isRendering = job.status === "rendering";
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-step-11 font-medium text-text-2 truncate">{job.filename}</span>
        {job.durationMs && (
          <span className="text-step-9 text-text-5 shrink-0">{formatDuration(job.durationMs)}</span>
        )}
      </div>

      {isRendering && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-step-9 text-text-4">{job.stage || "Rendering"}</span>
            <span className="text-step-9 font-mono text-accent-ink">{job.progress}%</span>
          </div>
          <div
            className="w-full h-1 bg-border rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={job.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Render progress: ${job.progress}%`}
          >
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {job.status === "failed" && job.error && (
        <span className="text-step-9 text-danger-ink mt-0.5 block">{job.error}</span>
      )}
      {job.status === "cancelled" && (
        <span className="text-step-9 text-text-4 mt-0.5 block">Cancelled</span>
      )}

      {!isRendering && (
        <span className="text-step-9 text-text-5">{formatTimeAgo(job.createdAt)}</span>
      )}
    </div>
  );
}
