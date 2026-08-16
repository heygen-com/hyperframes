/**
 * The FX popover the timeline's per-track/per-group FX button opens (C1).
 *
 * A THIN positioner around existing pieces, not a second rack: the body is
 * `FxPresetMenu` exactly as the property panel's FX section renders it, and
 * applying or auditioning a preset goes through the caller's own write path
 * (a group's own attribute for a group target, the selected element's for a
 * clip) — nothing here serializes a chain of its own.
 */

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import type { HfAudioNameKind } from "@hyperframes/core/audio-carve";
import { FxPresetMenu } from "./propertyPanelFxPresetMenu.js";
import { applyPresetToChain } from "./useApplyAudioFxPreset.js";
import { useFxAudition } from "./useFxAudition.js";

const POPOVER_WIDTH = 260;
const VIEWPORT_MARGIN = 8;

function clampedStyle(anchorRect: DOMRect): CSSProperties {
  const left = Math.min(
    Math.max(anchorRect.left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
  );
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < 260 && anchorRect.top > spaceBelow;
  return {
    position: "fixed",
    left,
    width: POPOVER_WIDTH,
    ...(openUpward
      ? { bottom: window.innerHeight - anchorRect.top + 4 }
      : { top: anchorRect.bottom + 4 }),
  };
}

export interface TimelineFxPopoverProps {
  anchorRect: DOMRect;
  chain: HfAudioFxChain;
  trackKind?: HfAudioNameKind;
  onClose: () => void;
  /** Persist the applied preset onto the target (group attribute, or the
   *  selected clip's attribute — the caller resolves which). */
  onChainChange: (next: HfAudioFxChain) => void;
  /** Preview a hypothetical chain on the running graph without persisting. */
  onChainPreview?: (next: HfAudioFxChain) => void;
  onAuditionTransport?: (on: boolean) => void;
  /** Select the target the way clicking it in the timeline does, and ensure
   *  the property panel's Audio FX group is expanded. */
  onOpenRack: () => void;
}

export function TimelineFxPopover({
  anchorRect,
  chain,
  trackKind,
  onClose,
  onChainChange,
  onChainPreview,
  onAuditionTransport,
  onOpenRack,
}: TimelineFxPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { audition, clearAudition } = useFxAudition(chain, onChainPreview, onAuditionTransport);

  // Outside click dismisses like any other popover; the button itself is
  // excluded by pointerdown timing (the button's own click hasn't happened yet).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const applyPreset = (id: string) => {
    const next = applyPresetToChain(chain, id, trackKind);
    if (!next) return;
    clearAudition();
    onChainChange(next);
    onClose();
  };

  // Escape closes without deselecting whatever is behind this — a keystroke
  // aimed at the popover is not aimed at the clip under it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    audition(null);
    onClose();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Effects"
      className="z-50 rounded-md border border-white/10 bg-[#1b1b1f] p-2 shadow-xl"
      style={clampedStyle(anchorRect)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <FxPresetMenu
        trackKind={trackKind}
        onPick={applyPreset}
        onAudition={
          onChainPreview
            ? (id) =>
                audition(id ? (base) => applyPresetToChain(base, id, trackKind) ?? base : null)
            : undefined
        }
      />
      <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-white/55">
        <button
          type="button"
          className="hover:text-white"
          onClick={() => {
            onClose();
            onOpenRack();
          }}
        >
          + effect
        </button>
        <button
          type="button"
          className="hover:text-white"
          onClick={() => {
            onClose();
            onOpenRack();
          }}
        >
          Open rack ›
        </button>
      </div>
    </div>
  );
}
