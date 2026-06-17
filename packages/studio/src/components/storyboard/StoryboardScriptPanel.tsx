import type { StoryboardScript } from "../../hooks/useStoryboard";

export interface StoryboardScriptPanelProps {
  script: StoryboardScript;
}

/**
 * Collapsible view of the companion narration script (SCRIPT.md). The mature
 * pipeline keeps the full voiceover script — voice settings, per-line delivery
 * and timing — in this file; here it's surfaced read-only alongside the frames.
 * (Per-frame VO iteration will live in the frame focus view.)
 */
export function StoryboardScriptPanel({ script }: StoryboardScriptPanelProps) {
  if (!script.exists) return null;
  return (
    <details className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/50">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-neutral-300">
        Narration script
        <span className="ml-2 font-normal text-neutral-500">{script.path}</span>
      </summary>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-neutral-800 px-4 py-3 text-xs leading-relaxed text-neutral-400">
        {script.content}
      </pre>
    </details>
  );
}
