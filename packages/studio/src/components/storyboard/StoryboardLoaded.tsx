import { useMemo, useState } from "react";
import type { StoryboardResponse } from "../../hooks/useStoryboard";
import { StoryboardDirection } from "./StoryboardDirection";
import { StoryboardGrid } from "./StoryboardGrid";
import { StoryboardStatusLegend } from "./StoryboardStatusLegend";
import { StoryboardScriptPanel } from "./StoryboardScriptPanel";
import { StoryboardSourceEditor, type SourceFile } from "./StoryboardSourceEditor";

type SubView = "board" | "source";

export interface StoryboardLoadedProps {
  projectId: string;
  data: StoryboardResponse;
  /** Re-fetch the manifest after a source edit is saved. */
  reload: () => void;
}

/** A storyboard that exists on disk: Board (contact sheet) ↔ Source (markdown editor). */
export function StoryboardLoaded({ projectId, data, reload }: StoryboardLoadedProps) {
  const [subView, setSubView] = useState<SubView>("board");
  const [sourceDirty, setSourceDirty] = useState(false);
  const sourceFiles = useMemo<SourceFile[]>(() => {
    const files: SourceFile[] = [{ path: data.path, label: data.path }];
    if (data.script?.exists) files.push({ path: data.script.path, label: data.script.path });
    return files;
  }, [data.path, data.script]);

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
            <StoryboardGrid projectId={projectId} frames={data.frames} />
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
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-neutral-900 p-0.5" role="tablist">
      {SUB_VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
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
