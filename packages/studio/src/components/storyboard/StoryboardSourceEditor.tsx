import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { SourceEditor } from "../editor/SourceEditor";
import { useFileManagerContext } from "../../contexts/FileManagerContext";

export interface SourceFile {
  path: string;
  label: string;
}

export interface StoryboardSourceEditorProps {
  files: SourceFile[];
  /** Called after a successful save so the Board can re-parse the updated file. */
  onSaved: () => void;
  /** Surfaces unsaved-edit state so the parent can guard the Board↔Source toggle. */
  onDirtyChange?: (dirty: boolean) => void;
}

const DISCARD_PROMPT = "Discard unsaved markdown changes?";

interface EditableFile {
  content: string;
  setContent: (next: string) => void;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: () => void;
}

/** Load a project file's raw text and track edits + save state via the shared file manager. */
function useEditableFile(path: string, onSaved: () => void): EditableFile {
  const { readProjectFile, writeProjectFile } = useFileManagerContext();
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readProjectFile(path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setSaved(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed to load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, readProjectFile]);

  const save = useCallback(() => {
    if (saving) return; // coalesce a fast double Cmd+S into one PUT
    setSaving(true);
    setError(null);
    writeProjectFile(path, content)
      .then(() => {
        setSaved(content);
        onSaved();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "failed to save"))
      .finally(() => setSaving(false));
  }, [writeProjectFile, path, content, onSaved, saving]);

  return { content, setContent, dirty: content !== saved, loading, saving, error, save };
}

/** Preview links open in a new tab with the `window.opener` back-channel severed. */
function hardenLinks(node: Element): void {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
}

/** Render markdown to sanitized HTML, debounced so we don't re-parse on every keystroke. */
function useMarkdownPreview(source: string): string {
  const [debounced, setDebounced] = useState(source);
  const primed = useRef(false);
  useEffect(() => {
    // Paint the first non-empty content immediately (no 200ms blank window after a file
    // loads), exactly once, then debounce all subsequent keystrokes.
    if (!primed.current && source !== "") {
      primed.current = true;
      setDebounced(source);
      return;
    }
    const id = window.setTimeout(() => setDebounced(source), 200);
    return () => window.clearTimeout(id);
  }, [source]);
  return useMemo(() => {
    // `{ async: false }` pins the synchronous string return (no Promise union to narrow).
    const html = marked.parse(debounced, { async: false });
    // Scope the link-hardening hook to this call; `finally` guarantees removal even if
    // `sanitize` throws, so the hook can never leak into other DOMPurify consumers.
    DOMPurify.addHook("afterSanitizeAttributes", hardenLinks);
    try {
      return DOMPurify.sanitize(html);
    } finally {
      DOMPurify.removeHook("afterSanitizeAttributes");
    }
  }, [debounced]);
}

function isSaveShortcut(event: React.KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
}

// Minimal prose styling for the rendered preview (Tailwind doesn't style raw HTML).
const PREVIEW_PROSE =
  "text-sm leading-relaxed text-neutral-300 " +
  "[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-neutral-100 " +
  "[&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-neutral-100 " +
  "[&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-neutral-200 " +
  "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1 [&_code]:text-[0.85em] [&_code]:text-neutral-200 " +
  "[&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-3 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_hr]:my-4 [&_hr]:border-neutral-800 [&_a]:text-sky-400 [&_strong]:text-neutral-100 " +
  "[&_img]:my-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded " +
  "[&_table]:my-3 [&_th]:border [&_th]:border-neutral-800 [&_th]:px-2 [&_th]:py-1 " +
  "[&_td]:border [&_td]:border-neutral-800 [&_td]:px-2 [&_td]:py-1";

/**
 * Raw markdown editor + live preview for the storyboard's canonical files
 * (STORYBOARD.md / SCRIPT.md). Markdown stays the source of truth: saving writes
 * the file and re-parses the Board. Deliberately raw (not WYSIWYG) so the
 * structured frame fields can't be mangled; the preview is sanitized before render.
 */
// fallow-ignore-next-line complexity
export function StoryboardSourceEditor({
  files,
  onSaved,
  onDirtyChange,
}: StoryboardSourceEditorProps) {
  const [selected, setSelected] = useState(files[0]?.path ?? "");
  // Reconcile against the current file list so a removed/renamed file can't strand the tab.
  const activePath = files.some((f) => f.path === selected) ? selected : (files[0]?.path ?? "");
  const file = useEditableFile(activePath, onSaved);
  const previewHtml = useMarkdownPreview(file.content);

  // Surface dirty state to the parent (guards the Board↔Source toggle) and warn
  // on browser-level navigation while there are unsaved edits.
  useEffect(() => onDirtyChange?.(file.dirty), [onDirtyChange, file.dirty]);
  useEffect(() => {
    if (!file.dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [file.dirty]);

  // Switching files discards the in-memory buffer; confirm when there are unsaved edits.
  const selectFile = (path: string) => {
    if (path === activePath) return;
    if (file.dirty && !window.confirm(DISCARD_PROMPT)) return;
    setSelected(path);
  };

  return (
    <div
      className="flex flex-1 min-h-0 flex-col"
      onKeyDown={(e) => {
        if (!isSaveShortcut(e)) return;
        e.preventDefault();
        if (file.dirty && !file.saving) file.save();
      }}
    >
      <div className="flex items-center gap-1 border-b border-neutral-800 px-4 py-2">
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => selectFile(f.path)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              activePath === f.path
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {file.error && <span className="text-xs text-red-400">{file.error}</span>}
          <span className="text-xs text-neutral-500">
            {file.saving ? "Saving…" : file.dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button
            type="button"
            onClick={file.save}
            disabled={!file.dirty || file.saving}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 min-w-0 border-r border-neutral-800">
          {file.loading ? (
            <div className="p-4 text-sm text-neutral-500">Loading {activePath}…</div>
          ) : (
            <SourceEditor
              content={file.content}
              language="markdown"
              filePath={activePath}
              onChange={file.setContent}
            />
          )}
        </div>
        <div className="w-1/2 min-w-0 overflow-auto bg-neutral-950 px-6 py-4">
          <div className={PREVIEW_PROSE} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
    </div>
  );
}
