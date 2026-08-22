/**
 * The FX entry point from the timeline (C1) — a track or group header button
 * that opens the same preset shelf the property panel's rack uses, without
 * requiring a trip through the panel first.
 *
 * Rendered on group rows and on track rows holding exactly one audio clip
 * (see `plans/audio-mixer-groups.md` §1.6 and the execution runbook's C1 step
 * — a track with several ungrouped clips has no single chain to point at, so
 * it gets the grouping pointer instead of the popover).
 */

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  enabledAudioFxNodes,
  parseAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import type { HfAudioNameKind } from "@hyperframes/core/audio-carve";
import { TimelineFxPopover } from "../../components/editor/TimelineFxPopover.js";
import { resolveFloatingPanelPosition } from "../../components/editor/floatingPanel.js";

// Estimated, like FORMAT_PANEL_SIZE in RenderQueue: `w-56` is exact, and only
// the flip decision uses the height — the clamp keeps the dialog on screen
// either way.
const GROUP_DIALOG_SIZE = { width: 224, height: 112 };

/** Where the grouping dialog goes: flipped above the anchor when there is no
 *  room below, and clamped so neither edge leaves the viewport. */
function groupDialogPosition(anchorRect: DOMRect): { left: number; top: number } {
  const { left, top } = resolveFloatingPanelPosition(
    anchorRect,
    { width: window.innerWidth, height: window.innerHeight },
    GROUP_DIALOG_SIZE,
    { offset: 4 },
  );
  return { left, top };
}

function parseFxChainOrEmpty(raw: string | undefined): HfAudioFxChain {
  if (!raw) return { version: 1, nodes: [] };
  try {
    return parseAudioFxChain(raw);
  } catch {
    return { version: 1, nodes: [] };
  }
}

interface TimelineFxButtonChainProps {
  variant?: "chain";
  trackKind?: HfAudioNameKind;
  onOpenRack: () => void;
  fxChainRaw: string | undefined;
  onChainChange: (next: HfAudioFxChain) => void;
  onChainPreview?: (next: HfAudioFxChain) => void;
  onAuditionTransport?: (on: boolean) => void;
}

interface TimelineFxButtonGroupPointerProps {
  variant: "group-pointer";
  onGroupClips: () => void;
}

type TimelineFxButtonProps = TimelineFxButtonChainProps | TimelineFxButtonGroupPointerProps;

export function TimelineFxButton(props: TimelineFxButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const openAt = () => {
    setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  if (props.variant === "group-pointer") {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          tabIndex={-1}
          ref={buttonRef}
          aria-label="Effects — group these clips first"
          title="Group these clips to add effects to all of them"
          className="flex h-6 items-center justify-center rounded border-0 bg-transparent px-1 text-[10px] font-semibold text-white/35 hover:text-white/75"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openAt();
          }}
        >
          FX
        </button>
        {open &&
          anchorRect &&
          createPortal(
            <div
              role="dialog"
              aria-label="Group these clips to add effects"
              className="z-[200] w-56 rounded-md border border-white/10 bg-[#1b1b1f] p-2.5 text-[11px] text-white/75 shadow-xl"
              // Was `top: anchorRect.bottom + 4` with no flip and no clamp. This
              // button lives in a track header at the BOTTOM of the studio
              // window, so the dialog opened past the viewport edge and the
              // click read as doing nothing at all. Same helper the other body
              // portals position with.
              style={{ position: "fixed", ...groupDialogPosition(anchorRect) }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <p>Group these clips to add effects to all of them.</p>
              <button
                type="button"
                className="mt-2 w-full rounded border border-white/20 py-1 text-[10px] font-semibold text-white hover:bg-white/10"
                onClick={() => {
                  setOpen(false);
                  props.onGroupClips();
                }}
              >
                Group
              </button>
            </div>,
            document.body,
          )}
      </div>
    );
  }

  const chain = parseFxChainOrEmpty(props.fxChainRaw);
  const nodeCount = enabledAudioFxNodes(chain).length;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        tabIndex={-1}
        ref={buttonRef}
        aria-label={nodeCount > 0 ? `Effects — ${nodeCount} applied` : "Effects"}
        title="Effects"
        className={`flex h-6 items-center justify-center gap-0.5 rounded border-0 bg-transparent px-1 text-[10px] font-semibold transition-colors ${
          open || nodeCount > 0 ? "text-[#3CE6AC]" : "text-white/35 hover:text-white/75"
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          openAt();
        }}
      >
        FX{nodeCount > 0 ? ` ${nodeCount}` : ""}
      </button>
      {open &&
        anchorRect &&
        createPortal(
          <TimelineFxPopover
            anchorRect={anchorRect}
            chain={chain}
            trackKind={props.trackKind}
            onClose={() => setOpen(false)}
            onChainChange={props.onChainChange}
            onChainPreview={props.onChainPreview}
            onAuditionTransport={props.onAuditionTransport}
            onOpenRack={props.onOpenRack}
          />,
          document.body,
        )}
    </div>
  );
}
