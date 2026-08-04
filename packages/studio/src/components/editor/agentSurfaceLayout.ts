import { clampNumber } from "../../utils/studioHelpers";
import type { OverlayRect } from "./domEditOverlayGeometry";

/**
 * Where the agent's two canvas surfaces go.
 *
 * The composer and the answer bubble both belong to the same element, so laid
 * out independently they land on top of each other. One pass places both: the
 * composer takes the side it prefers, the bubble takes the other one, and when
 * only one side is usable the bubble stacks beyond the composer instead of over
 * it.
 */

export const AGENT_SURFACE_GAP = 10;
/** Keeps a tail inside the bubble's rounded corner. */
const TAIL_INSET = 14;

export interface SurfaceSize {
  width: number;
  height: number;
}

export interface SurfacePlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

export interface BubblePlacement extends SurfacePlacement {
  /** Tail offset inside the bubble, so it keeps pointing at the element. */
  tailLeft: number;
}

export interface AgentSurfaceLayout {
  composer?: SurfacePlacement;
  bubble?: BubblePlacement;
}

function centeredLeft(rect: OverlayRect, canvas: SurfaceSize, width: number): number {
  return clampNumber(
    rect.left + rect.width / 2 - width / 2,
    AGENT_SURFACE_GAP,
    Math.max(AGENT_SURFACE_GAP, canvas.width - width - AGENT_SURFACE_GAP),
  );
}

function clampTop(top: number, canvas: SurfaceSize, height: number): number {
  return clampNumber(
    top,
    AGENT_SURFACE_GAP,
    Math.max(AGENT_SURFACE_GAP, canvas.height - height - AGENT_SURFACE_GAP),
  );
}

function fitsBelow(rect: OverlayRect, canvas: SurfaceSize, height: number): boolean {
  return rect.top + rect.height + AGENT_SURFACE_GAP + height <= canvas.height - AGENT_SURFACE_GAP;
}

function fitsAbove(rect: OverlayRect, height: number): boolean {
  return rect.top - AGENT_SURFACE_GAP - height >= AGENT_SURFACE_GAP;
}

function place(
  rect: OverlayRect,
  canvas: SurfaceSize,
  size: SurfaceSize,
  side: "above" | "below",
): SurfacePlacement {
  const top =
    side === "below"
      ? rect.top + rect.height + AGENT_SURFACE_GAP
      : rect.top - size.height - AGENT_SURFACE_GAP;
  return { left: centeredLeft(rect, canvas, size.width), top: clampTop(top, canvas, size.height), side };
}

export function layoutAgentSurfaces({
  rect,
  canvas,
  composer,
  bubble,
}: {
  rect: OverlayRect;
  canvas: SurfaceSize;
  composer: SurfaceSize | null;
  bubble: SurfaceSize | null;
}): AgentSurfaceLayout {
  const layout: AgentSurfaceLayout = {};

  // The composer is where the user is typing, so it gets first choice of side.
  const composerSide: "above" | "below" =
    composer && !fitsBelow(rect, canvas, composer.height) && fitsAbove(rect, composer.height)
      ? "above"
      : "below";
  if (composer) layout.composer = place(rect, canvas, composer, composerSide);
  if (!bubble) return layout;

  const otherSide = composerSide === "below" ? "above" : "below";
  let placement: SurfacePlacement;
  if (!layout.composer) {
    // Alone, the bubble follows the same preference the composer would have.
    placement = place(
      rect,
      canvas,
      bubble,
      fitsBelow(rect, canvas, bubble.height) ? "below" : "above",
    );
  } else if (
    otherSide === "below" ? fitsBelow(rect, canvas, bubble.height) : fitsAbove(rect, bubble.height)
  ) {
    placement = place(rect, canvas, bubble, otherSide);
  } else {
    // Only one side is usable: sit beyond the composer rather than across it.
    const top =
      composerSide === "below"
        ? layout.composer.top + composer!.height + AGENT_SURFACE_GAP
        : layout.composer.top - bubble.height - AGENT_SURFACE_GAP;
    placement = {
      left: centeredLeft(rect, canvas, bubble.width),
      top: clampTop(top, canvas, bubble.height),
      side: composerSide,
    };
  }

  layout.bubble = {
    ...placement,
    tailLeft: clampNumber(
      rect.left + rect.width / 2 - placement.left,
      TAIL_INSET,
      bubble.width - TAIL_INSET,
    ),
  };
  return layout;
}
