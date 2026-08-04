import { useState } from "react";
import { AgentGlyph, type AgentJob } from "./agentGlyphs";

const STATUS_DOT: Record<AgentJob["status"], string> = {
  queued: "bg-neutral-500",
  running: "animate-pulse bg-studio-accent",
  done: "bg-studio-accent",
  failed: "bg-red-400",
  cancelled: "bg-neutral-600",
};

const ROW_BUTTON_CLASS =
  "rounded-md p-0.5 text-neutral-600 transition-colors duration-150 ease-out " +
  "hover:bg-neutral-800/70 hover:text-neutral-200 active:scale-[0.96] disabled:opacity-25 " +
  "disabled:hover:bg-transparent disabled:hover:text-neutral-600";

function RowIcon({ paths }: { paths: string[] }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function elapsedLabel(job: AgentJob): string {
  const end = job.endedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - job.startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Live line for a run: the queue position, what the agent is doing, or how it ended. */
function statusLine(job: AgentJob): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "cancelled") return job.message ?? "Cancelled";
  if (job.status === "running") return job.activity || "Working…";
  return job.message ?? (job.status === "failed" ? "Failed" : "Done");
}

/**
 * Every run for this project, live. The list lives on the server, so a reload
 * lands back on the same in-flight work instead of losing it, and firing a
 * second instruction while the first is still going is the normal path rather
 * than a mistake.
 */
export function AgentRunTray({
  jobs,
  agentIconUrl = null,
  onClearFinished,
  onMoveJob,
  onCancelJob,
}: {
  jobs: AgentJob[];
  /** A real logo for the active harness, supplied via HYPERFRAMES_AGENT_ICON. */
  agentIconUrl?: string | null;
  onClearFinished: () => void;
  /** Reorder a waiting run; `position` indexes the queue, 0 is next up. */
  onMoveJob?: (jobId: string, position: number) => void;
  /** Drop a queued run, or stop a running one. */
  onCancelJob?: (jobId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) return null;

  const active = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const finished = jobs.length - active;
  // The list reads newest-first; the queue runs oldest-first. Map between the
  // two here so "move up" means "runs sooner" no matter how the rows are shown.
  const queueOrder = jobs
    .filter((job) => job.status === "queued")
    .map((job) => job.id)
    .reverse();

  return (
    <div
      data-agent-run-tray="true"
      className="hf-composer-enter absolute bottom-3 left-3 z-20 w-[300px] rounded-2xl bg-neutral-950/95 p-1.5 ring-1 ring-white/10 backdrop-blur-md shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-1.5 py-1">
        <button
          className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-neutral-400 transition-colors duration-150 ease-out hover:text-neutral-200"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-150 ease-out ${collapsed ? "" : "rotate-90"}`}
            aria-hidden="true"
          >
            <path d="M6 3.5 L10.5 8 L6 12.5" />
          </svg>
          {active > 0 ? `${active} running` : `${jobs.length} run${jobs.length > 1 ? "s" : ""}`}
        </button>
        {finished > 0 && (
          <button
            className="rounded-md px-1.5 py-0.5 text-[11px] leading-none text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 active:scale-[0.96]"
            onClick={onClearFinished}
          >
            Clear
          </button>
        )}
      </div>

      {!collapsed && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {jobs.map((job) => {
            const queueIndex = queueOrder.indexOf(job.id);
            const canReorder = queueIndex !== -1 && queueOrder.length > 1;
            return (
              <li
                key={job.id}
                className="group rounded-[10px] px-1.5 py-1.5 transition-colors duration-150 ease-out hover:bg-neutral-900/70"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[job.status]}`}
                  />
                  <AgentGlyph kind={job.kind} size={11} iconUrl={agentIconUrl} />
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-none text-neutral-200">
                    {job.instruction}
                  </span>
                  <span className="shrink-0 text-[10px] leading-none text-neutral-600 tabular-nums group-hover:hidden">
                    {elapsedLabel(job)}
                  </span>
                  {(job.status === "queued" || job.status === "running") && (
                    <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      {canReorder && onMoveJob && (
                        <>
                          <button
                            className={ROW_BUTTON_CLASS}
                            disabled={queueIndex === 0}
                            onClick={() => onMoveJob(job.id, queueIndex - 1)}
                            aria-label="Run sooner"
                            title="Run sooner"
                          >
                            <RowIcon paths={["M8 12.5 V3.5", "M4.5 7 L8 3.5 L11.5 7"]} />
                          </button>
                          <button
                            className={ROW_BUTTON_CLASS}
                            disabled={queueIndex === queueOrder.length - 1}
                            onClick={() => onMoveJob(job.id, queueIndex + 1)}
                            aria-label="Run later"
                            title="Run later"
                          >
                            <RowIcon paths={["M8 3.5 V12.5", "M4.5 9 L8 12.5 L11.5 9"]} />
                          </button>
                        </>
                      )}
                      {onCancelJob && (
                        <button
                          className={`${ROW_BUTTON_CLASS} hover:text-red-400`}
                          onClick={() => onCancelJob(job.id)}
                          aria-label={
                            job.status === "running" ? "Stop this run" : "Remove from queue"
                          }
                          title={job.status === "running" ? "Stop this run" : "Remove from queue"}
                        >
                          <RowIcon paths={["M4 4 L12 12", "M12 4 L4 12"]} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-[18px]">
                  <span className="shrink-0 text-[10px] leading-none text-neutral-600">
                    {job.target}
                  </span>
                  <span
                    className={`min-w-0 truncate text-[10px] leading-none ${
                      job.status === "failed" ? "text-red-400/90" : "text-neutral-500"
                    }`}
                  >
                    {statusLine(job)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
