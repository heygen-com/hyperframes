import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { FileTree } from "./components/editor/FileTree";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { CompositionThumbnail } from "./player/components/CompositionThumbnail";
import { VideoThumbnail } from "./player/components/VideoThumbnail";
import type { TimelineElement } from "./player/store/playerStore";
import {
  XIcon,
  CodeIcon,
  WarningIcon,
  CheckCircleIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";

interface EditingFile {
  path: string;
  content: string | null;
}

interface ProjectEntry {
  id: string;
  title?: string;
  sessionId?: string;
}

interface LintFinding {
  severity: "error" | "warning";
  message: string;
  file?: string;
  fixHint?: string;
}

// ── Project Picker ──

function ProjectPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: { projects?: ProjectEntry[] }) => {
        setProjects(data.projects ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="h-screen w-screen bg-neutral-950 overflow-y-auto">
      <div className="max-w-lg w-full mx-auto px-4 py-12">
        <h1 className="text-xl font-semibold text-neutral-200 mb-1">HyperFrames Studio</h1>
        <p className="text-sm text-neutral-500 mb-6">Select a project to open</p>
        {loading ? (
          <div className="text-sm text-neutral-600">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-neutral-600">No projects found.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className="text-left px-4 py-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-600 hover:bg-neutral-800/80 transition-all group"
              >
                <div className="text-sm text-neutral-200 truncate">{p.title ?? p.id}</div>
                <div className="text-[11px] text-neutral-600 font-mono truncate mt-0.5 group-hover:text-neutral-500">
                  {p.id}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lint Modal ──

function LintModal({ findings, onClose }: { findings: LintFinding[]; onClose: () => void }) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const hasIssues = findings.length > 0;
  const [copied, setCopied] = useState(false);

  const handleCopyToAgent = async () => {
    const lines = findings.map((f) => {
      let line = `[${f.severity}] ${f.message}`;
      if (f.file) line += `\n  File: ${f.file}`;
      if (f.fixHint) line += `\n  Fix: ${f.fixHint}`;
      return line;
    });
    const text = `Fix these HyperFrames lint issues:\n\n${lines.join("\n\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            {hasIssues ? (
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                <WarningIcon size={18} className="text-red-400" weight="fill" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#3CE6AC]/10 flex items-center justify-center">
                <CheckCircleIcon size={18} className="text-[#3CE6AC]" weight="fill" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">
                {hasIssues
                  ? `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`
                  : "All checks passed"}
              </h2>
              <p className="text-xs text-neutral-500">HyperFrame Lint Results</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Copy to agent + findings */}
        {hasIssues && (
          <div className="flex items-center justify-end px-5 py-2 border-b border-neutral-800/50">
            <button
              onClick={handleCopyToAgent}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                copied ? "bg-green-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
              }`}
            >
              {copied ? "Copied!" : "Copy to Agent"}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!hasIssues && (
            <div className="py-8 text-center text-neutral-500 text-sm">
              No errors or warnings found. Your composition looks good!
            </div>
          )}
          {errors.map((f, i) => (
            <div key={`e-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon
                  size={14}
                  className="text-red-400 flex-shrink-0 mt-0.5"
                  weight="fill"
                />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-200">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon size={10} className="text-[#3CE6AC] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[#3CE6AC]">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {warnings.map((f, i) => (
            <div key={`w-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-300">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon size={10} className="text-[#3CE6AC] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[#3CE6AC]">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    const hash = window.location.hash;
    const projectMatch = hash.match(/project\/([^/]+)/);
    const sessionMatch = hash.match(/session\/([^/]+)/);
    if (projectMatch) {
      setProjectId(projectMatch[1]);
      setResolving(false);
    } else if (sessionMatch) {
      fetch(`/api/resolve-session/${sessionMatch[1]}`)
        .then((r) => r.json())
        .then((data: { projectId?: string }) => {
          if (data.projectId) {
            window.location.hash = `#project/${data.projectId}`;
            setProjectId(data.projectId);
          }
          setResolving(false);
        })
        .catch(() => setResolving(false));
    } else {
      setResolving(false);
    }
  }, []);

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());

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

      if (compSrc) {
        const previewUrl = `/api/projects/${pid}/preview/comp/${compSrc}`;
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

      // HTML scene divs — render from index.html at the scene's time
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
    [compIdToSrc],
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renderState, setRenderState] = useState<"idle" | "rendering" | "complete" | "error">(
    "idle",
  );
  const [renderProgress, setRenderProgress] = useState(0);
  const [_renderError, setRenderError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen for external file changes (user editing HTML outside the editor).
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  useEffect(() => {
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
  }, []);
  projectIdRef.current = projectId;

  // Load file tree when projectId changes
  const prevProjectIdRef = useRef<string | null>(null);
  if (projectId && projectId !== prevProjectIdRef.current) {
    prevProjectIdRef.current = projectId;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[] }) => {
        if (data.files) setFileTree(data.files);
      })
      .catch(() => {});
  }

  const handleSelectProject = useCallback((id: string) => {
    window.location.hash = `#project/${id}`;
    setProjectId(id);
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          setEditingFile({ path, content: data.content });
          setSidebarOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;

  const handleContentChange = useCallback((content: string) => {
    const pid = projectIdRef.current;
    const path = editingPathRef.current;
    if (!pid || !path) return;
    // Don't update editingFile state — the editor manages its own content.
    // Only save to disk and refresh the preview.
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
  }, []);

  const handleLint = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setLinting(true);
    try {
      // Fetch all HTML files and lint them client-side using the core linter
      const res = await fetch(`/api/projects/${pid}`);
      const data = await res.json();
      const files: string[] = data.files?.filter((f: string) => f.endsWith(".html")) ?? [];

      const findings: LintFinding[] = [];
      for (const file of files) {
        const fileRes = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(file)}`);
        const fileData = await fileRes.json();
        if (!fileData.content) continue;

        // Basic lint checks (subset of the full linter)
        const html = fileData.content as string;

        if (file === "index.html") {
          // Check for root composition
          if (!html.includes("data-composition-id")) {
            findings.push({
              severity: "error",
              message: "No element with `data-composition-id` found.",
              file,
              fixHint: "Add `data-composition-id` to the root composition wrapper.",
            });
          }
          // Check for timeline registration
          if (!html.includes("__timelines")) {
            findings.push({
              severity: "error",
              message: "Missing `window.__timelines` registration.",
              file,
              fixHint: 'Add: window.__timelines["compositionId"] = tl;',
            });
          }
          // Check for TARGET_DURATION
          if (
            html.includes("gsap.timeline") &&
            !html.includes("TARGET_DURATION") &&
            !html.includes("tl.set({}, {},")
          ) {
            findings.push({
              severity: "warning",
              message: "No TARGET_DURATION spacer found. Video may be shorter than intended.",
              file,
              fixHint:
                "Add: const TARGET_DURATION = 30; if (tl.duration() < TARGET_DURATION) { tl.set({}, {}, TARGET_DURATION); }",
            });
          }
        }

        // Check for composition hosts missing dimensions
        const hostRe = /data-composition-src=["']([^"']+)["']/g;
        let hostMatch;
        while ((hostMatch = hostRe.exec(html)) !== null) {
          const surrounding = html.slice(
            Math.max(0, hostMatch.index - 300),
            hostMatch.index + hostMatch[0].length + 50,
          );
          const hasDataDims =
            /data-width\s*=/i.test(surrounding) && /data-height\s*=/i.test(surrounding);
          const hasStyleDims = /style\s*=.*width:\s*\d+px.*height:\s*\d+px/i.test(surrounding);
          if (!hasDataDims && !hasStyleDims) {
            findings.push({
              severity: "warning",
              message: `Composition host for "${hostMatch[1]}" missing data-width/data-height. May render with zero dimensions.`,
              file,
              fixHint:
                'Add data-width="1920" data-height="1080" style="position:relative;width:1920px;height:1080px"',
            });
          }
        }

        // Check for repeat: -1
        if (/repeat\s*:\s*-\s*1/.test(html)) {
          findings.push({
            severity: "error",
            message: "GSAP `repeat: -1` found — infinite loop breaks timeline duration.",
            file,
            fixHint: "Use a finite repeat count or CSS animation.",
          });
        }

        // Check script syntax
        const scriptRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
        let scriptMatch;
        while ((scriptMatch = scriptRe.exec(html)) !== null) {
          const js = scriptMatch[1]?.trim();
          if (!js) continue;
          try {
            new Function(js);
          } catch (e) {
            findings.push({
              severity: "error",
              message: `Script syntax error: ${e instanceof Error ? e.message : String(e)}`,
              file,
            });
          }
        }
      }

      setLintModal(findings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, []);

  const handleRender = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid || renderState === "rendering") return;
    setRenderState("rendering");
    setRenderProgress(0);
    setRenderError(null);
    try {
      // Start render via studio backend
      const res = await fetch(`/api/projects/${pid}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Render failed: ${res.status}`);
      const { jobId } = await res.json();

      // Subscribe to progress via SSE
      const eventSource = new EventSource(`/api/render/${jobId}/progress`);
      eventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          setRenderProgress(data.progress ?? 0);
          if (data.status === "complete") {
            setRenderState("complete");
            eventSource.close();
            // Auto-download
            window.open(`/api/render/${jobId}/download`, "_blank");
          } else if (data.status === "failed") {
            setRenderState("error");
            setRenderError(data.error || "Render failed");
            eventSource.close();
          }
        } catch {
          /* ignore */
        }
      });
      eventSource.onerror = () => {
        setRenderState("error");
        setRenderError("Lost connection to render server");
        eventSource.close();
      };
    } catch (err) {
      setRenderState("error");
      setRenderError(err instanceof Error ? err.message : "Render failed");
    }
  }, [renderState]);

  if (resolving) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-sm text-neutral-500">Loading...</div>
      </div>
    );
  }

  if (!projectId) {
    return <ProjectPicker onSelect={handleSelectProject} />;
  }

  const compositions = fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/"));
  const assets = fileTree.filter(
    (f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json"),
  );

  return (
    <div className="flex h-screen w-screen bg-neutral-950">
      {/* Left sidebar: Compositions + Assets */}
      <LeftSidebar
        projectId={projectId}
        compositions={compositions}
        assets={assets}
        activeComposition={editingFile?.path ?? null}
        onSelectComposition={(comp) => {
          // Open code editor for this composition
          const controller = new AbortController();
          setEditingFile({ path: comp, content: null });
          fetch(`/api/projects/${projectId}/files/${comp}`, { signal: controller.signal })
            .then((r) => r.json())
            .then((data) => {
              // Only update if the path still matches (race condition guard)
              setEditingFile((prev) =>
                prev?.path === comp ? { path: comp, content: data.content } : prev,
              );
            })
            .catch((err) => {
              if (err.name !== "AbortError") console.warn("Failed to load composition:", err);
            });
        }}
      />

      {/* NLE: Preview + Timeline */}
      <div className="flex-1 relative min-w-0">
        <NLELayout
          projectId={projectId}
          refreshKey={refreshKey}
          renderClipContent={renderClipContent}
          onCompIdToSrcChange={setCompIdToSrc}
          activeCompositionPath={
            editingFile?.path?.startsWith("compositions/") ? editingFile.path : null
          }
          onIframeRef={(iframe) => {
            previewIframeRef.current = iframe;
          }}
        />
      </div>

      {/* Action buttons — positioned based on sidebar state */}
      {!sidebarOpen && (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-1.5">
          <button
            onClick={() => setSidebarOpen(true)}
            className="h-8 px-3 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-neutral-200 transition-colors flex items-center justify-center"
            title="Source editor"
          >
            <CodeIcon size={16} />
          </button>
          <button
            onClick={handleLint}
            disabled={linting}
            className="h-8 px-3 rounded-lg bg-neutral-900 border border-neutral-800 text-xs font-medium text-neutral-400 hover:text-amber-300 hover:border-amber-800/50 transition-colors disabled:opacity-40"
          >
            {linting ? "Linting..." : "Lint"}
          </button>
          <button
            onClick={handleRender}
            disabled={renderState === "rendering"}
            className="h-8 px-3 rounded-lg text-xs font-semibold text-[#09090B] bg-gradient-to-br from-[#3CE6AC] to-[#2BBFA0] hover:brightness-110 active:scale-[0.97] transition-colors disabled:opacity-60 tabular-nums"
          >
            {renderState === "rendering"
              ? `${Math.round(renderProgress)}%`
              : renderState === "complete"
                ? "Done!"
                : "Export MP4"}
          </button>
        </div>
      )}

      {/* Source editor sidebar */}
      {sidebarOpen && (
        <div className="w-[420px] flex flex-col border-l border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 gap-2">
            <span className="text-xs font-medium text-neutral-500 truncate min-w-0 flex-1">
              {editingFile?.path ?? "Source"}
            </span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={handleLint}
                disabled={linting}
                className="px-2 py-1 rounded text-[11px] font-medium text-neutral-500 hover:text-amber-300 transition-colors disabled:opacity-40"
              >
                {linting ? "..." : "Lint"}
              </button>
              <button
                onClick={handleRender}
                disabled={renderState === "rendering"}
                className="px-2 py-1 rounded text-[11px] font-semibold text-[#3CE6AC] hover:text-[#5EEFC0] transition-colors disabled:opacity-60 tabular-nums"
              >
                {renderState === "rendering" ? `${Math.round(renderProgress)}%` : "Export MP4"}
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-neutral-600 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                title="Close source panel"
              >
                <XIcon size={14} />
              </button>
            </div>
          </div>

          {fileTree.length > 0 && (
            <div className="border-b border-neutral-800 max-h-40 overflow-y-auto">
              <FileTree
                files={fileTree}
                activeFile={editingFile?.path ?? null}
                onSelectFile={handleFileSelect}
              />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {editingFile ? (
              <SourceEditor
                content={editingFile.content ?? ""}
                filePath={editingFile.path}
                onChange={handleContentChange}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lint modal */}
      {lintModal !== null && <LintModal findings={lintModal} onClose={() => setLintModal(null)} />}
    </div>
  );
}
