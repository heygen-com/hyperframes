import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMountEffect } from "../../hooks/useMountEffect";
import { clampNumber } from "../../utils/studioHelpers";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import {
  AgentGlyph,
  type AgentKind,
  type AgentModel,
  type AgentOption,
  type CustomAgentDraft,
} from "./agentGlyphs";
import { CustomAgentForm } from "./CustomAgentForm";
import { AgentAnswerBubble } from "./AgentAnswerBubble";
import { layoutAgentSurfaces } from "./agentSurfaceLayout";
import { dismissAnswer, isAnswerDismissed } from "../../utils/agentAnswers";
import { CANVAS_OVERLAY_CONTROL_Z, FLOATING_CHIP, FLOATING_SURFACE } from "../ui/floatingSurface";
import {
  agentDraftKey,
  clearAgentDraft,
  readAgentDraft,
  writeAgentDraft,
} from "../../utils/agentDrafts";
import { AgentRunTray } from "./AgentRunTray";
import type { OverlayRect } from "./domEditOverlayGeometry";

const COMPOSER_WIDTH = 320;
/** Collapsed width of the ask handle; it expands to its label on hover. */
const HANDLE_WIDTH = 26;
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
    return {
      left: Math.max(GAP, (canvas.width - COMPOSER_WIDTH) / 2),
      top: Math.max(GAP, canvas.height - composerHeight - GAP),
    };
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

function Chevron() {
  return (
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
  );
}

// Radii are concentric: 16px outer, 6px padding, 10px field.
const SURFACE_CLASS = `rounded-2xl p-1.5 ${FLOATING_SURFACE}`;

/**
 * The agent prompt box, drawn on the canvas beside the element it edits — no
 * modal, no backdrop, so the composition stays visible while the agent works.
 * Submitting queues a run and clears the field immediately: the next element is
 * one click away, and the run tray tracks everything in flight.
 */
export function InlineAgentComposer({
  selectionLabel,
  draftKey,
  rect,
  canvas,
  placement,
  runLabel,
  agentKind,
  agentIconUrl,
  agentOptions = [],
  agentModels = [],
  selectedModel = null,
  selectedEffort = null,
  onSelectAgent,
  onAddCustomAgent,
  onSelectModel,
  onSelectEffort,
  onRun,
  onCopy,
  onClose,
  toContainerStyle = (style) => style,
}: {
  selectionLabel: string;
  /** Identifies the element this draft belongs to; see utils/agentDrafts. */
  draftKey: string;
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
  /** Where the shared layout put this panel, so it never lands on the bubble. */
  placement?: { left: number; top: number };
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
  selectedEffort?: string | null;
  onSelectAgent?: (id: string) => void;
  onSelectEffort?: (effort: string | null) => void;
  onAddCustomAgent?: (draft: CustomAgentDraft) => Promise<boolean>;
  onSelectModel?: (model: string | null) => void;
  onRun: (instruction: string) => void;
  onCopy: (instruction: string) => void;
  onClose: () => void;
  /** Lifts overlay-local coordinates into whatever space this is drawn in. */
  toContainerStyle?: (style: CSSProperties) => CSSProperties;
}) {
  // Seeded from the stored draft: a reload lands mid-sentence otherwise, and
  // the agent's own edits are what trigger those reloads.
  const [value, setValue] = useState(() => readAgentDraft(draftKey));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
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

  const updateValue = (next: string) => {
    setValue(next);
    writeAgentDraft(draftKey, next);
  };

  const submit = () => {
    const instruction = value.trim();
    if (!instruction) return;
    if (runLabel) onRun(instruction);
    else onCopy(instruction);
    setValue("");
    clearAgentDraft(draftKey);
    if (inputRef.current) inputRef.current.style.height = "auto";
    inputRef.current?.focus();
  };

  const activeModel = agentModels.find((model) => model.id === selectedModel) ?? agentModels[0];
  const effortOptions = activeModel?.effortOptions ?? [];

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
      className={`hf-composer-enter absolute ${CANVAS_OVERLAY_CONTROL_Z} w-[320px] ${SURFACE_CLASS}`}
      style={{
        ...toContainerStyle(placement ?? resolveComposerPosition(rect, canvas)),
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
          className="-mx-1 flex min-w-0 shrink items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300 disabled:hover:bg-transparent"
          disabled={!onSelectAgent}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setModelPickerOpen(false);
            setPickerOpen((open) => !open);
          }}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          aria-label={`Harness: ${runLabel ?? selectionLabel}`}
        >
          {agentKind && <AgentGlyph kind={agentKind} size={11} iconUrl={agentIconUrl} />}
          <span className="truncate">{runLabel ?? selectionLabel}</span>
          {onSelectAgent && <Chevron />}
        </button>
        {/* The model sits beside the harness, not inside its menu: which model
            ran is the other half of "who will do this", and it changes often. */}
        {onSelectModel && agentModels.length > 0 && (
          <button
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] leading-none text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPickerOpen(false);
              setModelPickerOpen((open) => !open);
            }}
            aria-haspopup="menu"
            aria-expanded={modelPickerOpen}
            aria-label={selectedModel ? `Model: ${selectedModel}` : "Model: cheapest that can run"}
          >
            <span className="truncate">
              {selectedModel ??
                (agentModels[0]?.id ? `${agentModels[0].id} · cheapest` : "cheapest")}
            </span>
            <Chevron />
          </button>
        )}
        {/* Effort rides beside the model because it is the same decision: how
            much thinking to buy. The lowest the model offers is the default. */}
        {onSelectEffort && effortOptions.length > 0 && (
          <button
            className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] leading-none text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-800/60 hover:text-neutral-300"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setPickerOpen(false);
              setModelPickerOpen(false);
              setEffortPickerOpen((open) => !open);
            }}
            aria-haspopup="menu"
            aria-expanded={effortPickerOpen}
            aria-label={`Effort: ${selectedEffort ?? effortOptions[0] ?? "lowest"}`}
          >
            <span className="truncate">{selectedEffort ?? effortOptions[0]}</span>
            <Chevron />
          </button>
        )}
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
        <div
          data-preview-overlay-scroll="true"
          className="mb-1.5 max-h-44 scroll-py-1 overflow-y-auto overscroll-contain scroll-smooth rounded-[10px] bg-neutral-900/70 p-1 ring-1 ring-white/10"
        >
          {addingAgent && onAddCustomAgent ? (
            <CustomAgentForm
              onSubmit={onAddCustomAgent}
              onCancel={() => {
                setAddingAgent(false);
                setPickerOpen(false);
              }}
            />
          ) : (
            <ul className="space-y-0.5">
              {agentOptions.map((option) => (
                <li key={option.id}>
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
                    <AgentGlyph kind={option.kind} size={11} iconUrl={option.iconUrl} />
                    <span className="truncate">{option.label}</span>
                    {option.label === runLabel && (
                      <span className="ml-auto text-[10px] text-studio-accent">in use</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {onAddCustomAgent && !addingAgent && (
            <button
              className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-500 transition-colors duration-150 ease-out hover:bg-neutral-800/70 hover:text-neutral-300"
              onClick={() => setAddingAgent(true)}
            >
              <span className="text-[13px] leading-none">+</span>
              <span>Add a harness…</span>
            </button>
          )}
        </div>
      )}

      {modelPickerOpen && onSelectModel && agentModels.length > 0 && (
        <ul
          data-preview-overlay-scroll="true"
          className="mb-1.5 max-h-44 space-y-0.5 scroll-py-1 overflow-y-auto overscroll-contain scroll-smooth rounded-[10px] bg-neutral-900/70 p-1 ring-1 ring-white/10"
        >
          <li>
            <button
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-300 transition-colors duration-150 ease-out hover:bg-neutral-800/70"
              onClick={() => {
                onSelectModel(null);
                setModelPickerOpen(false);
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
                  setModelPickerOpen(false);
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
      )}

      {effortPickerOpen && onSelectEffort && effortOptions.length > 0 && (
        <ul
          data-preview-overlay-scroll="true"
          className="mb-1.5 max-h-44 space-y-0.5 overflow-y-auto overscroll-contain scroll-smooth rounded-[10px] bg-neutral-900/70 p-1 ring-1 ring-white/10"
        >
          {effortOptions.map((effort, index) => (
            <li key={effort}>
              <button
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-none text-neutral-300 transition-colors duration-150 ease-out hover:bg-neutral-800/70"
                onClick={() => {
                  onSelectEffort(index === 0 ? null : effort);
                  setEffortPickerOpen(false);
                }}
              >
                <span className="truncate">{effort}</span>
                {index === 0 && (
                  <span className="ml-auto text-[10px] text-neutral-600">lowest</span>
                )}
                {(selectedEffort ?? effortOptions[0]) === effort && (
                  <span className="ml-1 shrink-0 text-[10px] text-studio-accent">in use</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-1.5 rounded-[10px] bg-neutral-900/70 px-2 py-1.5 ring-1 ring-white/10 transition-[box-shadow] duration-150 ease-out focus-within:ring-studio-accent/40">
        <textarea
          ref={inputRef}
          rows={1}
          className="max-h-24 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-snug text-neutral-200 outline-none placeholder:text-neutral-600"
          placeholder={`Describe a change to ${selectionLabel}…`}
          value={value}
          onChange={(e) => {
            updateValue(e.target.value);
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
 * The affordance that opens the composer: a small harness mark pinned to the
 * selection. It replaces auto-opening on every click — the panel used to land
 * on the canvas whether or not the user wanted to ask for anything — while
 * keeping the entry point where the eye already is, next to what is selected.
 */
function AskAgentHandle({
  rect,
  canvas,
  agentKind,
  agentIconUrl,
  label,
  onOpen,
  toContainerStyle = (style) => style,
}: {
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
  agentKind: AgentKind | null;
  agentIconUrl: string | null;
  label: string;
  onOpen: () => void;
  toContainerStyle?: (style: CSSProperties) => CSSProperties;
}) {
  if (!rect || canvas.width === 0) return null;

  // Sits above the selection's top edge, clear of the corner resize handles,
  // and clamped so it never leaves the canvas on an element near an edge. It
  // grows rightward on hover, so the anchor is the right edge either way.
  const right = clampNumber(rect.left + rect.width, HANDLE_WIDTH + GAP, canvas.width - GAP);
  const top = clampNumber(rect.top - 32, GAP, Math.max(GAP, canvas.height - 26 - GAP));

  return (
    <button
      data-ask-agent-handle="true"
      className={`hf-composer-enter group absolute ${CANVAS_OVERLAY_CONTROL_Z} flex h-[26px] w-[26px] items-center gap-1.5 overflow-hidden rounded-full px-[6px] text-[11px] leading-none text-neutral-300 transition-[width,color,box-shadow] duration-150 ease-out hover:w-[104px] hover:text-neutral-100 hover:ring-white/25 focus-visible:w-[104px] active:scale-[0.96] ${FLOATING_CHIP}`}
      style={toContainerStyle({ left: right - HANDLE_WIDTH, top })}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`Ask ${label} about this element`}
    >
      <AgentGlyph kind={agentKind ?? "custom"} size={14} iconUrl={agentIconUrl} />
      {/* The label rides in on hover — at rest this is a mark, not a banner over
          the composition, and no OS tooltip covers the element it points at. */}
      <span className="flex flex-1 items-center gap-1.5 whitespace-nowrap opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
        <span>Ask</span>
        <span className="ml-auto rounded bg-white/10 px-1 py-0.5 text-[9px] leading-none text-neutral-400">
          ⌘K
        </span>
      </span>
    </button>
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
  overlayEl,
}: {
  rect: OverlayRect | null;
  canvas: { width: number; height: number };
  /** The canvas overlay these coordinates are relative to. */
  overlayEl: HTMLElement | null;
}) {
  const [dismissedAnswers, setDismissedAnswers] = useState<string[]>([]);
  const actions = useDomEditActionsContextOptional();
  const selectionValue = useDomEditSelectionContextOptional();
  if (!actions || !selectionValue) return null;

  // Drawn in the document, not inside the canvas overlay: that overlay is a
  // z-10 stacking context and its sibling motion path sits at z-40, so nothing
  // rendered within it can come out on top however high its own z-index is.
  const origin = overlayEl?.getBoundingClientRect();
  const toViewport = (style: CSSProperties): CSSProperties => ({
    ...style,
    position: "fixed",
    left: typeof style.left === "number" ? style.left + (origin?.left ?? 0) : style.left,
    top: typeof style.top === "number" ? style.top + (origin?.top ?? 0) : style.top,
    zIndex: 70,
  });

  const {
    projectId,
    domEditSelection,
    domEditGroupSelections,
    agentModalOpen,
    agentRunLabel,
    agentRunKind,
    agentIconUrl,
    agentIconUrlById,
    agentOptions,
    agentModels,
    selectedModel,
    selectedEffort,
    agentJobs,
  } = selectionValue;

  // The newest finished run about the element in front of the user: an answer
  // belongs next to what it is about, not only in a list they may never open.
  const answer = domEditSelection
    ? agentJobs.find(
        (job) =>
          (job.status === "done" || job.status === "failed") &&
          Boolean(job.message) &&
          !dismissedAnswers.includes(job.id) &&
          !isAnswerDismissed(job.id) &&
          job.targetRef?.selector === domEditSelection.selector &&
          (job.targetRef?.sourceFile ?? "") === (domEditSelection.sourceFile ?? ""),
      )
    : undefined;

  // Both surfaces belong to the same element, so they are placed together —
  // laid out apart they land on top of each other.
  const surfaces =
    rect && (answer || (agentModalOpen && domEditSelection))
      ? layoutAgentSurfaces({
          rect,
          canvas,
          composer: agentModalOpen && domEditSelection ? { width: 320, height: 84 } : null,
          bubble: answer ? { width: 268, height: 108 } : null,
        })
      : {};


  return createPortal(
    <>
      {!agentModalOpen && domEditSelection && (
        <AskAgentHandle
          toContainerStyle={toViewport}
          rect={rect}
          canvas={canvas}
          agentKind={agentRunKind}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          label={agentRunLabel ?? "the agent"}
          onOpen={actions.handleAskAgent}
        />
      )}
      {answer && rect && (
        <AgentAnswerBubble
          job={answer}
          rect={rect}
          canvas={canvas}
          placement={surfaces.bubble}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          toContainerStyle={toViewport}
          onDismiss={() => {
            dismissAnswer(answer.id);
            setDismissedAnswers((ids) => [...ids, answer.id]);
          }}
          onFollowUp={() => {
            dismissAnswer(answer.id);
            setDismissedAnswers((ids) => [...ids, answer.id]);
            actions.handleAskAgent();
          }}
        />
      )}
      {agentModalOpen && domEditSelection && (
        <InlineAgentComposer
          toContainerStyle={toViewport}
          placement={surfaces.composer}
          selectionLabel={
            domEditGroupSelections.length > 1
              ? `${domEditGroupSelections.length} elements`
              : domEditSelection.label
          }
          draftKey={agentDraftKey({
            projectId,
            sourceFile: domEditSelection.sourceFile,
            selector: domEditSelection.selector,
            selectorIndex: domEditSelection.selectorIndex,
            id: domEditSelection.id,
          })}
          rect={rect}
          canvas={canvas}
          runLabel={agentRunLabel}
          agentKind={agentRunKind}
          agentIconUrl={agentIconUrlById ?? agentIconUrl}
          agentOptions={agentOptions}
          agentModels={agentModels}
          selectedModel={selectedModel}
          selectedEffort={selectedEffort}
          onSelectAgent={(id) => {
            actions.setSelectedAgentId(id);
            void actions.refreshAgentModels(id);
          }}
          onAddCustomAgent={actions.addCustomAgent}
          onSelectModel={(model) => {
            if (agentRunKind) actions.setSelectedModel(agentRunKind, model);
          }}
          onSelectEffort={(effort) => {
            if (agentRunKind) actions.setSelectedEffort(agentRunKind, effort);
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
    </>,
    document.body,
  );
}
