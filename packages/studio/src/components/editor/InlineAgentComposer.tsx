import { useRef, useState, type CSSProperties } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { clampNumber } from "../../utils/studioHelpers";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import type { OverlayRect } from "./domEditOverlayGeometry";

export interface InlineAgentRunResult {
  ok: boolean;
  message: string;
}

/** Mirrors the server's AgentKind — the harness whose mark the composer shows. */
export type AgentKind = "claude" | "codex";

/**
 * Harness mark. Claude Code gets its coral sunburst; Codex gets a terminal
 * caret rather than a hand-traced OpenAI knot, which would only ever be a bad
 * copy of a trademark. Both are drawn with currentColor-independent brand hues
 * so the running agent is identifiable at a glance.
 */
function AgentGlyph({ kind }: { kind: AgentKind }) {
  if (kind === "codex") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-neutral-300"
        aria-hidden="true"
      >
        <path d="M4 4.5 L7.5 8 L4 11.5" />
        <path d="M9 11.5 H12.5" />
      </svg>
    );
  }

  // Eight tapered spokes on 45° steps — the Claude asterisk.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="shrink-0"
      fill="#d97757"
      aria-hidden="true"
    >
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path key={angle} d="M8 1.2 L8.9 6.4 L8 8 L7.1 6.4 Z" transform={`rotate(${angle} 8 8)`} />
      ))}
    </svg>
  );
}

const COMPOSER_WIDTH = 360;
const GAP = 10;

/**
 * Place the composer under the selection, flipping above when it would fall off
 * the bottom, and clamping both axes to the canvas. A null rect (element
 * scrolled out of view, or opened from the inspector) pins it to the bottom.
 */
export function resolveComposerPosition(
  rect: OverlayRect | null,
  canvas: { width: number; height: number },
  composerHeight: number,
): CSSProperties {
  if (!rect || canvas.width === 0) {
    return { left: Math.max(GAP, (canvas.width - COMPOSER_WIDTH) / 2), bottom: GAP };
  }

  const below = rect.top + rect.height + GAP;
  const above = rect.top - composerHeight - GAP;
  const fitsBelow = below + composerHeight <= canvas.height - GAP;

  return {
    left: clampNumber(
      rect.left + rect.width / 2 - COMPOSER_WIDTH / 2,
      GAP,
      Math.max(GAP, canvas.width - COMPOSER_WIDTH - GAP),
    ),
    top: clampNumber(fitsBelow ? below : above, GAP, Math.max(GAP, canvas.height - composerHeight)),
  };
}

// Depth from layered shadow, not a border; the hairline ring only keeps the
// edge legible against arbitrary composition content underneath.
const SURFACE_CLASS =
  "rounded-2xl bg-neutral-950/95 ring-1 ring-white/10 backdrop-blur-md " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]";

const BUTTON_CLASS =
  "rounded-lg px-2.5 py-1 text-[11px] transition-[color,background-color,opacity,scale] " +
  "duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The agent prompt box, drawn on the canvas beside the element it edits — no
 * modal, no backdrop, so the composition stays visible while the agent works
 * and the next element is one click away.
 */
export function InlineAgentComposer({
  selectionLabel,
  rect,
  canvas,
  runLabel,
  agentKind,
  running,
  onRun,
  onCopy,
  onClose,
}: {
  selectionLabel: string;
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
  /** Name of the installed agent CLI, or null when none is available to run. */
  runLabel: string | null;
  agentKind: AgentKind | null;
  running: boolean;
  onRun: (instruction: string) => Promise<InlineAgentRunResult | undefined>;
  onCopy: (instruction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<InlineAgentRunResult | null>(null);
  // Drag offset from the anchored position — the composer can cover the very
  // element being edited, so the header doubles as a drag handle.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useMountEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const submit = async () => {
    const instruction = value.trim();
    if (!instruction || running) return;
    if (!runLabel) {
      onCopy(instruction);
      return;
    }
    setResult(null);
    const next = await onRun(instruction);
    if (next?.ok) setValue("");
    setResult(next ?? null);
    inputRef.current?.focus();
  };

  const dragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX - offset.x,
        startY: e.clientY - offset.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      setOffset({ x: e.clientX - drag.startX, y: e.clientY - drag.startY });
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
  };

  const statusText = running
    ? `${runLabel} is editing…`
    : (result?.message ?? (runLabel ? "Enter to run · Esc to close" : "Enter to copy the prompt"));

  return (
    <div
      data-inline-agent-composer="true"
      className={`hf-composer-enter absolute z-20 w-[360px] p-2 ${SURFACE_CLASS}`}
      style={{
        ...resolveComposerPosition(rect, canvas, result || running ? 130 : 112),
        translate: offset.x || offset.y ? `${offset.x}px ${offset.y}px` : undefined,
      }}
      // The canvas overlay owns pointer gestures — keep clicks and keystrokes
      // inside the composer from reselecting or nudging the element being edited.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-1 pb-1.5 active:cursor-grabbing"
        {...dragHandlers}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-neutral-500">
          {agentKind && <AgentGlyph kind={agentKind} />}
          <span className="truncate">
            {runLabel ? `${runLabel} · ` : ""}
            {selectionLabel}
          </span>
        </span>
        <button
          className="rounded-md p-0.5 text-neutral-600 transition-colors duration-150 ease-out hover:text-neutral-300 active:scale-[0.96]"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          aria-label="Close"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <textarea
        ref={inputRef}
        rows={2}
        disabled={running}
        className="w-full resize-none rounded-lg bg-neutral-900/80 px-2.5 py-1.5 text-[13px] leading-snug text-neutral-200 ring-1 ring-white/10 transition-[box-shadow,opacity] duration-150 ease-out placeholder:text-neutral-600 focus:outline-none focus:ring-studio-accent/50 disabled:opacity-60"
        placeholder="Describe a change…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />

      <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
        <span
          className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-none ${
            running || result?.ok
              ? "text-studio-accent"
              : result
                ? "text-red-400"
                : "text-neutral-600"
          }`}
        >
          {(running || result) && (
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                running
                  ? "animate-pulse bg-studio-accent"
                  : result?.ok
                    ? "bg-studio-accent"
                    : "bg-red-400"
              }`}
            />
          )}
          <span className="truncate">{statusText}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {runLabel && (
            <button
              className={`${BUTTON_CLASS} text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200`}
              disabled={!value.trim() || running}
              onClick={() => onCopy(value.trim())}
            >
              Copy
            </button>
          )}
          <button
            className={`${BUTTON_CLASS} bg-studio-accent/90 font-medium text-neutral-950 hover:bg-studio-accent`}
            disabled={!value.trim() || running}
            onClick={() => void submit()}
          >
            {running ? "Running…" : runLabel ? "Run" : "Copy prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Canvas-side connector: renders the composer over the selected element when
 * the agent session is open. Reads the DomEdit contexts directly so the
 * overlay doesn't thread agent props through its own signature; returns null in
 * standalone player mounts, which have no project to edit.
 */
export function InlineAgentComposerHost({
  rect,
  canvas,
}: {
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
}) {
  const actions = useDomEditActionsContextOptional();
  const selectionValue = useDomEditSelectionContextOptional();
  if (!actions || !selectionValue?.agentModalOpen || !selectionValue.domEditSelection) return null;

  return (
    <InlineAgentComposer
      selectionLabel={selectionValue.domEditSelection.label}
      rect={rect}
      canvas={canvas}
      runLabel={selectionValue.agentRunLabel}
      agentKind={selectionValue.agentRunKind}
      running={selectionValue.agentRunning}
      onRun={actions.handleAgentModalRun}
      onCopy={(instruction) => void actions.handleAgentModalSubmit(instruction)}
      onClose={() => {
        actions.setAgentModalOpen(false);
        actions.setAgentPromptSelectionContext(undefined);
      }}
    />
  );
}
