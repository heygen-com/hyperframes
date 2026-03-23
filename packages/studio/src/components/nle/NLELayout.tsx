import { useState, useEffect, useCallback, useRef, memo, type ReactNode } from "react";
import { useTimelinePlayer, PlayerControls, Timeline, usePlayerStore } from "../../player";
import type { TimelineElement } from "../../player";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb, type CompositionLevel } from "./CompositionBreadcrumb";

interface NLELayoutProps {
  projectId: string;
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  /** Slot rendered below the timeline tracks (e.g., agent activity swim lanes) */
  timelineFooter?: ReactNode;
  /** Increment to force the preview to reload (e.g., after file writes) */
  refreshKey?: number;
  /** Navigate to a specific composition path (e.g., "compositions/intro.html") */
  activeCompositionPath?: string | null;
  /** Callback to expose the iframe ref (for element picker, etc.) */
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
}

const MIN_TIMELINE_H = 100;
const DEFAULT_TIMELINE_H = 220;
const MIN_PREVIEW_H = 120;

export const NLELayout = memo(function NLELayout({
  projectId,
  portrait,
  previewOverlay,
  timelineFooter,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
}: NLELayoutProps) {
  const {
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad: baseOnIframeLoad,
    saveSeekPosition,
  } = useTimelinePlayer();

  // Preserve seek position when refreshKey changes (iframe will remount via key prop).
  const prevRefreshKeyRef = useRef(refreshKey);
  if (refreshKey !== prevRefreshKeyRef.current) {
    prevRefreshKeyRef.current = refreshKey;
    saveSeekPosition();
  }

  // Wrap onIframeLoad to also notify parent of iframe ref
  const onIframeLoad = useCallback(() => {
    baseOnIframeLoad();
    onIframeRef?.(iframeRef.current);
  }, [baseOnIframeLoad, iframeRef, onIframeRef]);

  // Composition ID → actual file path mapping, built from the raw index.html
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch(`/api/projects/${projectId}/files/index.html`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        const html = data.content || "";
        const map = new Map<string, string>();
        const re =
          /data-composition-id=["']([^"']+)["'][^>]*data-composition-src=["']([^"']+)["']|data-composition-src=["']([^"']+)["'][^>]*data-composition-id=["']([^"']+)["']/g;
        let match;
        while ((match = re.exec(html)) !== null) {
          const id = match[1] || match[4];
          const src = match[2] || match[3];
          if (id && src) map.set(id, src);
        }
        setCompIdToSrc(map);
      })
      .catch(() => {});
  }, [projectId]);

  // Composition drill-down stack
  const [compositionStack, setCompositionStack] = useState<CompositionLevel[]>([
    { id: "master", label: "Master", previewUrl: `/api/projects/${projectId}/preview` },
  ]);

  // Resizable timeline height
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE_H);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Current preview URL — derived from composition stack
  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;

  // Drill-down: push a sub-composition onto the stack
  const iframeRef_ = iframeRef; // stable ref for the callback
  const handleDrillDown = useCallback(
    (element: TimelineElement) => {
      if (!element.compositionSrc) return;
      // compositionSrc may be a full URL (from runtime manifest) or a relative path
      // Extract the element's composition ID from its timeline ID
      const compId = element.id;

      // 1. Check compIdToSrc map (from index.html)
      // 2. Scan the current iframe DOM for data-composition-src attribute
      // 3. Fall back to stripping the compositionSrc to a relative path
      let resolvedPath = compIdToSrc.get(compId);
      if (!resolvedPath) {
        try {
          const doc = iframeRef_.current?.contentDocument;
          if (doc) {
            const host = doc.querySelector(
              `[data-composition-id="${compId}"][data-composition-src]`,
            );
            if (host) {
              resolvedPath = host.getAttribute("data-composition-src") || undefined;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      if (!resolvedPath) {
        // Strip full URL to relative path if needed
        const src = element.compositionSrc;
        const compMatch = src.match(/compositions\/.*\.html/);
        resolvedPath = compMatch ? compMatch[0] : src;
      }

      usePlayerStore.getState().setElements([]);

      // Toggle: if already viewing this composition, go back to parent (like Premiere)
      setCompositionStack((prev) => {
        const currentId = prev[prev.length - 1].id;
        if (currentId === resolvedPath && prev.length > 1) {
          return prev.slice(0, -1);
        }
        // Extract a clean label from the path (strip directories and extension)
        const label =
          resolvedPath
            .split("/")
            .pop()
            ?.replace(/\.html$/, "") || resolvedPath;
        const previewUrl = `/api/projects/${projectId}/preview/comp/${resolvedPath}`;
        return [...prev, { id: resolvedPath, label, previewUrl }];
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iframeRef_ is a stable ref; .current mutates and should not be a dep
    [projectId, compIdToSrc],
  );

  // Navigate back to a specific breadcrumb level
  const handleNavigateComposition = useCallback((index: number) => {
    usePlayerStore.getState().setElements([]);
    setCompositionStack((prev) => prev.slice(0, index + 1));
  }, []);

  // Navigate to a composition when activeCompositionPath changes
  const prevActiveCompRef = useRef<string | null>(null);
  if (activeCompositionPath && activeCompositionPath !== prevActiveCompRef.current) {
    prevActiveCompRef.current = activeCompositionPath;
    queueMicrotask(() => usePlayerStore.getState().setElements([]));
    if (activeCompositionPath === "index.html") {
      setCompositionStack((prev) => (prev.length > 1 ? [prev[0]] : prev));
    } else if (activeCompositionPath.startsWith("compositions/")) {
      const label = activeCompositionPath.replace(/^compositions\//, "").replace(/\.html$/, "");
      const previewUrl = `/api/projects/${projectId}/preview/comp/${activeCompositionPath}`;
      setCompositionStack((prev) => {
        if (prev[prev.length - 1].id === activeCompositionPath) return prev;
        return [
          { id: "master", label: "Master", previewUrl: `/api/projects/${projectId}/preview` },
          { id: activeCompositionPath, label, previewUrl },
        ];
      });
    }
  } else if (!activeCompositionPath && prevActiveCompRef.current) {
    prevActiveCompRef.current = null;
    queueMicrotask(() => usePlayerStore.getState().setElements([]));
  }

  // Resize divider handlers
  const handleDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const containerH = rect.height;
    const newTimelineH = Math.max(
      MIN_TIMELINE_H,
      Math.min(containerH - MIN_PREVIEW_H, containerH - mouseY),
    );
    setTimelineH(newTimelineH);
  }, []);

  const handleDividerPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Keyboard: Escape to pop composition level
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && compositionStack.length > 1) {
        setCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    [compositionStack.length],
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full min-h-0 bg-neutral-950"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Preview — takes remaining space above timeline */}
      <div className="flex-1 min-h-0 relative">
        <NLEPreview
          projectId={projectId}
          iframeRef={iframeRef}
          onIframeLoad={onIframeLoad}
          portrait={portrait}
          directUrl={directUrl}
          refreshKey={refreshKey}
        />
        {previewOverlay}
      </div>

      {/* Resize divider */}
      <div
        className="h-1 flex-shrink-0 bg-neutral-800 hover:bg-blue-500 cursor-row-resize transition-colors active:bg-blue-400 z-10"
        style={{ touchAction: "none" }}
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={handleDividerPointerUp}
      />

      {/* Timeline section — fixed height, resizable */}
      <div className="flex flex-col flex-shrink-0" style={{ height: timelineH }}>
        {/* Breadcrumb + Player controls */}
        <div className="bg-neutral-950 border-t border-neutral-800/50 flex-shrink-0">
          {compositionStack.length > 1 && (
            <CompositionBreadcrumb
              stack={compositionStack}
              onNavigate={handleNavigateComposition}
            />
          )}
          <PlayerControls onTogglePlay={togglePlay} onSeek={seek} />
        </div>

        {/* Timeline tracks */}
        <div
          className="flex-1 min-h-0 overflow-y-auto bg-neutral-950"
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-clip]")) return;
            if (compositionStack.length > 1) {
              setCompositionStack((prev) => prev.slice(0, -1));
            }
          }}
        >
          <Timeline onSeek={seek} onDrillDown={handleDrillDown} />
          {timelineFooter}
        </div>
      </div>
    </div>
  );
});
