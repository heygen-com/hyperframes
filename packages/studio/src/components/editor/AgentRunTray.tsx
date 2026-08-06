import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentGlyph, type AgentJob, type AgentKind } from "./agentGlyphs";
import { AgentPermissionPrompt } from "./AgentPermissionPrompt";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { FLOATING_SURFACE, GHOST_ICON_BUTTON } from "../ui/floatingSurface";

const ROW_BUTTON_CLASS = GHOST_ICON_BUTTON;

/**
 * A row control with a label that shows on hover.
 *
 * The native `title` tooltip is slow to appear, cannot be themed, and covers
 * the row it is describing. This one sits under the button cluster, appears at
 * once, and takes no pointer events, so it can never get in the way of the next
 * click. The label is also the button's accessible name, so the two can't drift.
 */
function RowButton({
  label,
  onClick,
  disabled,
  danger,
  paths,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  paths: string[];
}) {
  return (
    <span className="group/tip relative flex">
      <button
        className={`${ROW_BUTTON_CLASS}${danger ? " hover:text-red-400" : ""}`}
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
      >
        <RowIcon paths={paths} />
      </button>
      {!disabled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 hidden whitespace-nowrap rounded-md border border-neutral-800 bg-neutral-950 px-1.5 py-1 text-[10px] leading-none text-neutral-300 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.8)] group-hover/tip:block"
        >
          {label}
        </span>
      )}
    </span>
  );
}

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
  if (job.status === "awaiting-permission") return job.activity || "Waiting on you";
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
  onSteerJob,
  onPromoteJob,
  onAnswerJob,
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
  /** Hand a running run to the composer to be corrected. */
  onSteerJob?: (job: AgentJob) => void;
  /** Make a waiting run the one that is happening, stopping what holds it up. */
  onPromoteJob?: (jobId: string) => void;
  /** Answer the question a run stopped to ask, with an option it offered. */
  onAnswerJob?: (jobId: string, optionId: string) => void;
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
  /**
   * The queued run being dragged to a new place in line. The ref is what the
   * drag handlers read: dragover and drop can fire in the same tick as
   * dragstart, and state read there is still the previous render's. The state
   * copy only drives the dragged row's dimming.
   */
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const startDragging = (jobId: string | null) => {
    draggingIdRef.current = jobId;
    setDraggingId(jobId);
  };
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

  // Runs on different elements go at once, so running and waiting are separate
  // counts: "2 running · 1 queued" is the state, "3 running" never was.
  const running = jobs.filter((job) => job.status === "running").length;
  const queued = jobs.filter((job) => job.status === "queued").length;
  // A run stopped on a question is not working and is not in line — it is
  // waiting on the person reading this, which is the most important of the
  // three and so is said first.
  const asking = jobs.filter((job) => job.status === "awaiting-permission").length;
  const active = running + queued + asking;
  const finished = jobs.length - active;
  const headline =
    active === 0
      ? `${jobs.length} run${jobs.length === 1 ? "" : "s"}`
      : [
          asking && `${asking} needs you`,
          running && `${running} running`,
          queued && `${queued} queued`,
        ]
          .filter(Boolean)
          .join(" · ");
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
      className={`hf-composer-enter fixed w-[300px] rounded-2xl p-1.5 ${FLOATING_SURFACE}`}
      // Above the panels and the timeline chrome, below modals and toasts.
      style={{ left: position.x, top: position.y, zIndex: 80 }}
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
          {headline}
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
            const dragging = draggingId === job.id;
            return (
              <li
                key={job.id}
                // Waiting runs are draggable: reordering a queue is a drag
                // everywhere else, and the arrows are only found by hovering.
                draggable={canReorder}
                onDragStart={(event) => {
                  if (!canReorder) return;
                  startDragging(job.id);
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox refuses to start a drag with no payload.
                  event.dataTransfer.setData("text/plain", job.id);
                }}
                onDragEnd={() => startDragging(null)}
                onDragOver={(event) => {
                  const dragged = draggingIdRef.current;
                  if (!canReorder || !dragged || dragged === job.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  const dragged = draggingIdRef.current;
                  if (!canReorder || !dragged || dragged === job.id) return;
                  event.preventDefault();
                  onMoveJob?.(dragged, queueIndex);
                  startDragging(null);
                }}
                className={`group rounded-[10px] px-1.5 py-1.5 transition-colors duration-150 ease-out hover:bg-neutral-900/70${
                  canReorder ? " cursor-grab active:cursor-grabbing" : ""
                }${dragging ? " opacity-50" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  {/* A grip in place of the harness mark while a queued row is
                      hovered: the row says it can be moved before you try. */}
                  {canReorder && (
                    <span
                      aria-hidden="true"
                      className="hidden shrink-0 text-neutral-600 group-hover:block"
                    >
                      <RowIcon paths={["M6 5h.01M10 5h.01M6 8h.01M10 8h.01M6 11h.01M10 11h.01"]} />
                    </span>
                  )}
                  <span className={canReorder ? "group-hover:hidden" : undefined}>
                    <AgentGlyph kind={job.kind} size={12} iconUrl={agentIconUrl} />
                  </span>
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
                          <RowButton
                            label="Run sooner"
                            disabled={queueIndex === 0}
                            onClick={() => onMoveJob(job.id, queueIndex - 1)}
                            paths={["M8 12.5 V3.5", "M4.5 7 L8 3.5 L11.5 7"]}
                          />
                          <RowButton
                            label="Run later"
                            disabled={queueIndex === queueOrder.length - 1}
                            onClick={() => onMoveJob(job.id, queueIndex + 1)}
                            paths={["M8 3.5 V12.5", "M4.5 9 L8 12.5 L11.5 9"]}
                          />
                        </>
                      )}
                      {/* One button, one meaning per state: a live run is
                          corrected, a waiting one takes over. */}
                      {job.status === "running" && onSteerJob && (
                        <RowButton
                          label="Steer this run"
                          onClick={() => onSteerJob(job)}
                          // A course correction: a path bending away.
                          paths={["M3.5 12.5 C7 12.5 8 3.5 12.5 3.5", "M9.5 3.5 h3 v3"]}
                        />
                      )}
                      {job.status === "queued" && onPromoteJob && (
                        <RowButton
                          label="Run this now"
                          onClick={() => onPromoteJob(job.id)}
                          // Skip ahead: a play head against a bar.
                          paths={["M4 3.5 L10 8 L4 12.5 Z", "M12 3.5 V12.5"]}
                        />
                      )}
                      {onCancelJob && (
                        <RowButton
                          label={job.status === "running" ? "Stop this run" : "Remove from queue"}
                          danger
                          onClick={() => onCancelJob(job.id)}
                          paths={["M4 4 L12 12", "M12 4 L4 12"]}
                        />
                      )}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-[18px]">
                  {job.targetRef && onRevealTarget ? (
                    // Reads as a control, not a caption: a target glyph, a
                    // resting fill and a pointer, because nobody clicks a label
                    // that looks like the text beside it.
                    <button
                      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] leading-none text-neutral-400 ring-1 ring-inset ring-white/10 transition-colors duration-150 ease-out hover:bg-studio-accent/15 hover:text-studio-accent hover:ring-studio-accent/30 active:scale-[0.96]"
                      onClick={() => onRevealTarget(job)}
                      aria-label={
                        job.targetKind === "range"
                          ? `Seek to ${job.target}, the stretch this run edited`
                          : `Show ${job.target}, the element this run edited`
                      }
                    >
                      {/* A run about a stretch of the timeline and a run about
                          one element are different jobs, so they get different
                          marks: a span between two ticks, or a target. */}
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        {job.targetKind === "range" ? (
                          <>
                            <path d="M3 3.5 V12.5 M13 3.5 V12.5" />
                            <path d="M3 8 H13" />
                          </>
                        ) : (
                          <>
                            <circle cx="8" cy="8" r="3.25" />
                            <path d="M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5" />
                          </>
                        )}
                      </svg>
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
                  {job.model && (
                    <span
                      className="ml-auto shrink-0 truncate text-[10px] leading-none text-neutral-600"
                      title={`Ran with ${job.model}${job.effort ? ` · ${job.effort}` : ""}`}
                    >
                      {job.model}
                      {job.effort ? ` · ${job.effort}` : ""}
                    </span>
                  )}
                  {job.sessionId && (
                    <span
                      className={`shrink-0 font-mono text-[10px] leading-none text-neutral-700 ${job.model ? "" : "ml-auto"}`}
                      title={`Session ${job.sessionId}`}
                    >
                      {job.sessionId.slice(0, 8)}
                    </span>
                  )}
                </div>
                {job.steers && job.steers.length > 0 && (
                  <p className="mt-1 truncate pl-[18px] text-[10px] leading-none text-neutral-600">
                    steered: {job.steers[job.steers.length - 1]}
                  </p>
                )}
                {onAnswerJob && <AgentPermissionPrompt job={job} onAnswer={onAnswerJob} />}
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
