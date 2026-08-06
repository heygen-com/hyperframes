import { useCallback, useMemo, useRef, useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlayerStore } from "../store/playerStore";
import { formatTime } from "../lib/time";
import { buildTimelineAgentPrompt } from "./timelineEditing";
import { useSelectedTimelineTrack } from "./useTimelineTrackSelection";
import { copyTextToClipboard } from "../../utils/clipboard";
import { InlineAgentComposer } from "../../components/editor/InlineAgentComposer";
import {
  useDomEditActionsContextOptional,
  useDomEditSelectionContextOptional,
} from "../../contexts/DomEditContext";
import { FLOATING_SURFACE } from "../../components/ui/floatingSurface";

interface EditPopoverProps {
  rangeStart: number;
  rangeEnd: number;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}

const POPOVER_WIDTH = 320;

/**
 * Ask the agent about a stretch of the timeline.
 *
 * It used to only copy a prompt to the clipboard, which left the user to paste
 * it into a terminal and lose everything Studio knows: which harness, which
 * model, the queue, the tray, the run history. It now runs the same way a
 * canvas edit does — same composer, same queue — because "these elements
 * between these two times" is just another way of naming what to edit.
 */
export function EditPopover({ rangeStart, rangeEnd, anchorX, anchorY, onClose }: EditPopoverProps) {
  const elements = usePlayerStore((s) => s.elements);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const actions = useDomEditActionsContextOptional();
  const selectionValue = useDomEditSelectionContextOptional();

  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);

  // A track selection narrows what the request is about. Without one the range
  // spans every track, which is what a ruler drag has always meant.
  const selectedTrack = useSelectedTimelineTrack();
  const elementsInRange = useMemo(
    () =>
      elements.filter(
        (el) =>
          el.start < end &&
          el.start + el.duration > start &&
          (selectedTrack === null || el.track === selectedTrack),
      ),
    [elements, start, end, selectedTrack],
  );

  // The number the agent will read and write, which is not the lane the user
  // clicked: Studio packs authored tracks onto contiguous display lanes.
  const authoredTrack = useMemo(() => {
    if (selectedTrack === null) return undefined;
    const onTrack = elements.find((el) => el.track === selectedTrack);
    return onTrack?.authoredTrack ?? onTrack?.track ?? selectedTrack;
  }, [elements, selectedTrack]);

  // The canvas fetches these when its composer opens; this is the timeline's
  // equivalent moment, and without it the model and effort chips never appear.
  useMountEffect(() => {
    void actions?.refreshAgentModels(selectionValue?.agentRunKind ?? null);
  });

  useMountEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useMountEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    // Deferred: the click that opened the popover would otherwise close it.
    setTimeout(() => window.addEventListener("mousedown", handleClick), 100);
    return () => window.removeEventListener("mousedown", handleClick);
  });

  const buildPrompt = useCallback(
    (instruction: string) =>
      buildTimelineAgentPrompt({
        rangeStart: start,
        rangeEnd: end,
        elements: elementsInRange,
        prompt: instruction,
        track: authoredTrack,
      }),
    [start, end, elementsInRange, authoredTrack],
  );

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(
      8,
      Math.min(anchorX - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - 16),
    ),
    top: Math.max(8, anchorY - 320),
    zIndex: 200,
  };

  const label =
    authoredTrack === undefined
      ? `${formatTime(start)} - ${formatTime(end)}`
      : `Track ${authoredTrack} · ${formatTime(start)} - ${formatTime(end)}`;

  return (
    <div ref={popoverRef} style={style} className={`w-[320px] rounded-2xl p-2 ${FLOATING_SURFACE}`}>
      <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-0.5">
        <span className="size-1.5 shrink-0 rounded-full bg-studio-accent" />
        <span className="text-[11px] leading-none text-neutral-300">{label}</span>
        <span className="ml-auto text-[10px] leading-none text-neutral-600">
          {elementsInRange.length} element{elementsInRange.length === 1 ? "" : "s"}
        </span>
      </div>

      {elementsInRange.length > 0 && (
        <ul
          data-preview-overlay-scroll="true"
          className="mb-1.5 max-h-20 space-y-0.5 overflow-y-auto overscroll-contain px-1.5"
        >
          {elementsInRange.map((el) => (
            <li key={el.id} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] leading-none text-studio-accent/80">
                #{el.id}
              </span>
              <span className="shrink-0 text-[10px] leading-none text-neutral-600">{el.tag}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The same composer the canvas uses: one prompt box in the product, with
          the harness, model and effort it will run with. */}
      <InlineAgentComposer
        selectionLabel={label}
        draftKey={`timeline:${start.toFixed(2)}-${end.toFixed(2)}`}
        rect={null}
        canvas={{ width: 0, height: 0 }}
        placement={{ left: 0, top: 0 }}
        runLabel={selectionValue?.agentRunLabel ?? null}
        agentKind={selectionValue?.agentRunKind ?? null}
        agentIconUrl={selectionValue?.agentIconUrlById ?? selectionValue?.agentIconUrl ?? null}
        agentOptions={selectionValue?.agentOptions ?? []}
        agentModels={selectionValue?.agentModels ?? []}
        selectedModel={selectionValue?.selectedModel ?? null}
        selectedEffort={selectionValue?.selectedEffort ?? null}
        onSelectAgent={(id) => {
          actions?.setSelectedAgentId(id);
          void actions?.refreshAgentModels(id);
        }}
        onAddCustomAgent={actions?.addCustomAgent}
        onSelectModel={(model) => {
          if (selectionValue?.agentRunKind)
            actions?.setSelectedModel(selectionValue.agentRunKind, model);
        }}
        onSelectEffort={(effort) => {
          if (selectionValue?.agentRunKind)
            actions?.setSelectedEffort(selectionValue.agentRunKind, effort);
        }}
        onRun={(instruction) => {
          actions?.handleTimelineRangeRun({
            start,
            end,
            prompt: buildPrompt(instruction),
            instruction,
            elements: elementsInRange.map((el) => ({ id: el.id })),
            track: authoredTrack,
          });
          onClose();
        }}
        onCopy={(instruction) => {
          void copyTextToClipboard(buildPrompt(instruction)).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(onClose, 700);
          });
        }}
        onClose={onClose}
        // Already positioned by the popover: the composer draws in place.
        toContainerStyle={() => ({ position: "relative", left: 0, top: 0 })}
      />
      {copied && (
        <p className="px-1.5 pb-0.5 text-[10px] leading-none text-studio-accent">Prompt copied</p>
      )}
    </div>
  );
}
