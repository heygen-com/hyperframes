import type { ReactNode, Ref } from "react";
import { Player } from "./Player";
import { PlayerControls } from "./PlayerControls";
import { Timeline } from "./Timeline";

interface RenderStatus {
  state: "idle" | "rendering" | "complete" | "error";
  stage?: string;
  progress?: number;
  error?: string;
  onRender?: () => void;
}

interface PreviewPanelProps {
  projectId: string | null;
  hasProject: boolean;
  portrait: boolean;
  iframeRef: Ref<HTMLIFrameElement>;
  onIframeLoad: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  /** Optional render status — pass to show rendering progress/state */
  renderStatus?: RenderStatus;
  /** Optional slot for custom content below the timeline */
  children?: ReactNode;
}

export function PreviewPanel({
  projectId,
  hasProject,
  portrait,
  iframeRef,
  onIframeLoad,
  onTogglePlay,
  onSeek,
  renderStatus,
  children,
}: PreviewPanelProps) {

  const renderState = renderStatus?.state ?? "idle";

  return (
    <div
      className="min-w-0 overflow-hidden"
      style={{
        display: "grid",
        gridTemplateRows: hasProject && projectId ? "1fr auto auto auto" : "1fr",
        height: "100%",
        minHeight: 0,
      }}
    >
      {hasProject && projectId ? (
        <>
          {/* Player — takes all remaining space, constrained for portrait */}
          <div className="flex items-center justify-center p-2 overflow-hidden" style={{ minHeight: 0, minWidth: 0 }}>
            <Player ref={iframeRef} projectId={projectId} onLoad={onIframeLoad} portrait={portrait} />
          </div>

          {/* Controls — fixed height */}
          <div className="bg-neutral-950 border-t border-neutral-800 flex-shrink-0">
            <PlayerControls
              onTogglePlay={onTogglePlay}
              onSeek={onSeek}
            />
          </div>

          {/* Timeline — capped height, internal scroll */}
          <div className="bg-neutral-950 flex-shrink-0 overflow-y-auto" style={{ maxHeight: "100px" }}>
            <Timeline onSeek={onSeek} />
          </div>

          {/* Render status — only shown when actively rendering, complete, or error */}
          {renderStatus && (renderState === "rendering" || renderState === "complete" || renderState === "error") && (
            <div className="bg-neutral-950 border-t border-neutral-800 px-4 py-2 flex items-center justify-end gap-2 flex-shrink-0">
              {renderState === "rendering" && (
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-[width] duration-200"
                        style={{ width: `${renderStatus.progress ?? 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-neutral-400 flex-shrink-0">
                      {renderStatus.stage || "Rendering..."}
                    </span>
                  </div>
                </div>
              )}
              {renderState === "complete" && (
                <div className="flex items-center gap-1.5 text-xs text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>Complete</span>
                </div>
              )}
              {renderState === "error" && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span className="truncate">{renderStatus.error}</span>
                  {renderStatus.onRender && (
                    <button
                      type="button"
                      onClick={renderStatus.onRender}
                      className="flex-shrink-0 px-2 py-0.5 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Optional custom slot */}
          {children}
        </>
      ) : (
        <div className="flex items-center justify-center w-full min-w-0">
          <div className="text-center w-full">
            <div className="w-16 h-16 mx-auto mb-4 rounded-card bg-neutral-900 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neutral-600"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <p className="text-sm text-neutral-600">Preview will appear here</p>
            <p className="text-xs text-neutral-700 mt-1">Send a message to generate a video composition</p>
          </div>
        </div>
      )}
    </div>
  );
}
