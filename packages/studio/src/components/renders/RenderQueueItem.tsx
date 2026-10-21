import { buildProjectApiPath } from "../../utils/projectRouting";
import { memo, useCallback, useState } from "react";
import { RenderQueueInfo } from "./RenderQueueInfo";
import { RenderPreview } from "./RenderPreview";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import type { RenderJob } from "./useRenderQueue";

interface RenderQueueItemProps {
  job: RenderJob;
  projectId: string;
  onDelete: () => void;
  onCancel: () => void;
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
  const fileSrc = buildProjectApiPath(projectId, `/renders/file/${job.filename}`);

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
      className="px-3 py-2.5 border-b border-border last:border-0 transition-colors duration-150 hover:bg-hover/30"
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
            "w-20 h-[45px] rounded-md overflow-hidden bg-input shrink-0 relative",
            "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent",
            isComplete ? "cursor-pointer" : "cursor-default",
          ].join(" ")}
        >
          {isComplete && (
            <RenderPreview
              filename={job.filename}
              src={viewSrc}
              hovered={hovered}
              ready={videoReady}
              onReady={() => setVideoReady(true)}
            />
          )}
          {isRendering && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
            </div>
          )}
          {job.status === "failed" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-danger-ink" />
            </div>
          )}
          {job.status === "cancelled" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-text-5" />
            </div>
          )}
        </button>

        <RenderQueueInfo job={job} />

        {/* Actions — always visible to prevent layout shifts */}
        <div className="flex items-center gap-1.5 shrink-0">
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
              {/* The tooltip explains the control whether or not it is
                  reachable; `disabled:` on the shared Button keeps pointer
                  events alive precisely so a disabled one can still say why. */}
              <Tooltip label={isComplete ? "Download" : "Available when the render finishes"}>
                <IconButton
                  size="sm"
                  onClick={handleDownload}
                  disabled={!isComplete}
                  aria-label={`Download ${job.filename}`}
                  icon={
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  }
                />
              </Tooltip>
              <Tooltip label="Delete render file">
                <IconButton
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(true);
                  }}
                  aria-label={`Delete ${job.filename}`}
                  icon={
                    <svg
                      width="12"
                      height="12"
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
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
