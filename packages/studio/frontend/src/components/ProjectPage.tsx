import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Monitor,
  Smartphone,
  Code,
  FileCode,
  Undo2,
  Redo2,
  Download,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  getProject,
  updateElementStart,
  type ProjectMeta,
} from "../api/projects";
import { usePlayerStore } from "../store/playerStore";
import { useTimelinePlayer } from "../hooks/useTimelinePlayer";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { Player } from "./Player";
import { PlayerControls } from "./PlayerControls";
import { Timeline } from "./Timeline";
import { CodeSandbox } from "./CodeSandbox";
import { HtmlPreview } from "./HtmlPreview";
import { useRender } from "../hooks/useRender";

interface ProjectPageProps {
  projectId: string;
}

export function ProjectPage({ projectId }: ProjectPageProps) {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portrait, setPortrait] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const [htmlVersion, setHtmlVersion] = useState(0);

  const {
    isPlaying,
    currentTime,
    duration,
    timelineReady,
    updateElementStart: optimisticUpdateStart,
  } = usePlayerStore();
  const { iframeRef, togglePlay, seek, onIframeLoad, refreshPlayer } =
    useTimelinePlayer();
  const { pushUndo, popUndo, popRedo, canUndo, canRedo } = useUndoRedo();
  const {
    state: renderState,
    progress: renderProgress,
    error: renderError,
    start: startRender,
  } = useRender(projectId);
  const [showRenderPopup, setShowRenderPopup] = useState(false);
  const [debugMode, setDebugMode] = useState(true);
  const [sequentialMode, setSequentialMode] = useState(false);
  const renderPopupRef = useRef<HTMLDivElement>(null);

  const applyStart = useCallback(
    async (elementId: string, start: number) => {
      optimisticUpdateStart(elementId, start);
      try {
        await updateElementStart(projectId, elementId, start);
        refreshPlayer();
        setHtmlVersion((v) => v + 1);
      } catch (err) {
        console.error("[MoveClip] Failed to update element:", err);
      }
    },
    [projectId, refreshPlayer, optimisticUpdateStart]
  );

  const handleMoveElement = useCallback(
    async (elementId: string, newStart: number) => {
      const el = usePlayerStore
        .getState()
        .elements.find((e) => e.id === elementId);
      const oldStart = el?.start ?? 0;
      pushUndo({ elementId, oldStart, newStart });
      applyStart(elementId, newStart);
    },
    [pushUndo, applyStart]
  );

  const handleUndo = useCallback(() => {
    const entry = popUndo();
    if (entry) applyStart(entry.elementId, entry.oldStart);
  }, [popUndo, applyStart]);

  const handleRedo = useCallback(() => {
    const entry = popRedo();
    if (entry) applyStart(entry.elementId, entry.newStart);
  }, [popRedo, applyStart]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (mod && e.key === "z" && e.shiftKey) ||
        (mod && e.key === "y")
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    getProject(projectId)
      .then((p) => {
        setProject(p);
        // Auto-detect portrait/landscape from composition dimensions
        if (p.width && p.height) {
          setPortrait(p.height > p.width);
        }
      })
      .catch(() => setError("Project not found"));
  }, [projectId]);

  useEffect(() => {
    if (!showRenderPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        renderPopupRef.current &&
        !renderPopupRef.current.contains(e.target as Node)
      ) {
        setShowRenderPopup(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRenderPopup]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <a href="#/" className="text-blue-600 hover:underline text-sm">
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  if (isEditMode) {
    return (
      <CodeSandbox
        projectId={projectId}
        projectName={project?.name ?? "Untitled"}
        initialPortrait={portrait}
        onExit={() => setIsEditMode(false)}
      />
    );
  }

  return (
    <div className="w-full h-screen flex flex-col bg-neutral-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-neutral-200/80">
        <a
          href="#/"
          className="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5 rounded-lg hover:bg-neutral-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </a>
        <h1 className="text-neutral-800 font-semibold text-sm truncate">
          {project?.name ?? "Loading..."}
        </h1>

        <div className="ml-auto flex items-center gap-2">
          {!timelineReady && project && (
            <div className="flex items-center gap-2 mr-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-neutral-400 text-xs">Initializing...</span>
            </div>
          )}

          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-1.5 rounded-md transition-colors text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
            title="Undo (⌘Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-1.5 rounded-md transition-colors text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none"
            title="Redo (⌘⇧Z)"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          {/* HTML preview toggle - hidden for now
          <button
            onClick={() => setShowHtmlPreview((v) => !v)}
            className={`p-1.5 rounded-md transition-colors ${
              showHtmlPreview
                ? "bg-neutral-200 text-neutral-800"
                : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
            }`}
            title="Preview HTML"
          >
            <FileCode className="w-4 h-4" />
          </button>
          */}

          {/* Code editor toggle */}
          <button
            onClick={() => setIsEditMode(true)}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
            title="Edit Code"
          >
            <Code className="w-4 h-4" />
          </button>

          {/* Orientation toggle */}
          <div className="flex items-center bg-neutral-100 rounded-lg p-0.5">
            <button
              onClick={() => setPortrait(false)}
              className={`p-1.5 rounded-md transition-colors ${
                !portrait
                  ? "bg-white text-neutral-800 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-600"
              }`}
              title="Landscape (16:9)"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPortrait(true)}
              className={`p-1.5 rounded-md transition-colors ${
                portrait
                  ? "bg-white text-neutral-800 shadow-sm"
                  : "text-neutral-400 hover:text-neutral-600"
              }`}
              title="Portrait (9:16)"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Render / Download button */}
          <div className="relative" ref={renderPopupRef}>
            <button
              onClick={() => {
                if (renderState === "rendering") return;
                setShowRenderPopup((v) => !v);
              }}
              disabled={renderState === "rendering"}
              className={`p-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                renderState === "error"
                  ? "text-red-500 hover:text-red-700 hover:bg-red-50"
                  : renderState === "complete"
                  ? "text-green-600 hover:bg-green-50"
                  : renderState === "rendering"
                  ? "text-blue-500 bg-blue-50 cursor-wait"
                  : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
              }`}
              title={
                renderState === "rendering"
                  ? `Rendering... ${Math.round(renderProgress)}%`
                  : renderState === "error"
                  ? renderError || "Render failed"
                  : renderState === "complete"
                  ? "Render complete!"
                  : "Download as MP4"
              }
            >
              {renderState === "rendering" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-medium">
                    {Math.round(renderProgress)}%
                  </span>
                </>
              ) : renderState === "complete" ? (
                <Check className="w-4 h-4" />
              ) : renderState === "error" ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </button>

            {showRenderPopup && renderState !== "rendering" && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-lg shadow-lg border border-neutral-200 p-3 z-50">
                <div className="text-xs font-semibold text-neutral-700 mb-2.5">
                  Render Settings
                </div>

                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={debugMode}
                    onChange={(e) => setDebugMode(e.target.checked)}
                    className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs text-neutral-700">Debug Mode</span>
                    <p className="text-[10px] text-neutral-400 leading-tight mt-0.5">
                      Preserve work folder, verbose logs
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={sequentialMode}
                    onChange={(e) => setSequentialMode(e.target.checked)}
                    className="rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs text-neutral-700">
                      Sequential rendering
                    </span>
                    <p className="text-[10px] text-neutral-400 leading-tight mt-0.5">
                      Use single worker (slower, less memory)
                    </p>
                  </div>
                </label>

                <button
                  onClick={() => {
                    setShowRenderPopup(false);
                    startRender({
                      debug: debugMode,
                      sequential: sequentialMode,
                    });
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Render MP4
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Player area */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 flex items-center justify-center p-4 pb-0">
          <Player
            ref={iframeRef}
            projectId={projectId}
            onLoad={onIframeLoad}
            portrait={portrait}
          />
        </div>
        {showHtmlPreview && (
          <HtmlPreview projectId={projectId} version={htmlVersion} />
        )}
      </div>

      {/* Controls + Timeline stacked at bottom */}
      <div className="flex-shrink-0">
        <PlayerControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          timelineReady={timelineReady}
          onTogglePlay={togglePlay}
          onSeek={seek}
        />
        <Timeline onMoveElement={handleMoveElement} />
      </div>
    </div>
  );
}
