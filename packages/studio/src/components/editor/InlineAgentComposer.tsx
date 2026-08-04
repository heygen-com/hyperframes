import { useRef, useState, type CSSProperties } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { clampNumber } from "../../utils/studioHelpers";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { AgentGlyph, type AgentKind, type AgentModel, type AgentOption } from "./agentGlyphs";
import { AgentRunTray } from "./AgentRunTray";
import type { OverlayRect } from "./domEditOverlayGeometry";

const COMPOSER_WIDTH = 320;
const COMPOSER_HEIGHT = 84;
const GAP = 10;

/**
 * Place the composer under the selection, flipping above when it would fall off
 * the bottom, and clamping both axes to the canvas. A null rect (element
 * scrolled out of view, or opened from the inspector) pins it to the bottom.
 */
export function resolveComposerPosition(
  rect: OverlayRect | null,
  canvas: { width: number; height: number },
  composerHeight: number = COMPOSER_HEIGHT,
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
// edge legible against arbitrary composition content underneath. Radii are
// concentric: 16px outer, 6px padding, 10px field.
const SURFACE_CLASS =
  "rounded-2xl bg-neutral-950/95 p-1.5 ring-1 ring-white/10 backdrop-blur-md " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.5),0_12px_32px_-8px_rgba(0,0,0,0.7)]";

/**
 * The agent prompt box, drawn on the canvas beside the element it edits — no
 * modal, no backdrop, so the composition stays visible while the agent works.
 * Submitting queues a run and clears the field immediately: the next element is
 * one click away, and the run tray tracks everything in flight.
 */
export function InlineAgentComposer({
  selectionLabel,
  rect,
  canvas,
  runLabel,
  agentKind,
  agentIconUrl,
  agentOptions = [],
  agentModels = [],
  selectedModel = null,
  onSelectAgent,
  onSelectModel,
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
  /** A real logo for this harness, supplied via HYPERFRAMES_AGENT_ICON. */
  agentIconUrl: string | null;
  /** Every harness Studio knows about, installed or not. */
  agentOptions?: AgentOption[];
  /** Tool-capable models for the active harness, cheapest first. */
  agentModels?: AgentModel[];
  selectedModel?: string | null;
  onSelectAgent?: (kind: AgentKind) => void;
  onSelectModel?: (model: string | null) => void;
  onRun: (instruction: string) => void;
  onCopy: (instruction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Drag offset from the anchored position — the composer can cover the very
  // element being edited, so the header doubles as a drag handle.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus twice on purpose: the click that opens the composer can hand focus
  // back to its trigger button, and a keystroke that misses the field lands on
  // the canvas hotkeys instead (typing "r" would start a gesture recording).
  useMountEffect(() => {
    inputRef.current?.focus();
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const submit = () => {
    const instruction = value.trim();
    if (!instruction) return;
    if (runLabel) onRun(instruction);
    else onCopy(instruction);
    setValue("");
    if (inputRef.current) inputRef.current.style.height = "auto";
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

  return (
    <div
      data-inline-agent-composer="true"
      className={`hf-composer-enter absolute z-20 w-[320px] ${SURFACE_CLASS}`}
      style={{
        ...resolveComposerPosition(rect, canvas),
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
        className="flex cursor-grab items-center gap-1.5 px-1.5 pb-1.5 pt-0.5 active:cursor-grabbing"
        {...dragHandlers}
      >
        {/* The harness owns the header (the element it edits reads from the
            field's placeholder) and doubles as the picker: a queue can mix
            harnesses, so the choice belongs next to the instruction. */}
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 text-[11px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 disabled:hover:bg-transparent"
          disabled={!onSelectAgent || agentOptions.length < 2}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPickerOpen((open) => !open)}
          aria-haspopup={agentOptions.length > 1 ? "menu" : undefined}
          aria-expanded={pickerOpen}
          title={agentOptions.length > 1 ? "Run with a different harness" : undefined}
        >
          {agentKind && <AgentGlyph kind={agentKind} size={11} iconUrl={agentIconUrl} />}
          <span className="truncate">{runLabel ?? selectionLabel}</span>
          {onSelectAgent && agentOptions.length > 1 && (
            <svg
              width="9"
              height="9"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-70"
              aria-hidden="true"
            >
              <path d="M4 6.5 L8 10.5 L12 6.5" />
            </svg>
          )}
        </button>
        {runLabel && (
          <button
            className="rounded-md px-1.5 py-0.5 text-[10px] leading-none text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 active:scale-[0.96] disabled:opacity-40"
            disabled={!value.trim()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onCopy(value.trim())}
            title="Copy the prompt instead of running it"
          >
            Copy
          </button>
        )}
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

      {pickerOpen && onSelectAgent && (
        <div className="mb-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-[10px] bg-neutral-900/70 p-1 ring-1 ring-white/10">
          <ul className="space-y-0.5">
            {agentOptions.map((option) => (
              <li key={option.kind}>
                <button
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-300 transition-colors duration-150 ease-out hover:bg-neutral-800/70 disabled:opacity-35 disabled:hover:bg-transparent"
                  disabled={!option.available}
                  onClick={() => {
                    onSelectAgent(option.kind);
                    setPickerOpen(false);
                    inputRef.current?.focus();
                  }}
                  title={option.available ? undefined : `${option.label} is not installed`}
                >
                  <AgentGlyph kind={option.kind} size={11} />
                  <span className="truncate">{option.label}</span>
                  {option.label === runLabel && (
                    <span className="ml-auto text-[10px] text-studio-accent">in use</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {agentModels.length > 0 && onSelectModel && (
            <>
              <div className="mt-1 flex items-center justify-between px-1.5 pb-1 pt-1.5 text-[10px] leading-none text-neutral-600">
                <span>Model</span>
                <span>cheapest first</span>
              </div>
              <ul className="space-y-0.5">
                <li>
                  <button
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-300 transition-colors duration-150 ease-out hover:bg-neutral-800/70"
                    onClick={() => {
                      onSelectModel(null);
                      setPickerOpen(false);
                    }}
                  >
                    <span className="truncate">Cheapest that can run</span>
                    {!selectedModel && (
                      <span className="ml-auto text-[10px] text-studio-accent">in use</span>
                    )}
                  </button>
                </li>
                {agentModels.map((model) => (
                  <li key={model.id}>
                    <button
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-300 transition-colors duration-150 ease-out hover:bg-neutral-800/70"
                      onClick={() => {
                        onSelectModel(model.id);
                        setPickerOpen(false);
                      }}
                      title={model.id}
                    >
                      <span className="truncate">{model.name}</span>
                      {model.inputCost !== undefined && (
                        <span className="ml-auto shrink-0 text-[10px] text-neutral-600 tabular-nums">
                          ${model.inputCost}/M
                        </span>
                      )}
                      {selectedModel === model.id && (
                        <span className="ml-1 shrink-0 text-[10px] text-studio-accent">in use</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex items-end gap-1.5 rounded-[10px] bg-neutral-900/70 px-2 py-1.5 ring-1 ring-white/10 transition-[box-shadow] duration-150 ease-out focus-within:ring-studio-accent/40">
        <textarea
          ref={inputRef}
          rows={1}
          className="max-h-24 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-snug text-neutral-200 outline-none placeholder:text-neutral-600"
          placeholder={`Describe a change to ${selectionLabel}…`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(96, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-studio-accent text-neutral-950 transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!value.trim()}
          onClick={submit}
          aria-label={runLabel ? `Run ${runLabel}` : "Copy prompt"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 13 V3" />
            <path d="M4 6.5 L8 2.5 L12 6.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Canvas-side connector: renders the composer over the selected element while
 * the agent session is open, and the run tray whenever this project has runs.
 * Reads the DomEdit contexts directly so the overlay doesn't thread agent props
 * through its own signature; returns null in standalone player mounts, which
 * have no project to edit.
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
  if (!actions || !selectionValue) return null;

  const {
    domEditSelection,
    agentModalOpen,
    agentRunLabel,
    agentRunKind,
    agentIconUrl,
    agentOptions,
    agentModels,
    selectedModel,
    agentJobs,
  } = selectionValue;

  return (
    <>
      {agentModalOpen && domEditSelection && (
        <InlineAgentComposer
          selectionLabel={domEditSelection.label}
          rect={rect}
          canvas={canvas}
          runLabel={agentRunLabel}
          agentKind={agentRunKind}
          agentIconUrl={agentIconUrl}
          agentOptions={agentOptions}
          agentModels={agentModels}
          selectedModel={selectedModel}
          onSelectAgent={(kind) => {
            actions.setSelectedAgentKind(kind);
            void actions.refreshAgentModels(kind);
          }}
          onSelectModel={(model) => {
            if (agentRunKind) actions.setSelectedModel(agentRunKind, model);
          }}
          onRun={actions.handleAgentModalRun}
          onCopy={(instruction) => void actions.handleAgentModalSubmit(instruction)}
          onClose={() => {
            actions.setAgentModalOpen(false);
            actions.setAgentPromptSelectionContext(undefined);
          }}
        />
      )}
      <AgentRunTray
        jobs={agentJobs}
        agentIconUrl={agentIconUrl}
        onClearFinished={actions.clearFinishedAgentJobs}
        onMoveJob={actions.moveAgentJob}
        onCancelJob={actions.cancelAgentJob}
        onRevealTarget={actions.revealAgentJobTarget}
      />
    </>
  );
}
