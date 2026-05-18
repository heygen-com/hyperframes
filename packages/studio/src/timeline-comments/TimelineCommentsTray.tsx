import { formatTime } from "../player";
import type { AgentCommentStatusMap, TimelineComment } from "./types";

const DISPLAY_PROMPT_MAX = 160;

function truncatePrompt(prompt: string): string {
  if (!prompt) return "(no prompt provided)";
  if (prompt.length <= DISPLAY_PROMPT_MAX) return prompt;
  return `${prompt.slice(0, DISPLAY_PROMPT_MAX).trimEnd()}…`;
}

interface TimelineCommentsTrayProps {
  comments: TimelineComment[];
  open: boolean;
  status: AgentCommentStatusMap;
  onToggleOpen: () => void;
  onClose: () => void;
  onRunAgent: (comment: TimelineComment) => void;
  onCopyPrompt: (comment: TimelineComment) => void;
  onClear: (commentId: string) => void;
  onCancelAgentRun: (commentId: string) => void;
}

export function TimelineCommentsTray({
  comments,
  open,
  status,
  onToggleOpen,
  onClose,
  onRunAgent,
  onCopyPrompt,
  onClear,
  onCancelAgentRun,
}: TimelineCommentsTrayProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleOpen}
        className={`h-7 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
          open
            ? "border-amber-300/40 bg-amber-300/10 text-amber-200"
            : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
        }`}
        title="Show timeline comments"
      >
        Comments {comments.length > 0 ? comments.length : ""}
      </button>
      {open && (
        <div
          className="absolute right-3 top-[36px] z-[160] flex w-[420px] max-w-[calc(100vw-32px)] flex-col rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40"
          style={{ maxHeight: "calc(var(--timeline-h, 220px) - 48px)" }}
        >
          <div className="flex-none flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <div className="text-[11px] font-medium text-neutral-300">Timeline Comments</div>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-neutral-500 hover:text-neutral-200"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {comments.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] text-neutral-500">
                No open comments.
              </div>
            ) : (
              comments.map((comment) => {
                const entry = status[comment.id];
                const isRunning = entry?.status === "running";
                return (
                  <div
                    key={comment.id}
                    className="border-b border-neutral-900 px-3 py-2 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-neutral-300">
                          {isRunning && (
                            <span
                              aria-label="Running"
                              className="mr-2 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-300 border-t-transparent align-[-1px]"
                            />
                          )}
                          {formatTime(comment.rangeStart)} - {formatTime(comment.rangeEnd)}
                          <span className="ml-2 text-neutral-600">{comment.filePath}</span>
                        </div>
                        <div
                          className="mt-1 line-clamp-2 text-[11px] text-neutral-500"
                          title={comment.prompt || undefined}
                        >
                          {truncatePrompt(comment.prompt)}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {isRunning ? (
                          <button
                            type="button"
                            onClick={() => onCancelAgentRun(comment.id)}
                            className="inline-flex items-center rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-medium text-red-300 hover:bg-red-400/15"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRunAgent(comment)}
                            className="rounded-md border border-studio-accent/25 bg-studio-accent/10 px-2 py-1 text-[10px] font-medium text-studio-accent hover:bg-studio-accent/20"
                          >
                            Run
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCopyPrompt(comment)}
                          className="rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-200"
                        >
                          Copy
                        </button>
                        {!isRunning && (
                          <button
                            type="button"
                            onClick={() => onClear(comment.id)}
                            className="rounded-md border border-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-200"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {status[comment.id]?.status === "stopped" && (
                      <div className="mt-2 text-[11px] text-neutral-500">
                        {status[comment.id]?.message ?? "Stopped."}
                      </div>
                    )}
                    {status[comment.id]?.status === "error" && (
                      <div className="mt-2 text-[11px] text-red-400">
                        {status[comment.id]?.message ?? "Agent run failed."}
                      </div>
                    )}
                    {isRunning && entry.lastMessage && (
                      <div
                        className="mt-1 truncate font-mono text-[10px] text-neutral-600"
                        title={entry.lastMessage}
                      >
                        {entry.lastMessage}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
