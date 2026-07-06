import { memo, useCallback, useState } from "react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { Button } from "../ui/Button";
import type { RenderJob } from "./useRenderQueue";

interface RenderQueueItemProps {
  job: RenderJob;
  projectId: string;
  onDelete: () => void;
  onCancel: () => void;
}

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

/** Static frame extracted once via hidden video + canvas. */

export const RenderQueueItem = memo(function RenderQueueItem({
  job,
  projectId,
  onDelete,
  onCancel,
}: RenderQueueItemProps) {
  const [hovered, setHovered] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Direct file URL — serves from disk, survives server restarts
  const fileSrc = `/api/projects/${projectId}/renders/file/${job.filename}`;

  const handleOpen = useCallback(() => {
    window.open(fileSrc, "_blank");
  }, [fileSrc]);

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const a = document.createElement("a");
      a.href = fileSrc;
      a.download = job.filename;
      a.click();
    },
    [fileSrc, job.filename],
  );

  const viewSrc = fileSrc;
  const isComplete = job.status === "complete";
  const isRendering = job.status === "rendering";

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setVideoReady(false);
        setConfirmingDelete(false);
      }}
      className="px-3 py-2.5 border-b border-panel-border last:border-0 transition-colors duration-150 hover:bg-panel-hover/30"
    >
      <div className="flex items-center gap-2.5">
        {/* Thumbnail — static frame; swaps to live video on hover.
            A real button so keyboard users can open the render too. */}
        <button
          type="button"
          onClick={isComplete ? handleOpen : undefined}
          disabled={!isComplete}
          aria-label={isComplete ? `Open ${job.filename} in a new tab` : undefined}
          className={[
            "w-20 h-[45px] rounded-md overflow-hidden bg-panel-input flex-shrink-0 relative",
            "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent",
            isComplete ? "cursor-pointer" : "cursor-default",
          ].join(" ")}
        >
          {isComplete && (
            <>
              {/* Live video — fades in over the static frame once it can play */}
              {hovered && (
                <video
                  src={viewSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onCanPlay={() => setVideoReady(true)}
                  className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
                  style={{ opacity: videoReady ? 1 : 0 }}
                />
              )}
              {/* Static frame — visible when not hovering */}
              <div
                className="absolute inset-0 transition-opacity duration-150"
                style={{ opacity: hovered && videoReady ? 0 : 1 }}
              >
                <VideoFrameThumbnail src={viewSrc} />
              </div>
            </>
          )}
          {isRendering && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-panel-accent animate-pulse motion-reduce:animate-none" />
            </div>
          )}
          {job.status === "failed" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-red-400" />
            </div>
          )}
          {job.status === "cancelled" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-neutral-600" />
            </div>
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-panel-text-2 truncate">
              {job.filename}
            </span>
            {job.durationMs && (
              <span className="text-[9px] text-panel-text-5 flex-shrink-0">
                {formatDuration(job.durationMs)}
              </span>
            )}
          </div>

          {isRendering && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-panel-text-4">{job.stage || "Rendering"}</span>
                <span className="text-[9px] font-mono text-panel-accent">{job.progress}%</span>
              </div>
              <div
                className="w-full h-1 bg-panel-border rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={job.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Render progress: ${job.progress}%`}
              >
                <div
                  className="h-full bg-panel-accent rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {job.status === "failed" && job.error && (
            <span className="text-[9px] text-red-400 mt-0.5 block">{job.error}</span>
          )}
          {job.status === "cancelled" && (
            <span className="text-[9px] text-panel-text-4 mt-0.5 block">Cancelled</span>
          )}

          {!isRendering && (
            <span className="text-[9px] text-panel-text-5">{formatTimeAgo(job.createdAt)}</span>
          )}
        </div>

        {/* Actions — always visible to prevent layout shifts */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isRendering ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
            >
              Cancel
            </Button>
          ) : confirmingDelete ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                  onDelete();
                }}
              >
                Delete?
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                }}
              >
                Keep
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={isComplete ? handleDownload : undefined}
                className={`p-1.5 min-w-6 min-h-6 rounded transition-colors outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent ${
                  isComplete
                    ? "text-panel-text-5 hover:text-panel-accent"
                    : "text-panel-text-5/30 cursor-default"
                }`}
                title={isComplete ? "Download" : undefined}
                aria-label={`Download ${job.filename}`}
                disabled={!isComplete}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(true);
                }}
                className="p-1.5 min-w-6 min-h-6 rounded text-panel-text-5 hover:text-red-400 transition-colors outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent"
                title="Delete render file"
                aria-label={`Delete ${job.filename}`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
