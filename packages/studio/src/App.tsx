import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { CompositionThumbnail, VideoThumbnail } from "./player";
import { AudioWaveform } from "./player/components/AudioWaveform";
import type { TimelineElement } from "./player";
import { LintModal } from "./components/LintModal";
import type { LintFinding } from "./components/LintModal";
import { MediaPreview } from "./components/MediaPreview";
import { isMediaFile } from "./utils/mediaTypes";

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

  // Resizable and collapsible panel widths
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [uploadToast, setUploadToast] = useState<string | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(false);
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
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

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

      // HTML scene elements — render from the master preview at the scene's time
      if (el.tag === "div" && el.duration > 0) {
        const previewUrl = `/api/projects/${pid}/preview`;
        return (
          <CompositionThumbnail
            previewUrl={previewUrl}
            label={el.id || el.tag}
            labelColor={style.label}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      return null;
    },
    [compIdToSrc, activePreviewUrl],
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

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
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-studio-accent animate-pulse" />
      </div>
    );
  }

  // At this point projectId is guaranteed non-null (narrowed by the guard above)

  return (
    <div
      className="flex flex-col h-screen w-screen bg-neutral-950 relative"
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
            className="w-1 flex-shrink-0 bg-neutral-800 hover:bg-studio-accent cursor-col-resize transition-colors active:bg-studio-accent/80"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handlePanelResizeStart("left", e)}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
          />
        )}

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            renderClipContent={renderClipContent}
            onCompIdToSrcChange={setCompIdToSrc}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              setActiveCompPath(compPath);
            }}
            onIframeRef={(iframe) => {
              previewIframeRef.current = iframe;
            }}
            timelineVisible={timelineVisible}
            onToggleTimeline={() => setTimelineVisible((v) => !v)}
          />
        </div>

        {/* Right panel: Renders-only (resizable, collapsible via header Renders button) */}
        {!rightCollapsed && (
          <>
            <div
              className="w-1 flex-shrink-0 bg-neutral-800 hover:bg-studio-accent cursor-col-resize transition-colors active:bg-studio-accent/80"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => handlePanelResizeStart("right", e)}
              onPointerMove={handlePanelResizeMove}
              onPointerUp={handlePanelResizeEnd}
            />
            <div
              className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
              style={{ width: rightWidth }}
            >
              <RenderQueue
                jobs={renderQueue.jobs}
                projectId={projectId}
                onDelete={renderQueue.deleteRender}
                onClearCompleted={renderQueue.clearCompleted}
                onStartRender={(format) => renderQueue.startRender(30, "standard", format)}
                isRendering={renderQueue.isRendering}
              />
            </div>
          </>
        )}
      </div>

      {/* Lint modal */}
      {lintModal !== null && projectId && (
        <LintModal findings={lintModal} projectId={projectId} onClose={() => setLintModal(null)} />
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
