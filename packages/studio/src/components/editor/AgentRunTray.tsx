import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentGlyph, type AgentJob, type AgentKind } from "./agentGlyphs";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";

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

/** Live line for a run: where it sits in line, what it is doing, or how it ended. */
function statusLine(job: AgentJob, queuePosition: number): string {
  if (job.status === "queued")
    return queuePosition === 0 ? "Next up" : `#${queuePosition + 1} in line`;
  if (job.status === "cancelled") return job.message ?? "Cancelled";
  if (job.status === "running") return job.activity || "Working…";
  return job.message ?? (job.status === "failed" ? "Failed" : "Done");
}

const TRAY_WIDTH = 300;
const TRAY_MARGIN = 16;

/** Where the tray sits: last parked spot, else the bottom-right corner. */
export function resolveTrayPosition(
  stored: { x: number; y: number } | undefined,
  viewport: { width: number; height: number },
  trayHeight = 120,
): { x: number; y: number } {
  const maxX = Math.max(TRAY_MARGIN, viewport.width - TRAY_WIDTH - TRAY_MARGIN);
  const maxY = Math.max(TRAY_MARGIN, viewport.height - trayHeight - TRAY_MARGIN);
  if (!stored) return { x: maxX, y: maxY };
  return {
    x: Math.min(maxX, Math.max(TRAY_MARGIN, stored.x)),
    y: Math.min(maxY, Math.max(TRAY_MARGIN, stored.y)),
  };
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
  onRevealTarget,
}: {
  jobs: AgentJob[];
  /** A real logo for the active harness, supplied via HYPERFRAMES_AGENT_ICON. */
  agentIconUrl?: string | null;
  onClearFinished: () => void;
  /** Reorder a waiting run; `position` indexes the queue, 0 is next up. */
  onMoveJob?: (jobId: string, position: number) => void;
  /** Drop a queued run, or stop a running one. */
  onCancelJob?: (jobId: string) => void;
  /** Seek to the run's moment and re-select the element it edited. */
  onRevealTarget?: (job: AgentJob) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => readStudioUiPreferences().agentTrayCollapsed ?? false,
  );
  // Parked over the app shell, not the canvas: the composition is the work, and
  // a panel sitting on top of it hides whatever is in that corner.
  const [position, setPosition] = useState(() =>
    resolveTrayPosition(readStudioUiPreferences().agentTrayPosition, {
      width: typeof window === "undefined" ? 1280 : window.innerWidth,
      height: typeof window === "undefined" ? 800 : window.innerHeight,
    }),
  );
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  if (jobs.length === 0) return null;

  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX - position.x,
        startY: e.clientY - position.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setPosition(
        resolveTrayPosition(
          { x: e.clientX - drag.startX, y: e.clientY - drag.startY },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      writeStudioUiPreferences({ agentTrayPosition: position });
    },
  };

  const active = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const finished = jobs.length - active;
  // The list reads newest-first; the queue runs oldest-first. Map between the
  // two here so "move up" means "runs sooner" no matter how the rows are shown.
  const queueOrder = jobs
    .filter((job) => job.status === "queued")
    .map((job) => job.id)
    .reverse();
  // One mark per harness that shows up in this list — a stack of avatars reads
  // "who worked on this" faster than any label would.
  const kindsUsed: AgentKind[] = [...new Set(jobs.map((job) => job.kind))];

  return createPortal(
    <div
      data-agent-run-tray="true"
      className="hf-composer-enter fixed z-[60] w-[300px] rounded-2xl bg-neutral-950/95 p-1.5 ring-1 ring-white/10 backdrop-blur-md shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-1.5 py-1 active:cursor-grabbing"
        {...dragHandlers}
      >
        <button
          className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-neutral-400 transition-colors duration-150 ease-out hover:text-neutral-200"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            setCollapsed((value) => {
              writeStudioUiPreferences({ agentTrayCollapsed: !value });
              return !value;
            })
          }
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
        {kindsUsed.length > 1 && (
          <span className="flex flex-1 items-center pl-1" aria-hidden="true">
            {kindsUsed.map((kind, index) => (
              <span
                key={kind}
                className={index > 0 ? "-ml-1" : ""}
                style={{ zIndex: kindsUsed.length - index }}
              >
                <AgentGlyph kind={kind} size={12} iconUrl={agentIconUrl} />
              </span>
            ))}
          </span>
        )}
        {finished > 0 && (
          <button
            className="rounded-md px-1.5 py-0.5 text-[11px] leading-none text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 active:scale-[0.96]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClearFinished}
          >
            Clear
          </button>
        )}
      </div>

      {!collapsed && (
        <ul
          data-preview-overlay-scroll="true"
          className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain"
        >
          {jobs.map((job) => {
            const queueIndex = queueOrder.indexOf(job.id);
            const canReorder = queueIndex !== -1 && queueOrder.length > 1;
            return (
              <li
                key={job.id}
                className="group rounded-[10px] px-1.5 py-1.5 transition-colors duration-150 ease-out hover:bg-neutral-900/70"
              >
                <div className="flex items-center gap-1.5">
                  <AgentGlyph kind={job.kind} size={12} iconUrl={agentIconUrl} />
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
                  {job.targetRef && onRevealTarget ? (
                    <button
                      className="-mx-1 shrink-0 rounded px-1 py-0.5 text-[10px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/70 hover:text-studio-accent active:scale-[0.96]"
                      onClick={() => onRevealTarget(job)}
                      title="Seek here and select the element this run edited"
                    >
                      {job.target}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] leading-none text-neutral-600">
                      {job.target}
                    </span>
                  )}
                  <span
                    className={`min-w-0 truncate text-[10px] leading-none ${
                      job.status === "failed" ? "text-red-400/90" : "text-neutral-500"
                    }`}
                  >
                    {statusLine(job, queueIndex)}
                  </span>
                  {job.sessionId && (
                    <span
                      className="ml-auto shrink-0 font-mono text-[10px] leading-none text-neutral-700"
                      title={`Session ${job.sessionId}`}
                    >
                      {job.sessionId.slice(0, 8)}
                    </span>
                  )}
                </div>
                {(job.status === "running" || job.status === "queued") && (
                  <div
                    aria-hidden="true"
                    className="mt-1.5 h-[2px] overflow-hidden rounded-full bg-neutral-800/80"
                  >
                    {/* Running sweeps; queued sits still — the difference is the
                        point, and the elapsed timer is the static cue beside it. */}
                    <div
                      className={
                        job.status === "running"
                          ? "hf-run-sweep h-full w-1/3 rounded-full bg-studio-accent"
                          : "h-full w-full rounded-full bg-neutral-700/70"
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
