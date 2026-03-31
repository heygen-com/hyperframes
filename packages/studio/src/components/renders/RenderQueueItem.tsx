import { memo, useCallback, useState } from "react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import type { RenderJob } from "./useRenderQueue";

interface RenderQueueItemProps {
  job: RenderJob;
  projectId: string;
  onDelete: () => void;
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
}: RenderQueueItemProps) {
  const [hovered, setHovered] = useState(false);

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

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={isComplete ? handleOpen : undefined}
      className={[
        "px-3 py-2.5 border-b border-neutral-800/30 last:border-0 transition-colors duration-150",
        isComplete ? "cursor-pointer hover:bg-neutral-800/30" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2.5">
        {/* Thumbnail — static frame; swaps to live video on hover */}
        <div className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
          {isComplete && (
            <>
              {/* Live video — visible on hover */}
              {hovered && (
                <video
                  src={viewSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-contain"
                />
              )}
              {/* Static frame — visible when not hovering */}
              <div
                className="absolute inset-0 transition-opacity duration-150"
                style={{ opacity: hovered ? 0 : 1 }}
              >
                <VideoFrameThumbnail src={viewSrc} />
              </div>
            </>
          )}
          {job.status === "rendering" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-studio-accent animate-pulse" />
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
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-neutral-300 truncate">
              {job.filename}
            </span>
            {job.durationMs && (
              <span className="text-[9px] text-neutral-600 flex-shrink-0">
                {formatDuration(job.durationMs)}
              </span>
            )}
          </div>

          {job.status === "rendering" && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-neutral-500">{job.stage || "Rendering"}</span>
                <span className="text-[9px] font-mono text-studio-accent">{job.progress}%</span>
              </div>
              <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-studio-accent rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {job.status === "failed" && job.error && (
            <span className="text-[9px] text-red-400 mt-0.5 block">{job.error}</span>
          )}

          {job.status !== "rendering" && (
            <span className="text-[9px] text-neutral-600">{formatTimeAgo(job.createdAt)}</span>
          )}
        </div>

        {/* Actions */}
        {hovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {isComplete && (
              <button
                onClick={handleDownload}
                className="p-1 rounded text-neutral-500 hover:text-green-400 transition-colors"
                title="Download"
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
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 rounded text-neutral-500 hover:text-red-400 transition-colors"
              title="Remove"
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
          </div>
        )}
      </div>
    </div>
  );
});
