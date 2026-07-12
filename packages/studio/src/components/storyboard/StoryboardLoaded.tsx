import { useMemo, useState } from "react";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { StoryboardDirection } from "./StoryboardDirection";
import { StoryboardGrid } from "./StoryboardGrid";
import { StoryboardStatusLegend } from "./StoryboardStatusLegend";
import { StoryboardScriptPanel } from "./StoryboardScriptPanel";
import { StoryboardSourceEditor, type SourceFile } from "./StoryboardSourceEditor";
import { StoryboardFrameFocus } from "./StoryboardFrameFocus";

type SubView = "board" | "source";

export interface StoryboardLoadedProps {
  projectId: string;
  data: StoryboardResponse;
  /** Re-fetch the manifest after a source edit is saved. */
  reload: () => void;
  /** Select a composition in the timeline (used by "Open in Preview"). */
  onSelectComposition: (path: string) => void;
}

function clampIndex(index: number, count: number): number {
  return Math.max(1, Math.min(count, index));
}

/** A storyboard that exists on disk: Board (contact sheet) ↔ Source ↔ frame focus. */
// fallow-ignore-next-line complexity
export function StoryboardLoaded({
  projectId,
  data,
  reload,
  onSelectComposition,
}: StoryboardLoadedProps) {
  const [subView, setSubView] = useState<SubView>("board");
  const [sourceDirty, setSourceDirty] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const sourceFiles = useMemo<SourceFile[]>(() => {
    const files: SourceFile[] = [{ path: data.path, label: data.path }];
    if (data.script?.exists) files.push({ path: data.script.path, label: data.script.path });
    return files;
    // Depend on the stable fields, not the `data.script` object — every reload()
    // produces a fresh object and would needlessly re-create this array.
  }, [data.path, data.script?.path, data.script?.exists]);

  // Leaving the source editor drops its in-memory buffer; confirm when it's dirty.
  // fallow-ignore-next-line complexity
  const changeSubView = (next: SubView) => {
    if (next === subView) return;
    if (
      subView === "source" &&
      sourceDirty &&
      !window.confirm("Discard unsaved markdown changes?")
    ) {
      return;
    }
    setSubView(next);
  };

  const focusedFrame =
    focusedIndex != null ? (data.frames.find((f) => f.index === focusedIndex) ?? null) : null;

  if (focusedFrame) {
    return (
      <StoryboardFrameFocus
        key={focusedFrame.index}
        projectId={projectId}
        storyboardPath={data.path}
        frame={focusedFrame}
        frameCount={data.frames.length}
        onBack={() => setFocusedIndex(null)}
        onNavigate={(delta) =>
          setFocusedIndex(clampIndex(focusedFrame.index + delta, data.frames.length))
        }
        onSaved={reload}
        onSelectComposition={onSelectComposition}
      />
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-neutral-950 text-neutral-200">
      <div className="flex items-center border-b border-neutral-800 px-4 py-2">
        <SubViewToggle value={subView} onChange={changeSubView} />
      </div>
      {subView === "board" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="mx-auto max-w-[1400px] px-8 py-8">
            <StoryboardDirection globals={data.globals} frameCount={data.frames.length} />
            <div className="mt-5">
              <StoryboardStatusLegend />
            </div>
            <StoryboardGrid
              projectId={projectId}
              frames={data.frames}
              onOpenFrame={setFocusedIndex}
            />
            {data.script && <StoryboardScriptPanel script={data.script} />}
          </div>
        </div>
      ) : (
        <StoryboardSourceEditor
          files={sourceFiles}
          onSaved={reload}
          onDirtyChange={setSourceDirty}
        />
      )}
    </div>
  );
}

const SUB_VIEWS: Array<{ value: SubView; label: string }> = [
  { value: "board", label: "Board" },
  { value: "source", label: "Source" },
];

function SubViewToggle({ value, onChange }: { value: SubView; onChange: (next: SubView) => void }) {
  // Complete tabs contract: roving tabIndex + arrow-key navigation (the roles
  // alone promised keyboard behavior the buttons didn't have).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const currentIndex = SUB_VIEWS.findIndex((v) => v.value === value);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = SUB_VIEWS[(currentIndex + delta + SUB_VIEWS.length) % SUB_VIEWS.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-md bg-neutral-900 p-0.5"
      role="tablist"
      aria-label="Storyboard view"
      onKeyDown={handleKeyDown}
    >
      {SUB_VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors active:scale-[0.98] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-studio-accent ${
            value === option.value
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
