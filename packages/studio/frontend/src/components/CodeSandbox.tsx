import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Monitor, Smartphone } from "lucide-react";
import Editor from "@monaco-editor/react";
import {
  listProjectFiles,
  getFileContent,
  saveFileContent,
  type ProjectFile,
} from "../api/files";
import {
  COLLAB_CURSOR_ENABLED,
  getProjectPresence,
  heartbeatProjectPresence,
  type PresenceSession,
} from "../api/projects";
import { usePlayerStore } from "../store/playerStore";
import { useTimelinePlayer } from "../hooks/useTimelinePlayer";
import { Player } from "./Player";
import { PlayerControls } from "./PlayerControls";
import { Timeline } from "./Timeline";
import { FileTree } from "./FileTree";
import { FileTabs } from "./FileTabs";

const SESSION_STORAGE_KEY = "hf.browserSessionId";
const PRESENCE_POLL_MS = 4000;

type CursorPosition = {
  lineNumber: number;
  column: number;
};

type EditorLike = {
  getPosition: () => CursorPosition | null;
  onDidChangeCursorPosition: (
    listener: (event: { position: CursorPosition }) => void
  ) => { dispose: () => void };
  deltaDecorations: (
    oldDecorations: string[],
    newDecorations: unknown[]
  ) => string[];
  getModel: () => {
    getLineCount: () => number;
    getLineMaxColumn: (lineNumber: number) => number;
  } | null;
};

type MonacoLike = {
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number
  ) => unknown;
  editor: {
    TrackedRangeStickiness: {
      NeverGrowsWhenTypingAtEdges: number;
    };
  };
};

function getOrCreateBrowserSessionId(): string {
  if (typeof window === "undefined") return "server-session";
  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const id =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

interface CodeSandboxProps {
  projectId: string;
  projectName: string;
  initialPortrait?: boolean;
  onExit: () => void;
}

export function CodeSandbox({
  projectId,
  projectName,
  initialPortrait = true,
  onExit,
}: CodeSandboxProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Map<string, string>>(
    new Map()
  );
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
  const [fileLanguages, setFileLanguages] = useState<Map<string, string>>(
    new Map()
  );
  const [portrait, setPortrait] = useState(initialPortrait);
  const [showCompiled, setShowCompiled] = useState(false);
  const [compiledContents, setCompiledContents] = useState<Map<string, string>>(
    new Map()
  );

  const { isPlaying, currentTime, duration, timelineReady } = usePlayerStore();
  const { iframeRef, togglePlay, seek, onIframeLoad } = useTimelinePlayer();

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef<Set<string>>(dirtyFiles);
  const contentsRef = useRef<Map<string, string>>(fileContents);
  const restoreTimeRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>(getOrCreateBrowserSessionId());
  const remoteCursorRef = useRef<{
    filePath?: string;
    line?: number;
    column?: number;
  } | null>(null);
  const activeFileRef = useRef<string | null>(activeFile);
  const editorRef = useRef<EditorLike | null>(null);
  const monacoRef = useRef<MonacoLike | null>(null);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const [remotePresence, setRemotePresence] = useState<PresenceSession[]>([]);

  // Keep refs in sync
  dirtyRef.current = dirtyFiles;
  contentsRef.current = fileContents;
  activeFileRef.current = activeFile;

  // Load file list on mount
  useEffect(() => {
    listProjectFiles(projectId).then((projectFiles) => {
      setFiles(projectFiles);
      const langs = new Map<string, string>();
      for (const f of projectFiles) langs.set(f.filename, f.language);
      setFileLanguages(langs);

      // Auto-open index.html
      const indexFile = projectFiles.find((f) => f.filename === "index.html");
      if (indexFile) {
        setOpenFiles(["index.html"]);
        setActiveFile("index.html");
        loadFileContent("index.html");
      } else if (projectFiles.length > 0) {
        const first = projectFiles[0]?.filename;
        if (!first) return;
        setOpenFiles([first]);
        setActiveFile(first);
        loadFileContent(first);
      }
    });
  }, [projectId]);

  // After a reload, restore playback position once the timeline is ready again
  useEffect(() => {
    if (timelineReady && restoreTimeRef.current !== null) {
      const t = restoreTimeRef.current;
      restoreTimeRef.current = null;
      // Small delay to ensure the player is fully initialized
      setTimeout(() => seek(t), 50);
    }
  }, [timelineReady, seek]);

  async function loadFileContent(filename: string) {
    if (contentsRef.current.has(filename)) return;
    const data = await getFileContent(projectId, filename);
    setFileContents((prev) => new Map(prev).set(filename, data.content));
  }

  async function loadCompiledContent(filename: string) {
    const data = await getFileContent(projectId, filename, true);
    setCompiledContents((prev) => new Map(prev).set(filename, data.content));
  }

  useEffect(() => {
    if (
      showCompiled &&
      activeFile?.endsWith(".html") &&
      !compiledContents.has(activeFile)
    ) {
      loadCompiledContent(activeFile);
    }
  }, [showCompiled, activeFile, compiledContents]);

  function handleFileClick(filename: string) {
    if (!openFiles.includes(filename)) {
      setOpenFiles((prev) => [...prev, filename]);
    }
    setActiveFile(filename);
    loadFileContent(filename);
  }

  function handleTabClose(filename: string) {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f !== filename);
      if (activeFile === filename) {
        setActiveFile(next.length > 0 ? next[next.length - 1] ?? null : null);
      }
      return next;
    });
  }

  async function handleNewFile(filename: string) {
    if (files.some((f) => f.filename === filename)) return;
    await saveFileContent(projectId, filename, "");
    const ext = filename.includes(".")
      ? filename.slice(filename.lastIndexOf("."))
      : "";
    const langMap: Record<string, string> = {
      ".html": "html",
      ".css": "css",
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".json": "json",
      ".svg": "xml",
      ".txt": "plaintext",
    };
    const lang = langMap[ext] || "plaintext";
    const newFile: ProjectFile = { filename, language: lang, size: 0 };
    setFiles((prev) => [...prev, newFile]);
    setFileLanguages((prev) => new Map(prev).set(filename, lang));
    setFileContents((prev) => new Map(prev).set(filename, ""));
    setOpenFiles((prev) => [...prev, filename]);
    setActiveFile(filename);
  }

  const flushDirtyFiles = useCallback(async () => {
    const dirty = new Set(dirtyRef.current);
    if (dirty.size === 0) return;

    const contents = contentsRef.current;
    const saves = Array.from(dirty).map((f) =>
      saveFileContent(projectId, f, contents.get(f) ?? "")
    );
    await Promise.all(saves);

    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const f of dirty) next.delete(f);
      return next;
    });

    // Invalidate compiled cache for saved HTML files
    setCompiledContents((prev) => {
      const next = new Map(prev);
      for (const f of dirty) {
        if (f.endsWith(".html")) next.delete(f);
      }
      return next;
    });

    // Reload preview, preserving playback position
    const iframe = iframeRef.current;
    if (iframe) {
      restoreTimeRef.current = usePlayerStore.getState().currentTime;
      // Reset timelineReady so the restore effect fires on next ready
      usePlayerStore.getState().setTimelineReady(false);
      iframe.src = iframe.src;
    }
  }, [projectId, iframeRef]);

  function handleEditorChange(value: string | undefined) {
    if (!activeFile || value === undefined) return;

    setFileContents((prev) => new Map(prev).set(activeFile, value));
    setDirtyFiles((prev) => new Set(prev).add(activeFile));

    // Debounced save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushDirtyFiles, 800);
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!COLLAB_CURSOR_ENABLED) return;
    if (!activeFile) {
      remoteCursorRef.current = null;
      return;
    }

    const position = editorRef.current?.getPosition();
    remoteCursorRef.current = {
      filePath: activeFile,
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
    };
  }, [activeFile]);

  useEffect(() => {
    if (!COLLAB_CURSOR_ENABLED) {
      setRemotePresence([]);
      return;
    }

    let cancelled = false;

    const syncPresence = async () => {
      try {
        const cursor = remoteCursorRef.current;
        await heartbeatProjectPresence(projectId, {
          sessionId: sessionIdRef.current,
          filePath: cursor?.filePath ?? activeFileRef.current ?? undefined,
          line: cursor?.line,
          column: cursor?.column,
        });

        const response = await getProjectPresence(projectId);
        if (cancelled || !response.enabled) return;
        setRemotePresence(
          response.sessions.filter(
            (session) => session.sessionId !== sessionIdRef.current
          )
        );
      } catch {
        if (!cancelled) {
          setRemotePresence([]);
        }
      }
    };

    void syncPresence();
    const intervalId = window.setInterval(() => {
      void syncPresence();
    }, PRESENCE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      setRemotePresence([]);
    };
  }, [projectId]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor) return;

    if (!COLLAB_CURSOR_ENABLED || !activeFile || !monaco) {
      decorationIdsRef.current = editor.deltaDecorations(
        decorationIdsRef.current,
        []
      );
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const decorations = remotePresence
      .filter(
        (session) =>
          session.filePath === activeFile &&
          typeof session.line === "number" &&
          typeof session.column === "number"
      )
      .map((session) => {
        const line = Math.min(
          Math.max(1, Math.floor(session.line ?? 1)),
          model.getLineCount()
        );
        const maxColumn = model.getLineMaxColumn(line);
        const column = Math.min(
          Math.max(1, Math.floor(session.column ?? 1)),
          maxColumn
        );
        const endColumn = Math.min(column + 1, maxColumn);

        return {
          range: new monaco.Range(
            line,
            column,
            line,
            Math.max(column, endColumn)
          ),
          options: {
            className: "hf-remote-cursor-blink",
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            hoverMessage: {
              value: `Session ${session.sessionId.slice(0, 8)}`,
            },
          },
        };
      });

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      decorations
    );
  }, [activeFile, remotePresence]);

  const handleEditorMount = useCallback((editor: unknown, monaco: unknown) => {
    editorRef.current = editor as EditorLike;
    monacoRef.current = monaco as MonacoLike;

    cursorListenerRef.current?.dispose();
    cursorListenerRef.current = editorRef.current.onDidChangeCursorPosition(
      (event) => {
        if (!COLLAB_CURSOR_ENABLED || !activeFileRef.current) return;
        remoteCursorRef.current = {
          filePath: activeFileRef.current,
          line: event.position.lineNumber,
          column: event.position.column,
        };
      }
    );
  }, []);

  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      const editor = editorRef.current;
      if (editor) {
        decorationIdsRef.current = editor.deltaDecorations(
          decorationIdsRef.current,
          []
        );
      }
    };
  }, []);

  const isHtmlFile = activeFile?.endsWith(".html") ?? false;
  const isCompiledView = showCompiled && isHtmlFile;
  const currentContent = activeFile
    ? isCompiledView
      ? compiledContents.get(activeFile)
      : fileContents.get(activeFile)
    : undefined;
  const currentLanguage = activeFile
    ? fileLanguages.get(activeFile) ?? "plaintext"
    : "plaintext";

  return (
    <div className="w-full h-screen flex flex-col bg-white">
      <style>{`
        @keyframes hfCursorBlink {
          0%, 49% { border-left-color: rgba(37, 99, 235, 1); }
          50%, 100% { border-left-color: rgba(37, 99, 235, 0.2); }
        }
        .hf-remote-cursor-blink {
          border-left: 2px solid rgba(37, 99, 235, 1);
          background: rgba(37, 99, 235, 0.16);
          animation: hfCursorBlink 1s step-end infinite;
        }
      `}</style>
      {/* Minimal header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-neutral-200">
        <button
          onClick={onExit}
          className="text-neutral-400 hover:text-neutral-700 transition-colors p-1 rounded hover:bg-neutral-100"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-neutral-800 text-sm font-medium truncate">
          {projectName}
        </span>
        <button
          onClick={onExit}
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-800 px-3 py-1 rounded border border-neutral-300 hover:border-neutral-400 transition-colors"
        >
          Exit Edit
        </button>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 min-h-0 flex">
        {/* File tree */}
        <FileTree
          files={files}
          activeFile={activeFile}
          onFileClick={handleFileClick}
          onNewFile={handleNewFile}
        />

        {/* Editor area */}
        <div className="flex-1 min-w-0 flex flex-col">
          <FileTabs
            openFiles={openFiles}
            activeFile={activeFile}
            dirtyFiles={dirtyFiles}
            onTabClick={(f) => {
              setActiveFile(f);
              loadFileContent(f);
            }}
            onTabClose={handleTabClose}
          />
          {/* Source/Compiled toggle hidden for now
          {isHtmlFile && (
            <div className="flex items-center px-3 py-1 bg-neutral-50 border-b border-neutral-200">
              <div className="flex items-center bg-neutral-100 rounded-lg p-0.5">
                <button
                  onClick={() => setShowCompiled(false)}
                  className={`px-2.5 py-0.5 text-xs rounded-md transition-colors ${
                    !showCompiled
                      ? "bg-white text-neutral-800 shadow-sm"
                      : "text-neutral-400 hover:text-neutral-600"
                  }`}
                >
                  Source
                </button>
                <button
                  onClick={() => setShowCompiled(true)}
                  className={`px-2.5 py-0.5 text-xs rounded-md transition-colors ${
                    showCompiled
                      ? "bg-white text-neutral-800 shadow-sm"
                      : "text-neutral-400 hover:text-neutral-600"
                  }`}
                >
                  Compiled
                </button>
              </div>
              {isCompiledView && (
                <span className="ml-2 text-[10px] text-neutral-400 uppercase tracking-wider">
                  Read-only
                </span>
              )}
            </div>
          )}
          */}
          <div className="flex-1 min-h-0">
            {activeFile && currentContent !== undefined ? (
              <Editor
                theme="light"
                language={currentLanguage}
                value={currentContent}
                onChange={isCompiledView ? undefined : handleEditorChange}
                onMount={handleEditorMount}
                path={isCompiledView ? `compiled:${activeFile}` : activeFile}
                options={{
                  minimap: { enabled: false },
                  wordWrap: "on",
                  fontSize: 13,
                  tabSize: 2,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  readOnly: isCompiledView,
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                {activeFile ? "Loading..." : "Select a file to edit"}
              </div>
            )}
          </div>
        </div>

        {/* Preview pane with player + controls + timeline */}
        <div className="w-[45%] flex-shrink-0 border-l border-neutral-200 flex flex-col">
          <div className="flex items-center px-3 py-1 bg-neutral-50 border-b border-neutral-200">
            <span className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">
              Preview
            </span>
            <div className="ml-auto flex items-center bg-neutral-100 rounded-lg p-0.5">
              <button
                onClick={() => setPortrait(false)}
                className={`p-1 rounded-md transition-colors ${
                  !portrait
                    ? "bg-white text-neutral-800 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-600"
                }`}
                title="Landscape (16:9)"
              >
                <Monitor className="w-3 h-3" />
              </button>
              <button
                onClick={() => setPortrait(true)}
                className={`p-1 rounded-md transition-colors ${
                  portrait
                    ? "bg-white text-neutral-800 shadow-sm"
                    : "text-neutral-400 hover:text-neutral-600"
                }`}
                title="Portrait (9:16)"
              >
                <Smartphone className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3 bg-neutral-100">
            <Player
              ref={iframeRef}
              projectId={projectId}
              onLoad={onIframeLoad}
              portrait={portrait}
            />
          </div>
          <div className="flex-shrink-0 bg-white">
            <PlayerControls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              timelineReady={timelineReady}
              onTogglePlay={togglePlay}
              onSeek={seek}
            />
            <Timeline />
          </div>
        </div>
      </div>
    </div>
  );
}
