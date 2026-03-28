import { useState, useCallback, useRef, useEffect, memo, type ReactNode } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { useTimelinePlayer, PlayerControls, Timeline, usePlayerStore } from "../../player";
import type { TimelineElement } from "../../player";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb, type CompositionLevel } from "./CompositionBreadcrumb";

interface NLELayoutProps {
  projectId: string;
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  /** Slot rendered above the timeline tracks (toolbar with split, delete, zoom) */
  timelineToolbar?: ReactNode;
  /** Slot rendered below the timeline tracks */
  timelineFooter?: ReactNode;
  /** Increment to force the preview to reload (e.g., after file writes) */
  refreshKey?: number;
  /** Navigate to a specific composition path (e.g., "compositions/intro.html") */
  activeCompositionPath?: string | null;
  /** Callback to expose the iframe ref (for element picker, etc.) */
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
  /** Callback when the viewed composition changes (drill-down/back) */
  onCompositionChange?: (compositionPath: string | null) => void;
  /** Custom clip content renderer for timeline (thumbnails, waveforms, etc.) */
  renderClipContent?: (
    element: TimelineElement,
    style: { clip: string; label: string },
  ) => ReactNode;
  /** Exposes the compIdToSrc map for parent components (e.g., useRenderClipContent) */
  onCompIdToSrcChange?: (map: Map<string, string>) => void;
}

const MIN_TIMELINE_H = 100;
const DEFAULT_TIMELINE_H = 220;
const MIN_PREVIEW_H = 120;

export const NLELayout = memo(function NLELayout({
  projectId,
  portrait,
  previewOverlay,
  timelineToolbar,
  timelineFooter,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
  onCompositionChange,
  renderClipContent,
  onCompIdToSrcChange,
}: NLELayoutProps) {
  const {
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad: baseOnIframeLoad,
    saveSeekPosition,
  } = useTimelinePlayer();

  // Reset timeline state when the project changes to prevent stale data from a
  // previous project leaking into the new one.
  const prevProjectIdRef = useRef(projectId);
  if (prevProjectIdRef.current !== projectId) {
    prevProjectIdRef.current = projectId;
    // Only reset Zustand state during render (safe — pure state update).
    // Imperative cleanup (RAF, intervals) happens in resetPlayer's store reset.
    usePlayerStore.getState().reset();
  }

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
  useMountEffect(() => {
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
        onCompIdToSrcChange?.(map);
      })
      .catch(() => {});
  });

  // Patch elements with compositionSrc whenever elements or compIdToSrc change.
  // The runtime strips data-composition-src from the DOM after loading, so elements
  // arrive without it. This bridges the gap using the map built from raw HTML.
  // Map keys are composition IDs (e.g. "dark-intro"), while element IDs may be
  // DOM IDs with suffixes (e.g. "dark-intro-host"), so we try multiple lookups.
  const compIdToSrcRef = useRef(compIdToSrc);
  compIdToSrcRef.current = compIdToSrc;
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (compIdToSrc.size === 0) return;
    const patchElements = (elements: TimelineElement[]): TimelineElement[] | null => {
      const map = compIdToSrcRef.current;
      if (map.size === 0) return null;
      let patched = false;
      const updated = elements.map((el) => {
        if (el.compositionSrc) return el;
        // Try exact match, then strip common suffixes (-host, -comp, -layer)
        const src = map.get(el.id) ?? map.get(el.id.replace(/-(host|comp|layer)$/, ""));
        if (src) {
          patched = true;
          return { ...el, compositionSrc: src };
        }
        return el;
      });
      return patched ? updated : null;
    };
    // Patch current elements immediately
    const patched = patchElements(usePlayerStore.getState().elements);
    if (patched) usePlayerStore.getState().setElements(patched);
    // Subscribe for future element updates — use a flag to prevent re-entrant patching
    let patching = false;
    return usePlayerStore.subscribe((state, prev) => {
      if (patching) return;
      if (state.elements === prev.elements || state.elements.length === 0) return;
      // Skip if all elements already have compositionSrc
      if (state.elements.every((el) => el.compositionSrc)) return;
      patching = true;
      const result = patchElements(state.elements);
      if (result) state.setElements(result);
      patching = false;
    });
  }, [compIdToSrc]);

  // Composition drill-down stack
  const [compositionStack, setCompositionStack] = useState<CompositionLevel[]>([
    { id: "master", label: "Master", previewUrl: `/api/projects/${projectId}/preview` },
  ]);

  // Wrap setCompositionStack to auto-notify parent on composition change
  const onCompositionChangeRef = useRef(onCompositionChange);
  onCompositionChangeRef.current = onCompositionChange;
  const updateCompositionStack: typeof setCompositionStack = useCallback((action) => {
    setCompositionStack((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      const id = next[next.length - 1]?.id;
      queueMicrotask(() => onCompositionChangeRef.current?.(id === "master" ? null : id));
      return next;
    });
  }, []);

  // Resizable timeline height
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE_H);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Current preview URL — derived from composition stack
  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;

  // Save master seek position before drilling down so we can restore it on back-navigation.
  // saveSeekPosition() sets pendingSeekRef in useTimelinePlayer which onIframeLoad reads.
  const masterSeekRef = useRef(0);

  // Drill-down: push a sub-composition onto the stack
  const iframeRef_ = iframeRef; // stable ref for the callback
  const handleDrillDown = useCallback(
    (element: TimelineElement) => {
      if (!element.compositionSrc) return;
      // Save current master playback position for back-navigation
      masterSeekRef.current = usePlayerStore.getState().currentTime;
      saveSeekPosition();
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
      updateCompositionStack((prev) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, compIdToSrc],
  );

  // Navigate back to a specific breadcrumb level
  const handleNavigateComposition = useCallback((index: number) => {
    // When going back to master (index 0), restore the saved master position
    if (index === 0 && masterSeekRef.current > 0) {
      usePlayerStore.getState().setCurrentTime(masterSeekRef.current);
    }
    saveSeekPosition();
    usePlayerStore.getState().setElements([]);
    updateCompositionStack((prev) => prev.slice(0, index + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate to a composition when activeCompositionPath changes.
  // Uses useEffect to ensure state updates happen after render commit,
  // avoiding render-time mutations that React can swallow during batching.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (activeCompositionPath === "index.html") {
      usePlayerStore.getState().setElements([]);
      updateCompositionStack((prev) => (prev.length > 1 ? [prev[0]] : prev));
    } else if (activeCompositionPath && activeCompositionPath.startsWith("compositions/")) {
      const label = activeCompositionPath.replace(/^compositions\//, "").replace(/\.html$/, "");
      const previewUrl = `/api/projects/${projectId}/preview/comp/${activeCompositionPath}`;
      usePlayerStore.getState().setElements([]);
      updateCompositionStack((prev) => {
        if (prev[prev.length - 1]?.id === activeCompositionPath) return prev;
        return [
          { id: "master", label: "Master", previewUrl: `/api/projects/${projectId}/preview` },
          { id: activeCompositionPath, label, previewUrl },
        ];
      });
    } else if (!activeCompositionPath) {
      usePlayerStore.getState().setElements([]);
    }
  }, [activeCompositionPath, projectId, updateCompositionStack]);

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
        updateCompositionStack((prev) => prev.slice(0, -1));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              updateCompositionStack((prev) => prev.slice(0, -1));
            }
          }}
        >
          {timelineToolbar}
          <Timeline
            onSeek={seek}
            onDrillDown={handleDrillDown}
            renderClipContent={renderClipContent}
          />
          {timelineFooter}
        </div>
      </div>
    </div>
  );
});
