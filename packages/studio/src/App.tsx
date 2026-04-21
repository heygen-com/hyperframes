import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { CompositionThumbnail, VideoThumbnail, usePlayerStore } from "./player";
import { AudioWaveform } from "./player/components/AudioWaveform";
import type { TimelineElement } from "./player";
import { LintModal } from "./components/LintModal";
import type { LintFinding } from "./components/LintModal";
import { MediaPreview } from "./components/MediaPreview";
import { isMediaFile } from "./utils/mediaTypes";
import { CaptionOverlay } from "./captions/components/CaptionOverlay";
import { CaptionPropertyPanel } from "./captions/components/CaptionPropertyPanel";
import { CaptionTimeline } from "./captions/components/CaptionTimeline";
import { useCaptionStore } from "./captions/store";
import { useCaptionSync } from "./captions/hooks/useCaptionSync";
import { parseCaptionComposition } from "./captions/parser";
import { applyPatchByTarget, readAttributeByTarget } from "./utils/sourcePatcher";
import {
  buildTrackZIndexMap,
  formatTimelineAttributeNumber,
} from "./player/components/timelineEditing";
import {
  getNextTimelineZoomPercent,
  getTimelineZoomPercent,
} from "./player/components/timelineZoom";

interface EditingFile {
  path: string;
  content: string | null;
}

// ── Main App ──

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useMountEffect(() => {
    const hashMatch = window.location.hash.match(/^#project\/([^/]+)/);
    if (hashMatch) {
      setProjectId(hashMatch[1]);
      setResolving(false);
      return;
    }
    // No hash — auto-select first available project
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const first = (data.projects ?? [])[0];
        if (first) {
          setProjectId(first.id);
          window.location.hash = `#project/${first.id}`;
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  });

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const renderQueue = useRenderQueue(projectId);
  const captionEditMode = useCaptionStore((s) => s.isEditMode);
  const captionHasSelection = useCaptionStore((s) => s.selectedSegmentIds.size > 0);
  const captionSync = useCaptionSync(projectId);

  // Resizable and collapsible panel widths
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  // Auto-enter caption edit mode when the iframe contains .caption-group elements.
  // This is a subscription to external events (postMessage from runtime) — useEffect
  // is appropriate here. The runtime fires "state"/"timeline" messages after all
  // compositions load, which triggers caption detection.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    let activating = false;

    const tryActivateCaptions = () => {
      if (useCaptionStore.getState().isEditMode || activating) {
        return;
      }

      const iframe = previewIframeRef.current;
      let doc: Document | null = null;
      let win: Window | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
        win = iframe?.contentWindow ?? null;
      } catch {
        return;
      }
      if (!doc || !win) return;

      const groups = doc.querySelectorAll(".caption-group");
      if (groups.length === 0) return;

      // Find the captions composition source path.
      // The runtime strips data-composition-src after loading, so also check
      // data-composition-file (set by the bundler) and the compIdToSrc map.
      let captionSrcPath: string | null = null;

      // Strategy 1: data-composition-src or data-composition-file attributes
      const compHosts = doc.querySelectorAll("[data-composition-src], [data-composition-file]");
      for (const host of compHosts) {
        const src =
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
        if (src && src.includes("captions")) {
          captionSrcPath = src;
          break;
        }
      }

      // Strategy 2: compIdToSrc map (built from raw index.html before runtime strips attrs)
      if (!captionSrcPath) {
        for (const [id, src] of compIdToSrc) {
          if (id.includes("caption") || src.includes("caption")) {
            captionSrcPath = src;
            break;
          }
        }
      }

      // Strategy 3: activeCompPath if viewing captions directly
      if (!captionSrcPath && activeCompPath?.includes("captions")) {
        captionSrcPath = activeCompPath;
      }

      // Strategy 4: find composition element with "caption" in its ID
      if (!captionSrcPath) {
        const captionComp = doc.querySelector('[data-composition-id*="caption"]');
        if (captionComp) {
          const compId = captionComp.getAttribute("data-composition-id") || "";
          captionSrcPath = compIdToSrc.get(compId) || null;
        }
      }

      if (!captionSrcPath) return;

      activating = true;
      const srcPath = captionSrcPath;
      fetch(`/api/projects/${projectId}/files/${encodeURIComponent(srcPath)}`)
        .then((r) => r.json())
        .then((data: { content?: string }) => {
          if (!data.content || !doc || !win || useCaptionStore.getState().isEditMode) return;
          const root = doc.querySelector("[data-composition-id]");
          const w = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
          const h = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
          const dur = parseFloat(root?.getAttribute("data-duration") ?? "0");
          const model = parseCaptionComposition(doc, win, data.content, w, h, dur);
          if (!model) return;
          const store = useCaptionStore.getState();
          store.setModel(model);
          store.setSourceFilePath(srcPath);
          store.setEditMode(true);
          captionSync.loadOverrides();
        })
        .catch(() => {})
        .finally(() => {
          activating = false;
        });
    };

    // Listen for runtime messages that signal composition loading is complete
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        tryActivateCaptions();
      }
    };

    window.addEventListener("message", handleMessage);
    // Try immediately in case compositions are already loaded
    tryActivateCaptions();

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [activeCompPath, projectId, compIdToSrc, captionSync]);

  // Auto-expand right panel when a caption word is selected
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) {
      setRightCollapsed(!captionHasSelection);
    }
  }, [captionHasSelection, captionEditMode]);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [uploadToast, setUploadToast] = useState<string | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const dragCounterRef = useRef(0);
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);

  // Derive active preview URL from composition path (for drilled-down thumbnails)
  const activePreviewUrl = activeCompPath
    ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
    : null;
  const zoomMode = usePlayerStore((s) => s.zoomMode);
  const manualZoomPercent = usePlayerStore((s) => s.manualZoomPercent);
  const setZoomMode = usePlayerStore((s) => s.setZoomMode);
  const setManualZoomPercent = usePlayerStore((s) => s.setManualZoomPercent);
  const timelineElements = usePlayerStore((s) => s.elements);
  const timelineDuration = usePlayerStore((s) => s.duration);
  const effectiveTimelineDuration = useMemo(() => {
    const maxEnd =
      timelineElements.length > 0
        ? Math.max(...timelineElements.map((element) => element.start + element.duration))
        : 0;
    return Math.max(timelineDuration, maxEnd);
  }, [timelineDuration, timelineElements]);
  const displayedTimelineZoomPercent = useMemo(
    () => getTimelineZoomPercent(zoomMode, manualZoomPercent),
    [zoomMode, manualZoomPercent],
  );

  const renderClipContent = useCallback(
    (el: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      const pid = projectIdRef.current;
      if (!pid) return null;

      // Resolve composition source path using the compIdToSrc map
      let compSrc = el.compositionSrc;
      if (compSrc && compIdToSrc.size > 0) {
        const resolved =
          compIdToSrc.get(el.id) ||
          compIdToSrc.get(compSrc.replace(/^compositions\//, "").replace(/\.html$/, ""));
        if (resolved) compSrc = resolved;
      }

      // Composition clips — always use the comp's own preview URL for thumbnails.
      // This renders the composition in isolation so we get clean frames
      // instead of capturing the master at a time when the comp is fading in.
      if (compSrc) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${pid}/preview/comp/${compSrc}`}
            label={el.id || el.tag}
            labelColor={style.label}
            accentColor={style.clip}
            selector={el.selector}
            seekTime={0}
            duration={el.duration}
          />
        );
      }

      // When drilled into a composition, render all inner elements via
      // CompositionThumbnail at their start time — most accurate visual.
      if (activePreviewUrl && el.duration > 0) {
        return (
          <CompositionThumbnail
            previewUrl={activePreviewUrl}
            label={el.id || el.tag}
            labelColor={style.label}
            accentColor={style.clip}
            selector={el.selector}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      const htmlPreviewEligible =
        el.duration > 0 &&
        effectiveTimelineDuration > 0 &&
        el.duration < effectiveTimelineDuration * 0.92 &&
        !/(backdrop|background|overlay|scrim|mask)/i.test(el.id);

      // Audio clips — waveform visualization
      if (el.tag === "audio") {
        const audioUrl = el.src
          ? el.src.startsWith("http")
            ? el.src
            : `/api/projects/${pid}/preview/${el.src}`
          : "";
        return (
          <AudioWaveform audioUrl={audioUrl} label={el.id || el.tag} labelColor={style.label} />
        );
      }

      if ((el.tag === "video" || el.tag === "img") && el.src) {
        const mediaSrc = el.src.startsWith("http")
          ? el.src
          : `/api/projects/${pid}/preview/${el.src}`;
        return (
          <VideoThumbnail
            videoSrc={mediaSrc}
            label={el.id || el.tag}
            labelColor={style.label}
            duration={el.duration}
          />
        );
      }

      if (htmlPreviewEligible) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${pid}/preview`}
            label={el.id || el.tag}
            labelColor={style.label}
            accentColor={style.clip}
            selector={el.selector}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      return null;
    },
    [compIdToSrc, activePreviewUrl, effectiveTimelineDuration],
  );
  const timelineToolbar = (
    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800/40 bg-neutral-950/96">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
        Timeline
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setZoomMode("fit")}
          className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
            zoomMode === "fit"
              ? "border-studio-accent/30 bg-studio-accent/10 text-studio-accent"
              : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
          }`}
          title="Fit timeline to width"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => {
            setZoomMode("manual");
            setManualZoomPercent(getNextTimelineZoomPercent("out", zoomMode, manualZoomPercent));
          }}
          className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
          title="Zoom out"
        >
          -
        </button>
        <div className="min-w-[58px] text-center text-[10px] font-medium tabular-nums text-neutral-500">
          {`${displayedTimelineZoomPercent}%`}
        </div>
        <button
          type="button"
          onClick={() => {
            setZoomMode("manual");
            setManualZoomPercent(getNextTimelineZoomPercent("in", zoomMode, manualZoomPercent));
          }}
          className="h-7 w-7 rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const consoleErrorsRef = useRef<LintFinding[]>([]);

  // Listen for external file changes (user editing HTML outside the editor).
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  useMountEffect(() => {
    const handler = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 400);
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for embedded studio server
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  });
  projectIdRef.current = projectId;

  // Load file tree when projectId changes.
  // Note: This is one of the few places where useEffect with deps is acceptable —
  // it's data fetching tied to a prop change. Ideally this would use a data-fetching
  // library (useQuery/useSWR) or the parent component would own the fetch.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[] }) => {
        if (!cancelled && data.files) setFileTree(data.files);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Expand left panel to 50vw when opening a file in Code tab
    setLeftWidth((prev) => Math.max(prev, Math.floor(window.innerWidth * 0.5)));
    // Skip fetching binary content for media files — just set the path for preview
    if (isMediaFile(path)) {
      setEditingFile({ path, content: null });
      return;
    }
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          setEditingFile({ path, content: data.content });
        }
      })
      .catch(() => {});
  }, []);

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;

  const handleContentChange = useCallback((content: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const path = editingPathRef.current;
    if (!path) return;

    // Debounce the server write (600ms)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: content,
      })
        .then(() => {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 600);
        })
        .catch(() => {});
    }, 600);
  }, []);

  const handleTimelineElementMove = useCallback(
    async (element: TimelineElement, updates: Pick<TimelineElement, "start" | "track">) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const resolvedTargetPath = targetPath || "index.html";
      const relevantElements = timelineElements
        .map((timelineElement) =>
          (timelineElement.key ?? timelineElement.id) === (element.key ?? element.id)
            ? { ...timelineElement, start: updates.start, track: updates.track }
            : timelineElement,
        )
        .filter(
          (timelineElement) =>
            (timelineElement.sourceFile || activeCompPath || "index.html") === resolvedTargetPath,
        );
      const trackZIndices = buildTrackZIndexMap(
        relevantElements.map((timelineElement) => timelineElement.track),
      );

      let patchedContent = applyPatchByTarget(originalContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "track-index",
        value: String(updates.track),
      });
      for (const timelineElement of relevantElements) {
        const elementTarget = timelineElement.domId
          ? {
              id: timelineElement.domId,
              selector: timelineElement.selector,
              selectorIndex: timelineElement.selectorIndex,
            }
          : timelineElement.selector
            ? {
                selector: timelineElement.selector,
                selectorIndex: timelineElement.selectorIndex,
              }
            : null;
        if (!elementTarget) continue;
        const nextZIndex = trackZIndices.get(timelineElement.track);
        if (nextZIndex == null) continue;
        patchedContent = applyPatchByTarget(patchedContent, elementTarget, {
          type: "inline-style",
          property: "z-index",
          value: String(nextZIndex),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      const saveResponse = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: patchedContent,
        },
      );
      if (!saveResponse.ok) {
        throw new Error(`Failed to save ${targetPath}`);
      }

      if (editingPathRef.current === targetPath) {
        setEditingFile({ path: targetPath, content: patchedContent });
      }

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath, timelineElements],
  );

  const handleTimelineElementResize = useCallback(
    async (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const pid = projectIdRef.current;
      if (!pid) throw new Error("No active project");

      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const response = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read ${targetPath}`);
      }

      const data = (await response.json()) as { content?: string };
      const originalContent = data.content;
      if (typeof originalContent !== "string") {
        throw new Error(`Missing file contents for ${targetPath}`);
      }

      const patchTarget = element.domId
        ? { id: element.domId, selector: element.selector, selectorIndex: element.selectorIndex }
        : element.selector
          ? { selector: element.selector, selectorIndex: element.selectorIndex }
          : null;
      if (!patchTarget) {
        throw new Error(`Timeline element ${element.id} is missing a patchable target`);
      }

      const playbackStartAttrName =
        element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
      const currentPlaybackStartValue =
        readAttributeByTarget(originalContent, patchTarget, "playback-start") ??
        readAttributeByTarget(originalContent, patchTarget, "media-start");
      const currentPlaybackStart =
        currentPlaybackStartValue != null ? parseFloat(currentPlaybackStartValue) : undefined;
      const trimDelta = updates.start - element.start;
      const fallbackPlaybackStart =
        updates.playbackStart == null &&
        trimDelta !== 0 &&
        Number.isFinite(currentPlaybackStart) &&
        currentPlaybackStart != null
          ? Math.max(0, currentPlaybackStart + trimDelta * Math.max(element.playbackRate ?? 1, 0.1))
          : undefined;
      const nextPlaybackStart = updates.playbackStart ?? fallbackPlaybackStart;

      let patchedContent = originalContent;
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
        type: "attribute",
        property: "duration",
        value: formatTimelineAttributeNumber(updates.duration),
      });
      if (nextPlaybackStart != null) {
        patchedContent = applyPatchByTarget(patchedContent, patchTarget, {
          type: "attribute",
          property: playbackStartAttrName,
          value: formatTimelineAttributeNumber(nextPlaybackStart),
        });
      }

      if (patchedContent === originalContent) {
        throw new Error(`Unable to patch timeline element ${element.id} in ${targetPath}`);
      }

      const saveResponse = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: patchedContent,
        },
      );
      if (!saveResponse.ok) {
        throw new Error(`Failed to save ${targetPath}`);
      }

      if (editingPathRef.current === targetPath) {
        setEditingFile({ path: targetPath, content: patchedContent });
      }

      setRefreshKey((k) => k + 1);
    },
    [activeCompPath],
  );

  // ── File Management Handlers ──

  const refreshFileTree = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const res = await fetch(`/api/projects/${pid}`);
    const data = await res.json();
    if (data.files) setFileTree(data.files);
  }, []);

  const handleCreateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      let content = "";
      if (path.endsWith(".html")) {
        content =
          '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body>\n\n</body>\n</html>\n';
      }
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
      if (res.ok) {
        await refreshFileTree();
        handleFileSelect(path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create file failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleCreateFolder = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      // Create a .gitkeep inside the folder so it appears in the tree
      const res = await fetch(
        `/api/projects/${pid}/files/${encodeURIComponent(path + "/.gitkeep")}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "",
        },
      );
      if (res.ok) {
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create folder failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (editingPathRef.current === path) setEditingFile(null);
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Delete failed: ${err.error}`);
      }
    },
    [refreshFileTree],
  );

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(oldPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (res.ok) {
        if (editingPathRef.current === oldPath) {
          handleFileSelect(newPath);
        }
        await refreshFileTree();
        // Refresh preview — references in compositions may have been updated
        setRefreshKey((k) => k + 1);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Rename failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await fetch(`/api/projects/${pid}/duplicate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = await res.json();
        await refreshFileTree();
        if (data.path) handleFileSelect(data.path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Duplicate failed: ${err.error}`);
      }
    },
    [refreshFileTree, handleFileSelect],
  );

  const handleMoveFile = handleRenameFile;

  const showUploadToast = useCallback((msg: string) => {
    setUploadToast(msg);
    setTimeout(() => setUploadToast(null), 4000);
  }, []);

  const handleImportFiles = useCallback(
    async (files: FileList, dir?: string) => {
      const pid = projectIdRef.current;
      if (!pid || files.length === 0) return;

      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("file", file);
      }

      const qs = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      try {
        const res = await fetch(`/api/projects/${pid}/upload${qs}`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.skipped?.length) {
            showUploadToast(`Skipped (too large): ${data.skipped.join(", ")}`);
          }
          await refreshFileTree();
          setRefreshKey((k) => k + 1);
        } else if (res.status === 413) {
          showUploadToast("Upload rejected: payload too large");
        } else {
          showUploadToast(`Upload failed (${res.status})`);
        }
      } catch {
        showUploadToast("Upload failed: network error");
      }
    },
    [refreshFileTree, showUploadToast],
  );

  const handleLint = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setLinting(true);
    try {
      const res = await fetch(`/api/projects/${pid}/lint`);
      const data = await res.json();
      const findings: LintFinding[] = (data.findings ?? []).map(
        (f: { severity?: string; message?: string; file?: string; fixHint?: string }) => ({
          severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
          message: f.message ?? "",
          file: f.file,
          fixHint: f.fixHint,
        }),
      );
      setLintModal(findings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, []);

  // Panel resize via pointer events (works for both left sidebar and right panel)
  const handlePanelResizeStart = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panelDragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const maxLeft = Math.floor(window.innerWidth * 0.5);
    const newW = Math.max(
      160,
      Math.min(
        drag.side === "left" ? maxLeft : 600,
        drag.startW + (drag.side === "left" ? delta : -delta),
      ),
    );
    if (drag.side === "left") setLeftWidth(newW);
    else setRightWidth(newW);
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    panelDragRef.current = null;
  }, []);

  const compositions = useMemo(
    () => fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/")),
    [fileTree],
  );
  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );

  if (resolving || !projectId) {
    return (
      <div className="h-full w-full bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-studio-accent animate-pulse" />
      </div>
    );
  }

  // At this point projectId is guaranteed non-null (narrowed by the guard above)

  return (
    <div
      className="flex flex-col h-full w-full bg-neutral-950 relative"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragCounterRef.current++;
        setGlobalDragOver(true);
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setGlobalDragOver(false);
      }}
      onDrop={(e) => {
        dragCounterRef.current = 0;
        setGlobalDragOver(false);
        // Skip if a child (e.g. AssetsTab) already handled the drop
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (e.dataTransfer.files.length) handleImportFiles(e.dataTransfer.files);
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between h-10 px-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        {/* Left: project name */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-neutral-400">{projectId}</span>
        </div>
        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLeftCollapsed((v) => !v)}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              !leftCollapsed
                ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
                : "bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
            title={leftCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <button
            onClick={() => setTimelineVisible((v) => !v)}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              timelineVisible
                ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
                : "bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
            title={timelineVisible ? "Hide timeline" : "Show timeline"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <rect x="3" y="13" width="18" height="8" rx="1" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="5" x2="21" y2="5" />
            </svg>
          </button>
          <button
            onClick={() => setRightCollapsed((v) => !v)}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
              !rightCollapsed
                ? "text-studio-accent bg-studio-accent/10 border-studio-accent/30"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-transparent"
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
            </svg>
            Renders
            {renderQueue.jobs.length > 0 ? ` (${renderQueue.jobs.length})` : ""}
          </button>
        </div>
      </div>

      {/* Main content: sidebar + preview + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Compositions + Assets (resizable, collapsible) */}
        {!leftCollapsed && (
          <LeftSidebar
            width={leftWidth}
            projectId={projectId}
            compositions={compositions}
            assets={assets}
            activeComposition={editingFile?.path ?? null}
            onSelectComposition={(comp) => {
              // Set active composition for preview drill-down
              // Don't increment refreshKey — that reloads the master iframe and
              // overrides the composition navigation. Let activeCompositionPath
              // handle the preview change via the composition stack.
              setActiveCompPath(
                comp === "index.html" || comp.startsWith("compositions/") ? comp : null,
              );
              // Load file content for code editor
              setEditingFile({ path: comp, content: null });
              fetch(`/api/projects/${projectId}/files/${comp}`)
                .then((r) => r.json())
                .then((data) => setEditingFile({ path: comp, content: data.content }))
                .catch(() => {});
            }}
            fileTree={fileTree}
            editingFile={editingFile}
            onSelectFile={handleFileSelect}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
            onDuplicateFile={handleDuplicateFile}
            onMoveFile={handleMoveFile}
            onImportFiles={handleImportFiles}
            codeChildren={
              editingFile ? (
                isMediaFile(editingFile.path) ? (
                  <MediaPreview projectId={projectId ?? ""} filePath={editingFile.path} />
                ) : (
                  <SourceEditor
                    content={editingFile.content ?? ""}
                    filePath={editingFile.path}
                    onChange={handleContentChange}
                  />
                )
              ) : undefined
            }
            onLint={handleLint}
            linting={linting}
          />
        )}

        {/* Left resize handle */}
        {!leftCollapsed && (
          <div
            className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handlePanelResizeStart("left", e)}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
          >
            <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
          </div>
        )}

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            timelineToolbar={timelineToolbar}
            renderClipContent={renderClipContent}
            onMoveElement={handleTimelineElementMove}
            onResizeElement={handleTimelineElementResize}
            onCompIdToSrcChange={setCompIdToSrc}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              setActiveCompPath(compPath);
            }}
            onIframeRef={(iframe) => {
              previewIframeRef.current = iframe;
              consoleErrorsRef.current = [];
              setConsoleErrors(null);
              if (!iframe) return;

              // Attach error capture after each iframe load (content resets on navigation)
              const attachErrorCapture = () => {
                try {
                  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
                  if (!win) return;
                  // Guard against double-patching
                  if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
                  (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
                  const origError = win.console.error.bind(win.console);
                  win.console.error = function (...args: unknown[]) {
                    origError(...args);
                    const text = args
                      .map((a) => (a instanceof Error ? a.message : String(a)))
                      .join(" ");
                    if (text.includes("favicon")) return;
                    consoleErrorsRef.current = [
                      ...consoleErrorsRef.current,
                      { severity: "error", message: text },
                    ];
                    setConsoleErrors([...consoleErrorsRef.current]);
                  };
                  win.addEventListener("error", (e: ErrorEvent) => {
                    const text = e.message || String(e);
                    consoleErrorsRef.current = [
                      ...consoleErrorsRef.current,
                      { severity: "error", message: text },
                    ];
                    setConsoleErrors([...consoleErrorsRef.current]);
                  });
                } catch {
                  // cross-origin — can't attach
                }
              };
              // Attach now (iframe may already be loaded) and on future loads
              attachErrorCapture();
              iframe.addEventListener("load", () => {
                consoleErrorsRef.current = [];
                setConsoleErrors(null);
                attachErrorCapture();
              });
            }}
            previewOverlay={
              captionEditMode ? <CaptionOverlay iframeRef={previewIframeRef} /> : undefined
            }
            timelineFooter={
              captionEditMode ? (
                <div
                  className="border-t border-neutral-800/30 flex-shrink-0"
                  style={{ height: 60 }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">
                      Captions
                    </span>
                  </div>
                  <CaptionTimeline pixelsPerSecond={100} />
                </div>
              ) : undefined
            }
            timelineVisible={timelineVisible}
            onToggleTimeline={() => setTimelineVisible((v) => !v)}
          />
        </div>

        {/* Right panel: Renders-only (resizable, collapsible via header Renders button) */}
        {!rightCollapsed && (
          <>
            <div
              className="group w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => handlePanelResizeStart("right", e)}
              onPointerMove={handlePanelResizeMove}
              onPointerUp={handlePanelResizeEnd}
            >
              <div className="h-[52px] w-px bg-white/12 transition-colors group-hover:bg-white/18 group-active:bg-white/24" />
            </div>
            <div
              className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
              style={{ width: rightWidth }}
            >
              {captionEditMode ? (
                <CaptionPropertyPanel iframeRef={previewIframeRef} />
              ) : (
                <RenderQueue
                  jobs={renderQueue.jobs}
                  projectId={projectId}
                  onDelete={renderQueue.deleteRender}
                  onClearCompleted={renderQueue.clearCompleted}
                  onStartRender={(format, quality) => renderQueue.startRender(30, quality, format)}
                  isRendering={renderQueue.isRendering}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Lint modal */}
      {lintModal !== null && projectId && (
        <LintModal findings={lintModal} projectId={projectId} onClose={() => setLintModal(null)} />
      )}

      {/* Console errors modal — auto-shows when composition has runtime errors */}
      {consoleErrors !== null && consoleErrors.length > 0 && projectId && (
        <LintModal
          findings={consoleErrors}
          projectId={projectId}
          onClose={() => setConsoleErrors(null)}
        />
      )}

      {/* Global drag-drop overlay */}
      {globalDragOver && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl border-2 border-dashed border-studio-accent/60 bg-studio-accent/[0.06]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-studio-accent"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="text-sm font-medium text-studio-accent">
              Drop files to import into project
            </span>
          </div>
        </div>
      )}
      {uploadToast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[91] px-4 py-2 rounded-lg bg-red-900/90 border border-red-700/50 text-sm text-red-200 shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {uploadToast}
        </div>
      )}
    </div>
  );
}
